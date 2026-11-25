/* 저장 기간(TTL) 정책 — 데이터가 앞으로 바뀔 수 있는지에 따라 결정 (순수 함수, 테스트 대상) */
export const MIN = 60e3;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function kstYmd(now = Date.now(), offsetDays = 0) {
  return new Date(now + 9 * HOUR + offsetDays * DAY).toISOString().slice(0, 10).replace(/-/g, '');
}

/** 과거 확정 거래일인가(오늘·어제는 아직 확정/공표 전일 수 있어 제외) */
export const isSettledDay = (ymd, now = Date.now()) => /^\d{8}$/.test(ymd) && ymd < kstYmd(now, -1);

const REPRT_Q = { 11013: 1, 11012: 2, 11014: 3, 11011: 4 };
const quarterEnd = (y, q) => `${y}${['', '0331', '0630', '0930', '1231'][q]}`;

/**
 * 저장 기간(ms). 0 = 저장하지 않음.
 * @param {string} path  /api/... 경로
 * @param {object} params 쿼리 파라미터
 * @param {any} data      응답
 */
export function ttlFor(path, params = {}, data = null, now = Date.now()) {
  if (path === '/api/health' || path === '/api/diag' || path === '/api/ping' || path === '/api/stock/realtime') return 0;
  if (path === '/api/krx/snapshot') {
    // 날짜를 지정한 과거 스냅샷(분기말 주가 등)은 확정값 → 장기 보관
    return params.date && isSettledDay(params.date, now) ? 365 * DAY : 20 * MIN;
  }
  if (path === '/api/krx/series') {
    const ds = String(params.dates || '').split(',').filter(Boolean);
    return ds.length && ds.every((d) => isSettledDay(d, now)) ? 365 * DAY : 20 * MIN;
  }
  if (path === '/api/naver/news') return 5 * MIN;
  if (path === '/api/stock/info') return 30 * MIN;
  if (path.startsWith('/api/ecos/')) return 3 * HOUR;
  if (path.startsWith('/api/dart/')) {
    const ep = path.slice('/api/dart/'.length);
    if (ep === 'list.json') return 10 * MIN;
    if (ep === 'company.json') return 7 * DAY;
    if (/^(fnlttSinglAcntAll|fnlttSinglAcnt|fnlttMultiAcnt|stockTotqySttus|fnlttSinglIndx|hyslrSttus|mrhlSttus|empSttus|exctvSttus|cprndNrdmpBlce|srtpdPsndbtNrdmpBlce|entrprsBilScritsNrdmpBlce|newCaplScritsNrdmpBlce|cndlCaplScritsNrdmpBlce|detScritsIsuAcmslt|alotMatter|tesstkAcqsDspsSttus|accnutAdtorNmNdAdtOpinion)\.json$/.test(ep)) {
      if (!data || data.status === '013') return 6 * HOUR; // 미공시: 공시되면 곧 반영되도록 짧게
      if (data.status && data.status !== '000') return 0;
      const q = REPRT_Q[params.reprt_code];
      const y = +params.bsns_year;
      if (!q || !y) return DAY;
      const end = quarterEnd(y, q);
      // 기간 종료 후 15개월 지난 보고서는 정정 가능성이 낮아 장기 보관, 최근 보고서는 1일
      return end < kstYmd(now, -456) ? 180 * DAY : DAY;
    }
    return 6 * HOUR;
  }
  return 10 * MIN;
}

/** 강제 새로고침 시에도 다시 받지 않아도 되는 확정 데이터인가 */
export const isImmutable = (ttl) => ttl >= 30 * DAY;

/** 캐시 키: 경로 + 정렬된 파라미터 (인증키 등 비밀값은 키에 포함되지 않음) */
export function cacheKey(path, params = {}) {
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  return `${path}?${qs}`;
}

/* ---------------------------------------------- ECOS 구간 증분 병합 (순수 함수) */
/**
 * 저장 구간과 요청 구간을 비교해 새로 받아야 할 구간을 계산.
 * - 앞쪽(더 과거) 부족분: [start, from−1]
 * - 뒤쪽: 저장본이 오래되었거나 요청 끝이 저장 끝보다 뒤면 [to − 10일, end] (최근값 수정 반영)
 */
export function ecosMissing(entry, start, end, now = Date.now(), maxAge = 3 * HOUR) {
  if (!entry) return [[start, end]];
  const need = [];
  if (start < entry.from) need.push([start, shift(entry.from, -1)]);
  const stale = now - entry.fetchedAt > maxAge;
  if (end > entry.to || stale) {
    const tailStart = maxYmd(entry.from, shift(entry.to, -10));
    need.push([start > tailStart ? start : tailStart, end]);
  }
  return need;
}
export function ecosMerge(entry, parts, start, end, now = Date.now()) {
  const map = new Map((entry?.rows || []).map((r) => [r.time, r]));
  for (const rows of parts) for (const r of rows) map.set(r.time, r); // 새 값이 우선(수정치 반영)
  const rows = [...map.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return {
    from: entry ? (start < entry.from ? start : entry.from) : start,
    to: entry ? (end > entry.to ? end : entry.to) : end,
    fetchedAt: now,
    rows,
  };
}
export const ecosSlice = (entry, start, end) => entry.rows.filter((r) => String(r.time) >= start && String(r.time) <= end);

function shift(ymd, days) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
const maxYmd = (a, b) => (a > b ? a : b);

/* ---------------------------------------------- 백업 파일 검증 (순수 함수) */
export const BACKUP_FORMAT = 1;
export const BACKUP_MAX_BYTES = 80 * 1024 * 1024;
export const BACKUP_MAX_ENTRIES = 20000;
/* 복원 허용 키: 조회 응답·시계열·XBRL 요약만(설정·키·로그인 정보는 저장소에 없고 복원도 불가) */
const BACKUP_KEY = /^(\/api\/(krx|dart|ecos|stock)\/[^?]{1,80}\?[^]{0,600}|krx:[A-Z0-9]{1,8}:\d{8}|ecos:[\w|?]{1,80}|xbrl(-idx|-na)?:[\w:.-]{1,120})$/;
/**
 * 백업 JSON 검증 → { ok, entries, skipped, reason }
 * - 형식: { app:'IDF', format:1, entries:[{k,data,exp,ttl,at}] }
 * - 허용 키·타입·유효기간(최대 10년) 검사, 상한 초과분은 거부
 */
export function validateBackup(obj, now = Date.now(), byteSize = 0) {
  if (byteSize > BACKUP_MAX_BYTES) return { ok: false, reason: '백업 파일이 너무 큽니다(80MB 초과).' };
  if (!obj || obj.app !== 'IDF' || obj.format !== BACKUP_FORMAT || !Array.isArray(obj.entries)) return { ok: false, reason: 'IDF 백업 파일 형식이 아닙니다.' };
  if (obj.entries.length > BACKUP_MAX_ENTRIES) return { ok: false, reason: `항목이 너무 많습니다(${BACKUP_MAX_ENTRIES.toLocaleString('ko-KR')}건 초과).` };
  const entries = []; let skipped = 0;
  const MAX_TTL = 10 * 365 * DAY;
  for (const e of obj.entries) {
    const good = e && typeof e.k === 'string' && BACKUP_KEY.test(e.k) && 'data' in e && e.data !== undefined
      && Number.isFinite(e.exp) && Number.isFinite(e.ttl) && e.ttl > 0 && e.ttl <= MAX_TTL && Number.isFinite(e.at) && e.at <= now + DAY;
    if (!good) { skipped += 1; continue; }
    entries.push({ k: e.k, data: e.data, ttl: e.ttl, at: e.at, exp: Math.min(e.exp, e.at + e.ttl) });
  }
  return { ok: true, entries, skipped };
}
