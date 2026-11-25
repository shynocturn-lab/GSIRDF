/** IDF Team Gateway — Firebase Google 토큰 검증, 접근 정책, 사용자별 API 키.
 * ACCESS_MODE: allowlist(기본 차단) 또는 domain(회사 도메인).
 * 각 요청은 사용자가 제공한 키만 사용합니다. 운영 배포 전 보안 검토 필수.
 */

const VERSION = '1.9.0';

/* 공개 저장소에는 빈 값. Cloudflare 대시보드에 붙여넣는 배포본에만 채운다. */
const BUILTIN = {
  firebaseProjectId: '',
  allowedEmails: '',
  keys: { krx: '', dart: '', ecos: '', naverId: '', naverSecret: '' },
};

const KRX = {
  KOSPI: 'https://data-dbg.krx.co.kr/svc/apis/sto/stk_bydd_trd',
  KOSDAQ: 'https://data-dbg.krx.co.kr/svc/apis/sto/ksq_bydd_trd',
  KOSPI_IDX: 'https://data-dbg.krx.co.kr/svc/apis/idx/kospi_dd_trd',
  KOSDAQ_IDX: 'https://data-dbg.krx.co.kr/svc/apis/idx/kosdaq_dd_trd',
};
/* Open KRX는 서비스(API)별로 이용 신청·승인이 필요하다. 앱이 실제로 쓰는 서비스는
 * 유가증권 일별매매정보(stk_bydd_trd) + KOSPI 시리즈 일별시세정보(kospi_dd_trd) 두 개뿐이다. */
const KRX_SERVICE = {
  KOSPI: '유가증권 일별매매정보(stk_bydd_trd)',
  KOSDAQ: '코스닥 일별매매정보(ksq_bydd_trd)',
  KOSPI_IDX: 'KOSPI 시리즈 일별시세정보(kospi_dd_trd)',
  KOSDAQ_IDX: '코스닥 시리즈 일별시세정보(kosdaq_dd_trd)',
};
/* KOSPI 업종지수 중 건설 — KRX 지수명 개편(건설업 → 건설) 모두 대응 */
const CON_NAMES = ['건설', '건설업', '코스피 건설', '코스피 200 건설'];
const NAVER_STOCK = 'https://m.stock.naver.com/api/stock/';
const NAVER_REALTIME = 'https://polling.finance.naver.com/api/realtime/domestic/';
const DART_BASE = 'https://opendart.fss.or.kr/api/';
const ECOS_BASE = 'https://ecos.bok.or.kr/api/';
const NAVER_NEWS = 'https://openapi.naver.com/v1/search/news.json';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/* 국내 공공 API 방화벽(WAF)은 User-Agent 없는 요청을 오류 페이지로 돌려보내는 경우가 있어 브라우저 형태로 요청 */
const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
};

const SUBREQUEST_BUDGET = 45; // 무료 플랜 50 미만으로 여유 확보
const MAX_SERIES_DATES = 6;   // 날짜당 최대 6회(종목·지수 × match/fetch/put) → 36 + JWKS 1

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, X-IDF-KRX, X-IDF-DART, X-IDF-ECOS, X-IDF-NAVER-ID, X-IDF-NAVER-SECRET',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env, ctx) {
    // 어떤 예외가 나도 CORS 헤더가 붙은 JSON으로 응답한다(브라우저에 '연결 불가'로 보이지 않도록).
    try {
      return await handle(request, env || {}, ctx || { waitUntil() {} });
    } catch (err) {
      return reply({ error: 'WORKER_EXCEPTION', message: scrub(String((err && err.message) || err), env), version: VERSION }, 500);
    }
  },
};

/* ---------------------------------------------------------------- routing */
async function handle(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return reply({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const cfg = config(env);

  if (path === '/' || path === '/api/ping') {
    // 인증 없이 확인 가능한 진단 정보(비밀값 없음)
    return reply({
      service: 'idf-gateway', ok: true, version: VERSION,
      config: {
        firebaseProjectId: cfg.projectId,
        allowedEmails: cfg.allowed.length,
        defaultKeys: Object.fromEntries(Object.entries(cfg.keys).map(([k, v]) => [k, !!v])),
      },
    }, 200);
  }

  const budget = new Budget(SUBREQUEST_BUDGET);
  try {
    const user = await authenticate(request, cfg, budget);
    const keys = resolveKeys(request, cfg);
    if (path.startsWith('/api/krx/')) need(keys.krx, 'Open KRX');
    if (path.startsWith('/api/dart/')) need(keys.dart, 'OpenDART');
    if (path.startsWith('/api/ecos/')) need(keys.ecos, 'ECOS');
    if (path === '/api/naver/news') { need(keys.naverId, 'Naver Client ID'); need(keys.naverSecret, 'Naver Client Secret'); }

    if (path === '/api/health') {
      return reply({
        ok: true, version: VERSION, user: user.email,
        keys: { krx: !!keys.krx, dart: !!keys.dart, ecos: !!keys.ecos, naver: !!(keys.naverId && keys.naverSecret) },
      }, 200);
    }
    if (path === '/api/krx/snapshot') return reply(await krxSnapshot(url, keys, ctx, budget), 200);
    if (path === '/api/krx/series') return reply(await krxSeries(url, keys, ctx, budget), 200);
    if (path === '/api/stock/info') return reply(await stockInfo(url, ctx, budget), 200);
    if (path === '/api/stock/realtime') return reply(await stockRealtime(url, ctx, budget), 200);
    if (path === '/api/dart/fnlttXbrl.xml') return await dartXbrl(url, keys, budget);
    if (path.startsWith('/api/dart/')) return reply(await dartProxy(path.slice(10), url, keys, ctx, budget), 200);
    if (path.startsWith('/api/ecos/')) return reply(await ecosProxy(path.slice(10), keys, ctx, budget), 200);
    if (path === '/api/naver/news') return reply(await naverNews(url, keys, ctx, budget), 200);
    if (path === '/api/diag') return reply(await diagnose(request, keys, budget), 200);
    return reply({ error: 'NOT_FOUND' }, 404);
  } catch (err) {
    if (err instanceof HttpError) return reply({ error: err.code, message: scrub(err.message, env, request) }, err.status);
    throw err;
  }
}

/* ------------------------------------------------------------------ utils */
class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}

class Budget {
  constructor(max) { this.left = max; }
  take(n = 1) {
    if (this.left < n) throw new HttpError(503, 'BUDGET_EXCEEDED', '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
    this.left -= n;
  }
}

/** 오류 메시지에서 인증키·쿼리스트링 제거(어떤 경우에도 키가 응답에 실리지 않도록) */
function scrub(msg, env = {}, request = null) {
  let t = String(msg || '');
  const secrets = [
    ...Object.values(BUILTIN.keys),
    env.KRX_KEY, env.DART_KEY, env.ECOS_KEY, env.NAVER_ID, env.NAVER_SECRET,
    ...(request ? ['X-IDF-KRX', 'X-IDF-DART', 'X-IDF-ECOS', 'X-IDF-NAVER-ID', 'X-IDF-NAVER-SECRET'].map((h) => request.headers.get(h)) : []),
  ].map((v) => String(v || '').trim()).filter((v) => v.length >= 6);
  for (const v of secrets) t = t.split(v).join('***');
  t = t.replace(/(crtfc_key|auth_key|key|apikey)=[^&\s,]+/gi, '$1=***');
  t = t.replace(/(https?:\/\/[^\s?,]+)\?[^\s,]*/g, '$1');
  return t.slice(0, 300);
}

function reply(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function config(env) {
  const list = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const allowed = list(env.ALLOWED_EMAILS).length ? list(env.ALLOWED_EMAILS) : list(BUILTIN.allowedEmails);
  return {
    projectId: String(env.FIREBASE_PROJECT_ID || '').trim() || BUILTIN.firebaseProjectId,
    allowed,
    accessMode: String(env.ACCESS_MODE || 'allowlist').trim().toLowerCase(),
    allowedDomain: String(env.ALLOWED_DOMAIN || '').trim().toLowerCase(),
    keys: {
      krx: String(env.KRX_KEY || '').trim() || BUILTIN.keys.krx,
      dart: String(env.DART_KEY || '').trim() || BUILTIN.keys.dart,
      ecos: String(env.ECOS_KEY || '').trim() || BUILTIN.keys.ecos,
      naverId: String(env.NAVER_ID || '').trim() || BUILTIN.keys.naverId,
      naverSecret: String(env.NAVER_SECRET || '').trim() || BUILTIN.keys.naverSecret,
    },
  };
}

function resolveKeys(request, cfg) {
  const h = (name) => (request.headers.get(name) || '').trim().slice(0, 200);
  return {
    krx: h('X-IDF-KRX'),
    dart: h('X-IDF-DART'),
    ecos: h('X-IDF-ECOS'),
    naverId: h('X-IDF-NAVER-ID'),
    naverSecret: h('X-IDF-NAVER-SECRET'),
  };
}

function need(value, name) {
  if (!value) throw new HttpError(503, 'KEY_MISSING', `${name} 인증키가 설정되지 않았습니다.`);
  return value;
}

/* 2단 캐시: 인스턴스 메모리(무료·한도 미사용) → Cache API(한도 사용, 실패해도 무시) */
const mem = new Map();
const MEM_MAX = 80;
function memGet(key) {
  const hit = mem.get(key);
  if (!hit) return undefined;
  if (hit.exp < Date.now()) { mem.delete(key); return undefined; }
  return hit.value;
}
function memSet(key, value, ttlSec) {
  if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value);
  mem.set(key, { value, exp: Date.now() + ttlSec * 1000 });
}

// API 키 원문이 캐시 주소에 남지 않도록 해시만 사용합니다.
async function keyFingerprint(...parts) {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function cached(ctx, budget, cacheKey, ttlSec, producer) {
  const m = memGet(cacheKey);
  if (m !== undefined) return m;
  const req = new Request('https://idf-cache.internal/' + encodeURIComponent(cacheKey));
  const store = typeof caches !== 'undefined' ? caches.default : null;
  if (store && budget.left > 8) {
    try {
      budget.take();
      const hit = await store.match(req);
      if (hit) { const v = await hit.json(); memSet(cacheKey, v, ttlSec); return v; }
    } catch { /* 캐시 실패는 무시 */ }
  }
  const value = await producer();
  memSet(cacheKey, value, ttlSec);
  if (store && ttlSec > 0 && budget.left > 8) {
    try {
      budget.take();
      ctx.waitUntil(store.put(req, new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSec}` },
      })).catch(() => {}));
    } catch { /* noop */ }
  }
  return value;
}

async function fetchJson(budget, url, init = {}, timeoutMs = 20000) {
  budget.take();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, headers: { ...UPSTREAM_HEADERS, ...(init.headers || {}) }, redirect: 'manual', signal: ctrl.signal });
    if (res.status >= 300 && res.status < 400) {
      const host = new URL(url).hostname;
      const loc = (res.headers.get('location') || '').split('?')[0];
      throw new HttpError(502, 'UPSTREAM_BLOCKED', `${host} 서버가 요청을 거부하고 오류 페이지(${loc || res.status})로 돌려보냈습니다.`);
    }
    const text = await res.text();
    if (!res.ok) throw new HttpError(502, 'UPSTREAM_' + res.status, text.slice(0, 200));
    try { return JSON.parse(text); } catch { throw new HttpError(502, 'UPSTREAM_NOT_JSON', text.slice(0, 200)); }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err && err.name === 'AbortError') throw new HttpError(504, 'UPSTREAM_TIMEOUT', `${new URL(url).hostname} 응답 지연`);
    throw new HttpError(502, 'UPSTREAM_NETWORK', String((err && err.message) || err));
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------- auth */
let jwksCache = { keys: null, exp: 0 };

async function authenticate(request, cfg, budget) {
  if (!cfg.projectId) throw new HttpError(503, 'CONFIG_MISSING', '팀 Firebase 프로젝트 ID를 설정하세요.');
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'AUTH_REQUIRED', 'Google 로그인이 필요합니다.');
  const payload = await verifyFirebaseToken(token, cfg.projectId, budget);
  const email = String(payload.email || '').toLowerCase();
  if (payload.email_verified !== true || payload.firebase?.sign_in_provider !== 'google.com') {
    throw new HttpError(403, 'NOT_APPROVED', '인증된 Google 계정이 필요합니다.');
  }
  const allowed = cfg.accessMode === 'allowlist' ? cfg.allowed.includes(email)
    : cfg.accessMode === 'domain' ? !!cfg.allowedDomain && email.endsWith('@' + cfg.allowedDomain)
    : false;
  if (!allowed) throw new HttpError(403, 'NOT_APPROVED', '서버 접근 정책에 따라 승인되지 않은 계정입니다.');
  return { email };
}

function b64urlToBytes(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function getJwks(budget, force = false) {
  if (!force && jwksCache.keys && Date.now() < jwksCache.exp) return jwksCache.keys;
  budget.take();
  let res;
  try { res = await fetch(JWKS_URL); } catch { throw new HttpError(503, 'JWKS_UNAVAILABLE', 'Google 공개키를 가져오지 못했습니다.'); }
  if (!res.ok) throw new HttpError(503, 'JWKS_UNAVAILABLE', 'Google 공개키를 가져오지 못했습니다.');
  const body = await res.json();
  const maxAge = Number(((res.headers.get('cache-control') || '').match(/max-age=(\d+)/) || [])[1] || 3600);
  jwksCache = { keys: Array.isArray(body.keys) ? body.keys : [], exp: Date.now() + Math.min(maxAge, 21600) * 1000 };
  return jwksCache.keys;
}

async function verifyFirebaseToken(token, projectId, budget) {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 4096) throw new HttpError(401, 'TOKEN_INVALID', '토큰 형식이 올바르지 않습니다.');
  let header;
  let payload;
  try {
    const dec = new TextDecoder();
    header = JSON.parse(dec.decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(dec.decode(b64urlToBytes(parts[1])));
  } catch {
    throw new HttpError(401, 'TOKEN_INVALID', '토큰 형식이 올바르지 않습니다.');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new HttpError(401, 'TOKEN_INVALID', '지원하지 않는 토큰입니다.');
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new HttpError(401, 'TOKEN_AUDIENCE', `토큰의 프로젝트가 일치하지 않습니다 (${projectId}).`);
  }
  if (typeof payload.sub !== 'string' || !payload.sub) throw new HttpError(401, 'TOKEN_INVALID', '토큰 주체가 없습니다.');
  if (!(payload.exp > now - 30) || !(payload.iat < now + 300)) throw new HttpError(401, 'TOKEN_EXPIRED', '로그인이 만료되었습니다.');
  let jwk = (await getJwks(budget)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await getJwks(budget, true)).find((k) => k.kid === header.kid); // Google 키 교체 직후 대비
  if (!jwk) throw new HttpError(401, 'TOKEN_KID', '알 수 없는 서명 키입니다.');
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(401, 'TOKEN_SIGNATURE', '토큰 서명이 올바르지 않습니다.');
  return payload;
}

/* -------------------------------------------------------------------- KRX */
const ymdUTC = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const kstToday = () => ymdUTC(new Date(Date.now() + 9 * 3600 * 1000));
function toDate(s) { return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); }
function shiftDate(s, days) { const d = toDate(s); d.setUTCDate(d.getUTCDate() + days); return ymdUTC(d); }
function isWeekend(s) { const w = toDate(s).getUTCDay(); return w === 0 || w === 6; }

const n = (v) => {
  if (v === undefined || v === null || v === '' || v === '-') return null;
  const x = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(x) ? x : null;
};
function pickStock(r) {
  return {
    date: r.BAS_DD, code: String(r.ISU_CD || '').trim(), name: r.ISU_NM, close: n(r.TDD_CLSPRC), change: n(r.CMPPREVDD_PRC),
    rate: n(r.FLUC_RT), open: n(r.TDD_OPNPRC), high: n(r.TDD_HGPRC), low: n(r.TDD_LWPRC), volume: n(r.ACC_TRDVOL),
    value: n(r.ACC_TRDVAL), mktcap: n(r.MKTCAP), shares: n(r.LIST_SHRS),
  };
}
function pickIndex(r) {
  return { date: r.BAS_DD, name: String(r.IDX_NM || '').trim(), close: n(r.CLSPRC_IDX), change: n(r.CMPPREVDD_IDX), rate: n(r.FLUC_RT) };
}

/** KRX 전체시장 일별 → 필요한 필드만. 과거일 7일, 당일 30분 캐시 */
async function krxDay(endpoint, basDd, keys, ctx, budget) {
  const ttl = basDd < kstToday() ? 7 * 86400 : 1800;
  const denied = () => new HttpError(502, 'KRX_AUTH', `Open KRX '${KRX_SERVICE[endpoint]}' 이용 권한이 없습니다. openapi.krx.co.kr → 서비스 이용 → 해당 API '이용신청' 후 승인되면 사용할 수 있습니다.`);
  return cached(ctx, budget, `krx:${endpoint}:${basDd}:${await keyFingerprint(keys.krx)}`, ttl, async () => {
    let body;
    try {
      body = await fetchJson(budget, `${KRX[endpoint]}?basDd=${basDd}`, {
        headers: { AUTH_KEY: need(keys.krx, 'Open KRX'), accept: 'application/json' },
      });
    } catch (err) {
      if (err instanceof HttpError && /^UPSTREAM_40[13]$/.test(err.code)) throw denied();
      throw err;
    }
    if (!body || !Array.isArray(body.OutBlock_1)) {
      const msg = JSON.stringify(body || {}).slice(0, 160);
      // 인증/권한 오류는 즉시 전달(다른 날짜를 시도해도 같은 결과)
      if (/auth|key|인증|권한|401|403/i.test(msg)) throw denied();
      throw new HttpError(502, 'KRX_INVALID', msg);
    }
    return body.OutBlock_1.map((r) => (endpoint.endsWith('_IDX') ? pickIndex(r) : pickStock(r)));
  });
}

function parseCodes(url) {
  const codes = [...new Set((url.searchParams.get('codes') || '').split(',').map((s) => s.trim()).filter((s) => /^[0-9A-Z]{6}$/.test(s)))];
  if (!codes.length || codes.length > 30) throw new HttpError(400, 'BAD_CODES', '종목코드가 올바르지 않습니다.');
  return codes;
}
const fatal = (err) => err instanceof HttpError && ['KEY_MISSING', 'KRX_AUTH', 'BUDGET_EXCEEDED', 'UPSTREAM_401', 'UPSTREAM_403', 'UPSTREAM_BLOCKED'].includes(err.code);
const INDEX_NAME = { KOSPI_IDX: '코스피', KOSDAQ_IDX: '코스닥' };
function pickCon(rows) {
  for (const nm of CON_NAMES) { const r = rows.find((x) => x.name === nm); if (r) return r; }
  return null;
}

/** 최신 거래일 스냅샷(최대 8 영업일 역탐색) */
async function krxSnapshot(url, keys, ctx, budget) {
  const codes = parseCodes(url);
  const mkt = url.searchParams.get('mkt') === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';
  let date = url.searchParams.get('date') || kstToday();
  if (!/^\d{8}$/.test(date)) throw new HttpError(400, 'BAD_DATE', '날짜 형식 오류');
  let lastErr = null;
  for (let tried = 0, guard = 0; tried < 8 && guard < 14; guard += 1, date = shiftDate(date, -1)) {
    if (isWeekend(date)) continue;
    tried += 1;
    let rows;
    try { rows = await krxDay(mkt, date, keys, ctx, budget); } catch (err) { if (fatal(err)) throw err; lastErr = err; continue; }
    const hits = rows.filter((r) => codes.includes(r.code));
    if (!hits.length) continue;
    // 지수는 부가 정보 — 실패해도 종목 시세는 그대로 반환(코스닥 지수는 앱이 ECOS로 표시)
    let rowsIdx = [];
    try { rowsIdx = await krxDay('KOSPI_IDX', date, keys, ctx, budget); } catch { rowsIdx = []; }
    return { basDd: date, stocks: hits, index: { kospi: rowsIdx.find((r) => r.name === INDEX_NAME.KOSPI_IDX) || null, kosdaq: null, construction: pickCon(rowsIdx) } };
  }
  if (lastErr) throw lastErr;
  throw new HttpError(404, 'KRX_NO_DATA', '최근 거래일 시세가 아직 제공되지 않았습니다.');
}

/** 지정 날짜(최대 6개)의 종가 + 선택 지수 — 앱이 여러 번 나눠 요청한다 */
async function krxSeries(url, keys, ctx, budget) {
  const codes = parseCodes(url);
  const mkt = url.searchParams.get('mkt') === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI';
  const withIndex = url.searchParams.get('index') === '1';
  const dates = [...new Set((url.searchParams.get('dates') || '').split(',').filter((d) => /^\d{8}$/.test(d)))]
    .filter((d) => !isWeekend(d)).sort().slice(-MAX_SERIES_DATES);
  if (!dates.length) throw new HttpError(400, 'BAD_DATES', '날짜 목록이 올바르지 않습니다.');
  const points = [];
  for (const d of dates) {
    let rows;
    try { rows = await krxDay(mkt, d, keys, ctx, budget); } catch (err) { if (fatal(err)) throw err; continue; }
    const hits = rows.filter((r) => codes.includes(r.code));
    if (!hits.length) continue;
    let kospi = null; let con = null;
    if (withIndex) {
      try {
        const rowsIdx = await krxDay('KOSPI_IDX', d, keys, ctx, budget);
        kospi = (rowsIdx.find((r) => r.name === '코스피') || {}).close ?? null;
        con = (pickCon(rowsIdx) || {}).close ?? null;
      } catch { /* 지수 실패는 종목 시세에 영향 없음 */ }
    }
    points.push({ date: d, kospi, con, stocks: Object.fromEntries(hits.map((h) => [h.code, { close: h.close, volume: h.volume, mktcap: h.mktcap }])) });
  }
  return { codes, points };
}

/* ------------------------------------------------------------------- DART */
async function dartProxy(endpoint, url, keys, ctx, budget) {
  if (!/^[A-Za-z]{2,40}\.json$/.test(endpoint)) throw new HttpError(400, 'BAD_ENDPOINT', '허용되지 않는 DART 경로');
  const params = new URLSearchParams(url.searchParams);
  params.delete('crtfc_key');
  params.sort();
  const qs = params.toString();
  if (qs.length > 1500) throw new HttpError(400, 'BAD_QUERY', '요청이 너무 깁니다.');
  const ttl = endpoint === 'list.json' ? 600 : 6 * 3600;
  return cached(ctx, budget, `dart:${endpoint}?${qs}:${await keyFingerprint(keys.dart)}`, ttl, async () => {
    const body = await fetchJson(budget, `${DART_BASE}${endpoint}?crtfc_key=${encodeURIComponent(need(keys.dart, 'OpenDART'))}&${qs}`);
    // 000 정상, 013 조회 데이터 없음 — 그 외는 오류
    if (body && body.status && body.status !== '000' && body.status !== '013') {
      const auth = ['010', '011', '012', '901'].includes(body.status);
      throw new HttpError(auth ? 401 : 502, 'DART_' + body.status, body.message || 'OpenDART 오류');
    }
    return body;
  });
}

/**
 * XBRL 재무제표 원본(fnlttXbrl.xml, ZIP) — 압축 해제·파싱 없이 그대로 전달(Worker CPU 최소).
 * 앱이 해제·분석 후 '요약'만 접수번호별로 기기에 저장하므로 같은 보고서를 다시 받지 않는다.
 * DART가 ZIP 대신 오류(XML/JSON)를 주면 상태코드만 뽑아 JSON으로 돌려준다(013 = 자료 없음).
 */
async function dartXbrl(url, keys, budget) {
  const rcept = (url.searchParams.get('rcept_no') || '').trim();
  if (!/^\d{14}$/.test(rcept)) throw new HttpError(400, 'BAD_RCEPT_NO', '접수번호(rcept_no)가 올바르지 않습니다.');
  const reprt = (url.searchParams.get('reprt_code') || '').trim();
  if (!/^(11011|11012|11013|11014)$/.test(reprt)) throw new HttpError(400, 'BAD_REPRT_CODE', '보고서 코드(reprt_code)가 올바르지 않습니다.');
  const target = `${DART_BASE}fnlttXbrl.xml?crtfc_key=${encodeURIComponent(need(keys.dart, 'OpenDART'))}&rcept_no=${rcept}&reprt_code=${reprt}`;
  budget.take();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(target, { headers: { ...UPSTREAM_HEADERS, Accept: 'application/zip, application/octet-stream, */*' }, redirect: 'manual', signal: ctrl.signal });
  } catch (err) {
    throw new HttpError(err && err.name === 'AbortError' ? 504 : 502, err && err.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK', 'OpenDART XBRL 응답 오류');
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 300 && res.status < 400) throw new HttpError(502, 'UPSTREAM_BLOCKED', 'opendart.fss.or.kr 서버가 요청을 거부하고 오류 페이지로 돌려보냈습니다.');
  if (!res.ok) throw new HttpError(502, 'UPSTREAM_' + res.status, `OpenDART HTTP ${res.status}`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (/xml|html|json|text/.test(ct)) {
    const text = (await res.text()).slice(0, 4000);
    const st = (text.match(/<status>\s*(\d{3})\s*<\/status>/) || text.match(/"status"\s*:\s*"(\d{3})"/) || [])[1];
    const msg = ((text.match(/<message>\s*([^<]+)<\/message>/) || text.match(/"message"\s*:\s*"([^"]+)"/) || [])[1] || 'OpenDART 원본 오류').trim();
    if (st === '013' || st === '014') return reply({ status: st, message: msg }, 200);
    if (st && st !== '000') throw new HttpError(['010', '011', '012', '901'].includes(st) ? 401 : 502, 'DART_' + st, msg);
    throw new HttpError(502, 'UPSTREAM_NOT_ZIP', 'OpenDART가 ZIP이 아닌 응답을 보냈습니다.');
  }
  return new Response(res.body, { status: 200, headers: { ...CORS, 'content-type': 'application/zip', 'cache-control': 'private, max-age=86400' } });
}

/* ------------------------------------------------------------------- ECOS */
async function ecosProxy(rest, keys, ctx, budget) {
  // StatisticSearch/{stat}/{cycle}/{start}/{end}/{item1}[/{item2}[/{item3}]]
  const seg = rest.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return ''; } });
  if (seg[0] !== 'StatisticSearch' || seg.length < 6 || seg.length > 8) throw new HttpError(400, 'BAD_ECOS_PATH', 'ECOS 경로 오류');
  if (!seg.slice(1).every((s) => /^[A-Za-z0-9?]{1,20}$/.test(s))) throw new HttpError(400, 'BAD_ECOS_PATH', 'ECOS 경로 오류');
  const tail = seg.slice(1).join('/');
  return cached(ctx, budget, `ecos:${tail}:${await keyFingerprint(keys.ecos)}`, 3 * 3600, async () => {
    const body = await fetchJson(budget, `${ECOS_BASE}StatisticSearch/${encodeURIComponent(need(keys.ecos, 'ECOS'))}/json/kr/1/2000/${tail}`);
    const result = body && (body.RESULT || (body.StatisticSearch && body.StatisticSearch.RESULT));
    if (result && result.CODE && result.CODE !== 'INFO-000' && result.CODE !== 'INFO-200') {
      throw new HttpError(String(result.CODE).startsWith('INFO-1') ? 401 : 502, 'ECOS_' + result.CODE, result.MESSAGE || 'ECOS 오류');
    }
    const rows = (body && body.StatisticSearch && Array.isArray(body.StatisticSearch.row)) ? body.StatisticSearch.row : [];
    return { rows: rows.map((r) => ({ time: r.TIME, value: n(r.DATA_VALUE), unit: r.UNIT_NAME, item: r.ITEM_NAME1 })) };
  });
}

/* ------------------------------------------------------- 종목 투자지표 */
/** 외국인 보유율·PER·PBR 등 — Open KRX·DART에 없는 항목. 네이버 증권 모바일 공개 데이터(비공식)를 사용 */
const numOf = (v) => {
  if (v === undefined || v === null) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
export function parseStockInfo(body) {
  const list = Array.isArray(body && body.totalInfos) ? body.totalInfos : [];
  const find = (codes, keyRe) => list.find((i) => codes.includes(String(i.code || ''))) || list.find((i) => keyRe.test(String(i.key || '')));
  const val = (codes, keyRe) => { const i = find(codes, keyRe); return i ? numOf(i.value) : null; };
  const out = {
    foreignRate: val(['foreignRate'], /외인|외국인/),
    per: val(['per'], /^PER$/i),
    pbr: val(['pbr'], /^PBR$/i),
    eps: val(['eps'], /^EPS$/i),
    bps: val(['bps'], /^BPS$/i),
    cnsPer: val(['cnsPer'], /추정\s*PER/i),
    dividendYield: val(['dividendYieldRatio'], /배당수익률/),
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}
async function stockInfo(url, ctx, budget) {
  const code = String(url.searchParams.get('code') || '').trim();
  if (!/^[0-9A-Z]{6}$/.test(code)) throw new HttpError(400, 'BAD_CODES', '종목코드가 올바르지 않습니다.');
  return cached(ctx, budget, `stockinfo:${code}`, 1800, async () => {
    const body = await fetchJson(budget, `${NAVER_STOCK}${code}/integration`, { headers: { Referer: 'https://m.stock.naver.com/' } }, 12000);
    const info = parseStockInfo(body);
    if (!info) throw new HttpError(502, 'STOCKINFO_EMPTY', '투자지표 응답 형식이 바뀌었거나 비어 있습니다.');
    return { code, source: '네이버 증권', ...info };
  });
}

/* ------------------------------------------------------- 장중 실시간 시세 (KRX 정규장 전용) */
function parseKrWon(v, close = null, volume = null) {
  if (v === undefined || v === null || v === '' || v === '-') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s) return null;
  if (/[조억만천]/.test(s)) {
    let total = 0; let hit = false; let rest = s;
    for (const [u, mul] of [['조', 1e12], ['억', 1e8], ['백만', 1e6], ['만', 1e4], ['천', 1e3]]) {
      const m = rest.match(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*${u}`));
      if (m) { total += Number(m[1]) * mul; rest = rest.replace(m[0], ''); hit = true; }
    }
    return hit ? Math.round(total) : null;
  }
  const x = numOf(s);
  if (x === null) return null;
  if (Number.isFinite(close) && Number.isFinite(volume) && close > 0 && volume > 0) {
    const est = close * volume;
    if (est > 0 && Math.abs(x * 1e6 - est) < Math.abs(x - est)) return Math.round(x * 1e6);
  }
  return Math.round(x);
}
function parseKrQty(v) {
  if (v === undefined || v === null || v === '' || v === '-') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v).replace(/,/g, '').trim();
  const x = numOf(s);
  if (x === null) return null;
  if (/천/.test(s)) return Math.round(x * 1e3);
  if (/만/.test(s)) return Math.round(x * 1e4);
  return Math.round(x);
}
function applySign(val, dirObj) {
  if (val === null || !Number.isFinite(val)) return null;
  const code = String((dirObj && dirObj.code) || '');
  const name = String((dirObj && dirObj.name) || '');
  if (code === '4' || code === '5' || /FALL|LOWER/i.test(name)) return -Math.abs(val);
  if (code === '1' || code === '2' || /RIS|UPPER/i.test(name)) return Math.abs(val);
  if (code === '3' || /UNCHANGED/i.test(name)) return 0;
  return val;
}
function parseTradedAt(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m ? { date: `${m[1]}${m[2]}${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : '' } : { date: '', time: '' };
}
/** KRX 정규장 전용 파서 — NXT 프리/애프터마켓(overMarketPriceInfo)은 절대 사용하지 않음 */
export function parseRealtimeStock(d) {
  if (!d || typeof d !== 'object') return null;
  const code = String(d.itemCode || d.stockCode || d.code || '').trim();
  const close = numOf(d.closePriceRaw !== undefined ? d.closePriceRaw : d.closePrice);
  if (!code || close === null) return null;
  const volume = parseKrQty(d.accumulatedTradingVolumeRaw !== undefined ? d.accumulatedTradingVolumeRaw : d.accumulatedTradingVolume);
  const { date, time } = parseTradedAt(d.localTradedAt);
  return {
    code,
    name: String(d.stockName || d.name || '').trim(),
    date,
    time,
    marketStatus: String(d.marketStatus || '').toUpperCase() || 'CLOSE',
    close,
    change: applySign(numOf(d.compareToPreviousClosePriceRaw !== undefined ? d.compareToPreviousClosePriceRaw : d.compareToPreviousClosePrice), d.compareToPreviousPrice),
    rate: applySign(numOf(d.fluctuationsRatioRaw !== undefined ? d.fluctuationsRatioRaw : d.fluctuationsRatio), d.compareToPreviousPrice),
    open: numOf(d.openPriceRaw !== undefined ? d.openPriceRaw : d.openPrice),
    high: numOf(d.highPriceRaw !== undefined ? d.highPriceRaw : d.highPrice),
    low: numOf(d.lowPriceRaw !== undefined ? d.lowPriceRaw : d.lowPrice),
    volume,
    value: parseKrWon(d.accumulatedTradingValueRaw !== undefined ? d.accumulatedTradingValueRaw : d.accumulatedTradingValue, close, volume),
    mktcap: parseKrWon(d.marketValueRaw !== undefined ? d.marketValueRaw : d.marketValue),
  };
}
export function parseRealtimeIndex(d) {
  if (!d || typeof d !== 'object') return null;
  const code = String(d.itemCode || d.code || '').trim().toUpperCase();
  const close = numOf(d.closePriceRaw !== undefined ? d.closePriceRaw : d.closePrice);
  if (!code || close === null) return null;
  const { date, time } = parseTradedAt(d.localTradedAt);
  return {
    code,
    name: String(d.stockName || d.indexName || d.name || code).trim(),
    date,
    time,
    marketStatus: String(d.marketStatus || '').toUpperCase() || 'CLOSE',
    close,
    change: applySign(numOf(d.compareToPreviousClosePriceRaw !== undefined ? d.compareToPreviousClosePriceRaw : d.compareToPreviousClosePrice), d.compareToPreviousPrice),
    rate: applySign(numOf(d.fluctuationsRatioRaw !== undefined ? d.fluctuationsRatioRaw : d.fluctuationsRatio), d.compareToPreviousPrice),
  };
}
async function stockRealtime(url, ctx, budget) {
  const codes = parseCodes(url);
  const withIndex = url.searchParams.get('index') !== '0';
  const fresh = url.searchParams.get('fresh') === '1';
  const fetchNow = async () => {
    const reqInit = { headers: { Referer: 'https://m.stock.naver.com/' } };
    const [sBody, iBody] = await Promise.all([
      fetchJson(budget, `${NAVER_REALTIME}stock/${codes.join(',')}`, reqInit, 10000),
      withIndex ? fetchJson(budget, `${NAVER_REALTIME}index/KOSPI,KOSDAQ`, reqInit, 10000).catch(() => null) : Promise.resolve(null),
    ]);
    const stocks = (Array.isArray(sBody && sBody.datas) ? sBody.datas : []).map(parseRealtimeStock).filter(Boolean);
    if (!stocks.length) throw new HttpError(502, 'REALTIME_EMPTY', '실시간 시세 응답 형식이 바뀌었거나 비어 있습니다.');
    const idxList = (Array.isArray(iBody && iBody.datas) ? iBody.datas : []).map(parseRealtimeIndex).filter(Boolean);
    const kospi = idxList.find((x) => x.code === 'KOSPI') || null;
    const kosdaq = idxList.find((x) => x.code === 'KOSDAQ') || null;
    const isOpen = stocks.some((s) => s.marketStatus === 'OPEN') || (kospi && kospi.marketStatus === 'OPEN');
    const dates = stocks.map((s) => s.date).filter(Boolean).sort();
    const times = stocks.map((s) => s.time).filter(Boolean).sort();
    return {
      source: '네이버 증권',
      date: dates[dates.length - 1] || (kospi && kospi.date) || '',
      time: times[times.length - 1] || (kospi && kospi.time) || '',
      marketStatus: isOpen ? 'OPEN' : (stocks[0].marketStatus || 'CLOSE'),
      stocks,
      index: { kospi, kosdaq },
    };
  };
  if (fresh) return fetchNow();
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const hhmm = kstNow.getUTCHours() * 100 + kstNow.getUTCMinutes();
  const ttl = !isWeekend(kstToday()) && hhmm >= 900 && hhmm <= 1535 ? 15 : 60;
  return cached(ctx, budget, `realtime:${codes.slice().sort().join(',')}:${withIndex ? 1 : 0}`, ttl, fetchNow);
}

/* ------------------------------------------------------------------ Naver */
async function naverNews(url, keys, ctx, budget) {
  const query = (url.searchParams.get('query') || '').trim();
  if (!query || query.length > 100) throw new HttpError(400, 'BAD_QUERY', '검색어가 올바르지 않습니다.');
  const display = Math.min(100, Math.max(1, Number(url.searchParams.get('display')) || 20));
  const sort = url.searchParams.get('sort') === 'sim' ? 'sim' : 'date';
  // 페이지 이동(기간 조회용): 네이버 검색 API 허용 범위 start 1~1000
  const start = Math.min(1000, Math.max(1, Math.floor(Number(url.searchParams.get('start')) || 1)));
  const qs = new URLSearchParams({ query, display: String(display), sort, ...(start > 1 ? { start: String(start) } : {}) }).toString();
  return cached(ctx, budget, `naver:${qs}:${await keyFingerprint(keys.naverId, keys.naverSecret)}`, 300, async () => {
    const body = await fetchJson(budget, `${NAVER_NEWS}?${qs}`, {
      headers: {
        'X-Naver-Client-Id': need(keys.naverId, 'Naver Client ID'),
        'X-Naver-Client-Secret': need(keys.naverSecret, 'Naver Client Secret'),
      },
    });
    return {
      total: (body && body.total) || 0,
      items: ((body && body.items) || []).map((i) => ({
        title: i.title, link: i.originallink || i.link, naverLink: i.link, description: i.description, pubDate: i.pubDate,
      })),
    };
  });
}

/* ------------------------------------------------------- 외부 API 진단 */
/** 로그인한 사용자만: Worker 출구 위치와 각 외부 API의 실제 응답을 점검(키는 응답에 포함하지 않음) */
async function diagnose(request, keys, budget) {
  const out = { version: VERSION, worker: { colo: (request.cf && request.cf.colo) || null, country: (request.cf && request.cf.country) || null }, egress: null, checks: [] };
  try {
    budget.take();
    const t = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace', { headers: UPSTREAM_HEADERS })).text();
    const kv = Object.fromEntries(t.trim().split('\n').map((l) => l.split('=')));
    out.egress = { ip: kv.ip || null, loc: kv.loc || null, colo: kv.colo || null };
  } catch { /* noop */ }

  async function probe(name, url, init = {}, judge) {
    const started = Date.now();
    try {
      budget.take();
      const res = await fetch(url, { ...init, redirect: 'manual' });
      const loc = (res.headers.get('location') || '').split('?')[0];
      let body = null;
      let text = '';
      if (res.status < 300 || res.status >= 400) { text = await res.text(); try { body = JSON.parse(text); } catch { /* */ } }
      const verdict = res.status >= 300 && res.status < 400 ? { ok: false, note: `차단(리다이렉트 → ${loc || res.status})` } : judge(res, body, text);
      out.checks.push({ name, status: res.status, ms: Date.now() - started, ...verdict });
    } catch (err) {
      out.checks.push({ name, status: 0, ms: Date.now() - started, ok: false, note: String((err && err.message) || err) });
    }
  }
  const day = kstToday();
  const yday = shiftDate(day, -(isWeekend(shiftDate(day, -1)) ? 3 : 1));
  const dartJudge = (r, b) => (b && b.status === '000' ? { ok: true, note: '정상' } : { ok: false, note: b ? `DART ${b.status} ${b.message || ''}` : `JSON 아님(${r.status})` });
  if (keys.dart) {
    // 앱이 실제로 쓰는 요청 방식(브라우저 헤더)으로 키·응답을 확인한다
    const u = `${DART_BASE}company.json?crtfc_key=${encodeURIComponent(keys.dart)}&corp_code=00120030`;
    await probe('OpenDART (인증키·기업개황)', u, { headers: UPSTREAM_HEADERS }, (r, b) => {
      if (b && b.status === '000') return { ok: true, note: `정상 · 인증키 유효 (${b.corp_name || '기업개황'})` };
      if (b && ['010', '011', '012', '901'].includes(b.status)) return { ok: false, note: `인증키 오류 DART ${b.status} ${b.message || ''}` };
      return dartJudge(r, b);
    });
  } else out.checks.push({ name: 'OpenDART', ok: false, note: '키 없음' });
  if (keys.krx) {
    const krxJudge = (r, b) => (b && Array.isArray(b.OutBlock_1) ? { ok: true, note: `정상(${yday} ${b.OutBlock_1.length}행)` }
      : (r.status === 401 || r.status === 403 || /unauthor|auth/i.test(JSON.stringify(b || ''))) ? { ok: false, note: '이용 권한 없음 — openapi.krx.co.kr에서 이 서비스 이용신청 필요' }
        : { ok: false, note: b ? JSON.stringify(b).slice(0, 80) : `JSON 아님(${r.status})` });
    await probe(`Open KRX · ${KRX_SERVICE.KOSPI}`, `${KRX.KOSPI}?basDd=${yday}`, { headers: { ...UPSTREAM_HEADERS, AUTH_KEY: keys.krx } }, krxJudge);
    await probe(`Open KRX · ${KRX_SERVICE.KOSPI_IDX}`, `${KRX.KOSPI_IDX}?basDd=${yday}`, { headers: { ...UPSTREAM_HEADERS, AUTH_KEY: keys.krx } }, krxJudge);
  } else out.checks.push({ name: 'Open KRX', ok: false, note: '키 없음' });
  await probe('네이버 증권 (외국인·PER·PBR)', `${NAVER_STOCK}006360/integration`, { headers: { ...UPSTREAM_HEADERS, Referer: 'https://m.stock.naver.com/' } },
    (r, b) => (parseStockInfo(b) ? { ok: true, note: '정상' } : { ok: false, note: `응답 형식 확인 필요(${r.status})` }));
  await probe('네이버 증권 (실시간 시세)', `${NAVER_REALTIME}stock/006360`, { headers: { ...UPSTREAM_HEADERS, Referer: 'https://m.stock.naver.com/' } },
    (r, b) => {
      const s = Array.isArray(b && b.datas) && b.datas[0] ? parseRealtimeStock(b.datas[0]) : null;
      return s ? { ok: true, note: `정상 (${s.date} ${s.time} · ${s.marketStatus})` } : { ok: false, note: `응답 형식 확인 필요(${r.status})` };
    });
  if (keys.ecos) {
    await probe('한국은행 ECOS', `${ECOS_BASE}StatisticSearch/${encodeURIComponent(keys.ecos)}/json/kr/1/5/722Y001/D/${shiftDate(day, -20)}/${day}/0101000`, { headers: UPSTREAM_HEADERS },
      (r, b) => (b && b.StatisticSearch ? { ok: true, note: '정상' } : { ok: false, note: b && b.RESULT ? `${b.RESULT.CODE} ${b.RESULT.MESSAGE || ''}` : `JSON 아님(${r.status})` }));
  } else out.checks.push({ name: '한국은행 ECOS', ok: false, note: '키 없음' });
  if (keys.naverId && keys.naverSecret) {
    await probe('네이버 뉴스', `${NAVER_NEWS}?query=${encodeURIComponent('GS건설')}&display=1`, { headers: { ...UPSTREAM_HEADERS, 'X-Naver-Client-Id': keys.naverId, 'X-Naver-Client-Secret': keys.naverSecret } },
      (r, b) => (b && Array.isArray(b.items) ? { ok: true, note: '정상' } : { ok: false, note: b ? `${b.errorCode || ''} ${b.errorMessage || ''}` : `JSON 아님(${r.status})` }));
  } else out.checks.push({ name: '네이버 뉴스', ok: false, note: '키 없음' });
  const hide = (t) => { let x = scrub(t); for (const v of Object.values(keys)) if (v && v.length >= 6) x = x.split(v).join('***'); return x; };
  out.checks = out.checks.map((c) => ({ ...c, note: hide(c.note) }));
  return out;
}
