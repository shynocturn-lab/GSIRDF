/* API Gateway 클라이언트 — KRX · DART · ECOS · Naver */
import { settings, sanitizeKey } from './store.js';
import { idToken } from './auth.js';
import { store } from './cache.js';
import { ttlFor, cacheKey, isImmutable, isSettledDay, ecosMissing, ecosMerge, ecosSlice, DAY, MIN } from './cachepolicy.js';
import { shouldFetchRealtime, mergeRealtime } from './realtime.js';

export class ApiError extends Error {
  constructor(code, message, status = 0) { super(message || code); this.code = code; this.status = status; }
}

const memo = new Map(); // key → { exp, promise }
const TTL = { krx: 10 * 60e3, dart: 30 * 60e3, ecos: 60 * 60e3, naver: 5 * 60e3, health: 60e3 };

let inflight = 0;
function progress(delta) {
  inflight += delta;
  const bar = document.getElementById('topProgress');
  if (!bar) return;
  if (inflight > 0) { bar.classList.remove('done'); bar.classList.add('run'); }
  else { bar.classList.add('done'); setTimeout(() => { if (!inflight) bar.classList.remove('run', 'done'); }, 400); }
}

let skipDeviceKeys = false; // 팀 공유본은 사용자 키를 생략하거나 서버 기본 키로 대체하지 않음
function keyHeaders() {
  if (skipDeviceKeys) return {};
  const k = settings.get().keys;
  const map = { krx: 'X-IDF-KRX', dart: 'X-IDF-DART', ecos: 'X-IDF-ECOS', naverId: 'X-IDF-NAVER-ID', naverSecret: 'X-IDF-NAVER-SECRET' };
  const h = {};
  for (const [name, header] of Object.entries(map)) {
    const v = sanitizeKey(k[name]);
    if (v) h[header] = v; // 헤더에 넣을 수 없는 값은 절대 보내지 않음
  }
  return h;
}
export const deviceKeysSkipped = () => skipDeviceKeys;

async function raw(path, params = {}) { return rawOnce(path, params); }

async function rawOnce(path, params = {}) {
  const base = settings.gateway();
  if (!base) throw new ApiError('NO_GATEWAY', 'API Gateway 주소가 설정되지 않았습니다. 설정에서 입력하세요.');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const token = await idToken();
  progress(1);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try {
      res = await fetch(`${base}${path}${qs ? '?' + qs : ''}`, {
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...keyHeaders() },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    let body = null;
    try { body = await res.json(); } catch { /* non json */ }
    if (!res.ok) throw new ApiError(body?.error || 'HTTP_' + res.status, body?.message || res.statusText, res.status);
    if (!body || typeof body !== 'object') throw new ApiError('BAD_GATEWAY_RESPONSE', 'Gateway 응답이 IDF 형식이 아닙니다. Worker 코드를 확인하세요.');
    return body;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err?.name === 'AbortError') throw new ApiError('TIMEOUT', '응답이 30초 넘게 지연되었습니다. 잠시 후 다시 시도하세요.');
    throw new ApiError('NETWORK', `Gateway에 연결할 수 없습니다. (${String(err?.message || err).slice(0, 80)})`);
  } finally {
    progress(-1);
  }
}

/** 바이너리(ZIP) 수신 — DART가 '자료 없음'을 JSON으로 돌려주면 DART_013/014 오류로 변환 */
async function rawBinary(path, params = {}) { return rawBinaryOnce(path, params); }

async function rawBinaryOnce(path, params = {}) {
  const base = settings.gateway();
  if (!base) throw new ApiError('NO_GATEWAY', 'API Gateway 주소가 설정되지 않았습니다. 설정에서 입력하세요.');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  const token = await idToken();
  progress(1);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let res;
    try {
      res = await fetch(`${base}${path}?${qs}`, { headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...keyHeaders() }, signal: ctrl.signal });
    } finally { clearTimeout(timer); }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || ct.includes('json')) {
      let body = null;
      try { body = await res.json(); } catch { /* non json */ }
      if (res.status === 404 && (!body || body.error === 'NOT_FOUND')) throw new ApiError('XBRL_OLD_WORKER', 'XBRL 기능은 Worker v1.8 이상이 필요합니다. Cloudflare Worker 코드를 교체하세요.');
      if (body?.status && body.status !== '000') throw new ApiError('DART_' + body.status, body.message || 'OpenDART 자료 없음');
      throw new ApiError(body?.error || 'HTTP_' + res.status, body?.message || res.statusText, res.status);
    }
    return await res.arrayBuffer();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err?.name === 'AbortError') throw new ApiError('TIMEOUT', 'XBRL 파일 다운로드가 60초 넘게 지연되었습니다.');
    throw new ApiError('NETWORK', `Gateway에 연결할 수 없습니다. (${String(err?.message || err).slice(0, 80)})`);
  } finally {
    progress(-1);
  }
}

/* ------------------------------------------------ 영구 저장소 연동 조회 */
let forceUntil = 0; // 새로고침 버튼: 이 시각까지 변동 데이터는 저장본 대신 새로 받음
const forcing = () => Date.now() < forceUntil;
export const isForcing = forcing;
// 저장본으로 대신 보여줘도 되는 '장애'만 (로그인·권한 오류는 절대 저장본으로 대체하지 않음)
const OUTAGE = new Set(['NETWORK', 'TIMEOUT', 'UPSTREAM_TIMEOUT', 'UPSTREAM_NETWORK', 'UPSTREAM_BLOCKED', 'WORKER_EXCEPTION', 'BUDGET_EXCEEDED', 'HTTP_502', 'HTTP_503', 'HTTP_504']);
const isOutage = (err) => OUTAGE.has(err?.code) || /^UPSTREAM_5/.test(err?.code || '');
export const stats = { hit: 0, miss: 0, stale: 0 };

let staleNotified = 0;
function notifyStale(savedAt) {
  stats.stale += 1;
  if (Date.now() - staleNotified < 60e3) return;
  staleNotified = Date.now();
  document.dispatchEvent(new CustomEvent('idf:stale', { detail: { savedAt } }));
}

/* 공시가 끝난 DART 보고서·회사정보(목록 제외)는 정정이 드물다 → 저장본을 즉시 보여주고 뒤에서 확인(SWR) */
const swrable = (path, saved) => path.startsWith('/api/dart/') && path !== '/api/dart/list.json' && saved?.data?.status === '000';
const revalidating = new Set();
function revalidate(key, path, params, saved) {
  if (revalidating.has(key)) return;
  revalidating.add(key);
  raw(path, params).then((fresh) => {
    const ttl = ttlFor(path, params, fresh);
    if (ttl > 0) store.put({ k: key, data: fresh, exp: Date.now() + ttl, ttl, at: Date.now() });
    const was = saved?.data?.list?.[0]?.rcept_no; const now = fresh?.list?.[0]?.rcept_no;
    if (was && now && was !== now) document.dispatchEvent(new CustomEvent('idf:revised', { detail: { path, params, from: was, to: now } }));
  }).catch(() => { /* 실패해도 저장본 유지 */ }).finally(() => revalidating.delete(key));
}

/** 메모리(진행 중 요청 공유) → 기기 저장소(유효기간 내 즉시 · DART 공시본은 만료돼도 즉시+뒤에서 갱신) → 네트워크 → 실패 시 저장본 */
function get(kind, path, params = {}) {
  const key = cacheKey(path, params);
  const hit = memo.get(key);
  if (hit && hit.exp > Date.now() && !forcing()) return hit.promise;
  const promise = (async () => {
    const saved = await store.get(key);
    if (saved && saved.exp > Date.now() && (!forcing() || isImmutable(saved.ttl))) { stats.hit += 1; return saved.data; }
    if (saved && !forcing() && swrable(path, saved)) { stats.hit += 1; stats.swr = (stats.swr || 0) + 1; revalidate(key, path, params, saved); return saved.data; }
    stats.miss += 1;
    try {
      const data = await raw(path, params);
      const ttl = ttlFor(path, params, data);
      if (ttl > 0) store.put({ k: key, data, exp: Date.now() + ttl, ttl, at: Date.now() });
      return data;
    } catch (err) {
      if (saved && isOutage(err)) { notifyStale(saved.at); return saved.data; }
      throw err;
    }
  })();
  memo.set(key, { exp: Date.now() + (TTL[kind] || 60e3), promise });
  promise.catch(() => memo.delete(key));
  return promise;
}

export const clearCache = () => memo.clear();
/** 새로고침: 변동 데이터(시세·공시목록·뉴스·최근 지표)만 새로 받고, 확정 과거 데이터는 저장본 유지 */
const refreshHooks = new Set();
/** 다른 모듈의 메모리 캐시도 새로고침 때 비우도록 등록 */
export function onForceRefresh(fn) { refreshHooks.add(fn); }
export function forceRefresh(ms = 15000) { memo.clear(); forceUntil = Date.now() + ms; refreshHooks.forEach((fn) => { try { fn(); } catch { /* noop */ } }); }
export async function clearSavedData() { memo.clear(); await store.clear(); stats.hit = stats.miss = stats.stale = 0; }
export const savedDataStats = () => store.stats();
export const savedDataBreakdown = (xbrlVer) => store.breakdown(xbrlVer);
export const cleanupSavedData = (xbrlVer) => store.cleanup(xbrlVer);
export const exportSavedData = () => store.exportAll();
export const importSavedData = (entries) => store.importAll(entries);

/* ---------------- KRX 시계열: 거래일 단위 저장 → 없는 날짜만 추가 조회 */
async function seriesIncremental(codes, dates, index) {
  const codeKey = (c, d) => `krx:${c}:${d}`;
  const idxKey = (d) => `krx:KOSPI:${d}`;
  const conKey = (d) => `krx:KCON:${d}`; // KOSPI 건설 업종지수(v2.0~) — 없으면 그 날짜만 추가 조회
  const now = Date.now();
  const keys = dates.flatMap((d) => [...codes.map((c) => codeKey(c, d)), ...(index ? [idxKey(d), conKey(d)] : [])]);
  const vals = await store.getMany(keys);
  const got = new Map();
  keys.forEach((k, i) => { const v = vals[i]; if (v && v.exp > now && !(forcing() && !isImmutable(v.ttl))) got.set(k, v.data); });
  const complete = (d) => codes.every((c) => got.has(codeKey(c, d))) && (!index || (got.has(idxKey(d)) && got.has(conKey(d))));
  const missing = dates.filter((d) => !complete(d));
  if (missing.length) {
    const chunks = [];
    for (let i = 0; i < missing.length; i += 6) chunks.push(missing.slice(i, i + 6));
    let parts;
    try {
      parts = await Promise.all(chunks.map((c) => raw('/api/krx/series', { codes: codes.join(','), dates: c.join(','), index: index ? '1' : '' })));
    } catch (err) {
      // 장애 시: 유효기간이 지난 저장본이라도 있으면 사용
      if (!isOutage(err)) throw err;
      const any = vals.some(Boolean);
      if (!any) throw err;
      keys.forEach((k, i) => { if (!got.has(k) && vals[i]) got.set(k, vals[i].data); });
      notifyStale(Math.min(...vals.filter(Boolean).map((v) => v.at || now)));
      parts = [];
    }
    const writes = [];
    const returned = new Map(parts.flatMap((p) => p.points || []).map((pt) => [pt.date, pt]));
    for (const d of missing) {
      const pt = returned.get(d);
      const settled = isSettledDay(d);
      const ttl = settled ? 365 * DAY : 20 * MIN; // 오늘·어제 '아직 없음'은 20분만 기억
      if (!pt && parts.length === 0) continue; // 장애로 못 받은 날짜는 비워둠
      for (const c of codes) {
        const v = pt?.stocks?.[c] ?? null; // 휴장일·미상장은 null로 저장(다시 묻지 않음)
        got.set(codeKey(c, d), v);
        writes.push({ k: codeKey(c, d), data: v, exp: now + ttl, ttl, at: now });
      }
      if (index) {
        const v = pt ? pt.kospi ?? null : null;
        got.set(idxKey(d), v);
        writes.push({ k: idxKey(d), data: v, exp: now + ttl, ttl, at: now });
        // 이전 Worker(v1.5)는 con 필드가 없음 → 20분만 기억해 Worker 업데이트 후 다시 받는다
        const hasCon = !pt || 'con' in pt;
        const cttl = hasCon ? ttl : 20 * MIN;
        got.set(conKey(d), pt?.con ?? null);
        writes.push({ k: conKey(d), data: pt?.con ?? null, exp: now + cttl, ttl: cttl, at: now });
      }
    }
    store.putMany(writes);
  }
  stats.hit += dates.length - missing.length;
  const points = dates.map((d) => {
    const stocks = {};
    codes.forEach((c) => { const v = got.get(codeKey(c, d)); if (v) stocks[c] = v; });
    return Object.keys(stocks).length ? { date: d, kospi: index ? got.get(idxKey(d)) ?? null : null, con: index ? got.get(conKey(d)) ?? null : null, stocks } : null;
  }).filter(Boolean);
  return { points, fetchedDates: missing.length };
}

/* ---------------- ECOS: 구간 저장 → 앞뒤 부족 구간만 추가 조회(최근 10일은 수정치 반영 위해 재조회) */
async function ecosIncremental(def, cycle, start, end) {
  const key = `ecos:${def.stat}|${cycle}|${def.item}`;
  const saved = await store.get(key);
  const entry = saved?.data;
  const need = forcing() && entry ? ecosMissing({ ...entry, fetchedAt: 0 }, start, end) : ecosMissing(entry, start, end);
  if (!need.length) { stats.hit += 1; return { rows: ecosSlice(entry, start, end) }; }
  stats.miss += 1;
  let parts;
  try {
    parts = await Promise.all(need.map(([s, e]) => raw(`/api/ecos/StatisticSearch/${def.stat}/${cycle}/${s}/${e}/${def.item}`).then((b) => b.rows || [])));
  } catch (err) {
    if (entry && isOutage(err)) { notifyStale(saved.at); return { rows: ecosSlice(entry, start, end) }; }
    throw err;
  }
  const merged = ecosMerge(entry, parts, start, end);
  store.put({ k: key, data: merged, exp: Date.now() + 400 * DAY, ttl: 400 * DAY, at: Date.now() });
  return { rows: ecosSlice(merged, start, end), fetched: need };
}

/** 보안 자가진단용: 지정한 헤더만으로 요청하고 상태코드·본문을 그대로 돌려준다 */
export async function probe(path, headers = {}) {
  const base = settings.gateway();
  if (!base) throw new ApiError('NO_GATEWAY');
  try {
    const res = await fetch(base + path, { headers, cache: 'no-store' });
    let body = null;
    try { body = await res.json(); } catch { /* non json */ }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: { error: 'NETWORK' } };
  }
}

/* ---------------------------------------------------------------- dates */
export function kst(d = new Date()) { return new Date(d.getTime() + 9 * 3600e3); }
export function ymd(d) { return d.toISOString().slice(0, 10).replace(/-/g, ''); }

/** 차트용 영업일 샘플링(최대 20점) */
export function sampleDates(range) {
  const days = { '1m': 31, '3m': 92, '6m': 183, '1y': 366 }[range] || 92;
  const end = kst();
  const list = [];
  for (let i = days; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 86400e3);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) list.push(ymd(d));
  }
  const max = 20;
  if (list.length <= max) return list;
  const step = (list.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => list[Math.round(i * step)]);
}

/* -------------------------------------------------------------- services */
export const api = {
  health: () => raw('/api/health'),

  snapshot: (codes) => get('krx', '/api/krx/snapshot', { codes: codes.join(',') }),
  /** 특정일(이전 최근 거래일) 스냅샷 — 분기말 주가용 */
  snapshotAt: (codes, date) => get('krx', '/api/krx/snapshot', { codes: codes.join(','), date }),
  /** Worker 무료 한도(요청당 50회)를 지키기 위해 날짜를 6개씩 나눠 병렬 요청 후 합친다 */
  async series(codes, range, index = true) {
    const sorted = [...new Set(codes)].sort();
    const { points } = await seriesIncremental(sorted, sampleDates(range), index);
    if (!points.length) throw new ApiError('KRX_NO_DATA', '선택한 기간의 시세가 없습니다.');
    return { codes, points };
  },

  /** 외국인 보유율·PER·PBR 등 투자지표(Worker v1.6+) */
  stockInfo: (code) => get('krx', '/api/stock/info', { code }),
  /** 네이버 증권 KRX 정규장 실시간/당일 마감가(Worker v1.9+, IndexedDB 미저장 · 화면 진입/새로고침 갱신) */
  realtime(codes) {
    const sorted = [...new Set(codes)].sort();
    const key = `rt:${sorted.join(',')}`;
    const inflightKey = `rt-in:${sorted.join(',')}`;
    if (memo.has(inflightKey)) return memo.get(inflightKey).promise;
    const hit = memo.get(key);
    if (hit && hit.exp > Date.now() && !forcing()) return hit.promise;
    const promise = raw('/api/stock/realtime', {
      codes: sorted.join(','),
      index: '1',
      ...(forcing() ? { fresh: '1' } : {}),
    });
    memo.set(inflightKey, { exp: Date.now() + 30000, promise });
    memo.set(key, { exp: Date.now() + 5000, promise });
    promise.finally(() => memo.delete(inflightKey)).catch(() => memo.delete(key));
    return promise;
  },
  /** 하이브리드 스냅샷: KRX 공식 종가 기반 + 평일 09:00 이후 KRX 미확정 시 네이버 정규장 실시간/당일 마감가 병합 */
  async liveSnapshot(codes) {
    const snap = await this.snapshot(codes);
    if (!shouldFetchRealtime(snap)) return { ...snap, live: false, source: 'krx' };
    try {
      const rt = await this.realtime(codes);
      return mergeRealtime(snap, rt);
    } catch {
      return { ...snap, live: false, source: 'krx' };
    }
  },
  dart: (endpoint, params) => get('dart', `/api/dart/${endpoint}.json`, params),
  /** XBRL 원본 ZIP(ArrayBuffer) — 저장은 xbrl.js가 '요약'만 접수번호별로 */
  dartXbrl: (rcept, reprtCode) => rawBinary('/api/dart/fnlttXbrl.xml', { rcept_no: rcept, reprt_code: reprtCode }),
  disclosures(corp, days = 90, page = 1, count = 40) {
    const end = kst();
    const bgn = new Date(end.getTime() - days * 86400e3);
    return this.dart('list', { corp_code: corp, bgn_de: ymd(bgn), end_de: ymd(end), page_no: page, page_count: count });
  },

  ecos(def, cycle, start, end) {
    const key = `ecos-mem:${def.stat}|${cycle}|${def.item}|${start}|${end}`;
    const hit = memo.get(key);
    if (hit && hit.exp > Date.now() && !forcing()) return hit.promise;
    const promise = ecosIncremental(def, cycle, start, end);
    memo.set(key, { exp: Date.now() + 60e3, promise });
    promise.catch(() => memo.delete(key));
    return promise;
  },

  diag: () => raw('/api/diag'),
  news: (query, display = 30, sort = 'date', start = 1) => get('naver', '/api/naver/news', { query, display, sort, ...(start > 1 ? { start } : {}) }),
};

/** Gateway 연결 진단: 접속 불가 / Worker 실행 오류 / 다른 코드 / 구버전 / 정상 */
export async function diagnoseGateway() {
  const base = settings.gateway();
  if (!base) return { code: 'NO_GATEWAY', ok: false, text: 'Gateway 주소가 비어 있습니다.' };
  const withTimeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
  try {
    await fetch(base + '/', { mode: 'no-cors', cache: 'no-store', signal: withTimeout(12000) });
  } catch {
    return { code: 'UNREACHABLE', ok: false, text: `Worker 주소에 접속할 수 없습니다 (${base}). 주소 오타 또는 인터넷 연결을 확인하세요.` };
  }
  let res;
  let body = null;
  try {
    res = await fetch(base + '/', { cache: 'no-store', signal: withTimeout(12000) });
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 80) }; }
  } catch {
    return { code: 'WORKER_CRASH', ok: false, text: 'Worker가 오류로 응답했습니다(코드 실행 오류). Cloudflare의 Worker 코드를 새 버전 전체로 다시 붙여넣고 Deploy 하세요.' };
  }
  if (!body || body.service !== 'idf-gateway') {
    return { code: 'WRONG_CODE', ok: false, text: `Worker에 IDF Gateway 코드가 아닌 다른 코드가 배포되어 있습니다${body && body.raw ? ` ("${body.raw}")` : ''}. 코드 전체를 다시 붙여넣으세요.` };
  }
  if (!body.version) {
    return { code: 'OLD_VERSION', ok: true, version: '1.3 이하', config: null, text: 'Worker가 이전 버전입니다. 새 Worker 코드(1.4)로 교체를 권장합니다.' };
  }
  return { code: 'OK', ok: true, version: body.version, config: body.config || null, text: `Worker v${body.version} 정상 응답` };
}

/** 화면 표시용: 혹시 남은 인증키·쿼리스트링을 가린다 */
export function scrubText(t) {
  return String(t || '')
    .replace(/(crtfc_key|auth_key|apikey|key)=[^&\s,]+/gi, '$1=***')
    .replace(/(https?:\/\/[^\s?,]+)\?[^\s,]*/g, '$1')
    .slice(0, 220);
}

export function errorText(err) {
  const map = {
    NO_GATEWAY: 'API Gateway가 설정되지 않았습니다.',
    AUTH_REQUIRED: 'Google 로그인이 필요합니다.',
    NOT_APPROVED: '승인되지 않은 계정입니다.',
    KEY_MISSING: '인증키가 없습니다. 설정에서 확인하세요.',
    KRX_NO_DATA: '최근 거래일 시세가 아직 제공되지 않았습니다.',
    UPSTREAM_BLOCKED: '외부 API 서버가 Worker의 요청을 차단했습니다. 설정 → [외부 API 진단]으로 원인을 확인하세요.',
    TIMEOUT: '응답이 지연되었습니다. 잠시 후 다시 시도하세요.',
    BUDGET_EXCEEDED: '요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도하세요.',
    WORKER_EXCEPTION: 'Worker 내부 오류가 발생했습니다.',
    TOKEN_AUDIENCE: 'Worker의 Firebase 프로젝트 설정이 로그인 프로젝트와 다릅니다.',
    TOKEN_EXPIRED: '로그인이 만료되었습니다. 다시 로그인하세요.',
    DART_010: 'OpenDART 인증키 오류(등록되지 않은 키). 설정 → OpenDART 키를 확인하세요.',
    DART_011: 'OpenDART 인증키 오류(사용할 수 없는 키). 설정 → OpenDART 키를 확인하세요.',
    DART_012: 'OpenDART 인증키 오류(접근할 수 없는 IP). OpenDART 키 관리에서 IP 제한을 해제하세요.',
    DART_901: 'OpenDART 인증키 사용기간이 만료되었습니다. OpenDART에서 키를 재발급하세요.',
    DART_020: 'OpenDART 일일 요청 한도를 초과했습니다. 내일 다시 시도하세요(저장된 데이터는 계속 표시).',
    DART_013: '해당 보고서의 XBRL 원본이 제공되지 않습니다(조회 데이터 없음).',
    DART_014: '해당 보고서의 XBRL 원본 파일이 없습니다.',
    DART_800: 'OpenDART 시스템 점검 중입니다. 잠시 후 다시 시도하세요.',
  };
  // 이전 Worker(v1.5)는 미승인 코스닥 지수를 호출해 KRX 401 원문을 그대로 전달 → 원인과 조치를 안내
  if (err?.code === 'KRX_AUTH' && /respMsg|Unauthorized/i.test(err?.message || '')) {
    return 'Open KRX 미승인 서비스(코스닥 지수) 호출로 실패했습니다. Cloudflare Worker 코드를 v1.6으로 교체하면 해결됩니다.';
  }
  return map[err?.code] || scrubText(err?.message) || '데이터를 불러오지 못했습니다.';
}
