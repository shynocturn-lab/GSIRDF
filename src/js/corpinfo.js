/* 회사 정보 — OpenDART 기업개황 + 정기보고서 주요정보(주식총수·최대주주·소액주주·직원·임원)
 * 참고: https://opendart.fss.or.kr/guide (DS001 공시정보 / DS002 정기보고서 주요정보) */
import { api } from './api.js';

export const REPRT = { 1: '11013', 2: '11012', 3: '11014', 4: '11011' };
export const REPRT_NAME = { 1: '1분기보고서', 2: '반기보고서', 3: '3분기보고서', 4: '사업보고서' };
const CORP_CLS = { Y: '유가증권시장', K: '코스닥', N: '코넥스', E: '기타(비상장)' };

export const num = (v) => {
  if (v === undefined || v === null) return null;
  const t = String(v).replace(/,/g, '').trim();
  if (!t || t === '-') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};
const s = (v) => { const t = String(v ?? '').trim(); return t && t !== '-' ? t : ''; };

/** 기업개황(company.json) */
export function parseCompany(b) {
  if (!b || b.status !== '000') return null;
  const ymd = (d) => (/^\d{8}$/.test(d || '') ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : s(d));
  const url = (u) => { const t = s(u); if (!t) return ''; const full = /^https?:\/\//i.test(t) ? t : `https://${t}`; try { const x = new URL(full); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : ''; } catch { return ''; } };
  return {
    name: s(b.corp_name), eng: s(b.corp_name_eng), stockName: s(b.stock_name), stockCode: s(b.stock_code),
    ceo: s(b.ceo_nm), market: CORP_CLS[b.corp_cls] || s(b.corp_cls), jurir: s(b.jurir_no), bizr: s(b.bizr_no),
    address: s(b.adres), homepage: url(b.hm_url), ir: url(b.ir_url), phone: s(b.phn_no),
    induty: s(b.induty_code), established: ymd(b.est_dt), fiscalMonth: s(b.acc_mt) ? `${+b.acc_mt}월` : '',
  };
}

/** 최대주주 및 특수관계인(hyslrSttus.json): 기말 보유 기준. '계' 행은 합계로 분리 */
export function parseMajor(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list)) return null;
  const rows = b.list.map((r) => ({
    name: s(r.nm), relate: s(r.relate), kind: s(r.stock_knd),
    shares: num(r.trmend_posesn_stock_co), rate: num(r.trmend_posesn_stock_qota_rt),
    begin: num(r.bsis_posesn_stock_qota_rt), note: s(r.rm),
  }));
  const isTotal = (r) => /^(계|합계|소계)$/.test(r.name.replace(/\s/g, '')) || /^계/.test(r.relate);
  const total = rows.filter(isTotal);
  const holders = rows.filter((r) => !isTotal(r) && r.name);
  // 같은 사람이 보통주·우선주 2행일 수 있음 → 보통주 우선 정렬 후 지분율 내림차순
  holders.sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
  const common = total.find((r) => /보통/.test(r.kind)) || total[0] || null;
  const sumRate = common?.rate ?? holders.filter((r) => /보통/.test(r.kind) || !r.kind).reduce((t, r) => t + (r.rate || 0), 0);
  return { holders, totalRate: sumRate || null, largest: holders[0] || null, rcept: b.list[0]?.rcept_no || '' };
}

/** 소액주주(mrhlSttus.json) */
export function parseMinority(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list) || !b.list.length) return null;
  const r = b.list.find((x) => /소액/.test(x.se || '')) || b.list[0];
  return {
    holders: num(r.shrholdr_co), holdersTotal: num(r.shrholdr_tot_co), holderRate: num(String(r.shrholdr_rate || '').replace('%', '')),
    shares: num(r.hold_stock_co), sharesTotal: num(r.stock_tot_co), shareRate: num(String(r.hold_stock_rate || '').replace('%', '')),
  };
}

/** 직원 현황(empSttus.json): 사업부문·성별 행 합산 */
export function parseEmployees(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list) || !b.list.length) return null;
  const rows = b.list.filter((r) => !/^(합계|계|총계|전체)$/.test(String(r.fo_bbm || '').replace(/\s/g, '')) && !/합계|총계/.test(r.sexdstn || ''));
  const use = rows.length ? rows : b.list;
  const add = (k) => { const v = use.map((r) => num(r[k])).filter((x) => x !== null); return v.length ? v.reduce((a, c) => a + c, 0) : null; };
  const regular = add('rgllbr_co');
  const contract = add('cnttk_co');
  let total = add('sm');
  if (total === null && (regular !== null || contract !== null)) total = (regular || 0) + (contract || 0);
  const salaryTotal = add('fyer_salary_totamt');
  const bySex = {};
  use.forEach((r) => { const k = /여/.test(r.sexdstn || '') ? 'female' : /남/.test(r.sexdstn || '') ? 'male' : null; if (k) bySex[k] = (bySex[k] || 0) + (num(r.sm) || 0); });
  // 평균 근속·1인 평균급여: 인원 가중 평균
  const wavg = (k) => {
    let w = 0; let t = 0;
    use.forEach((r) => { const v = num(String(r[k] || '').replace(/[^\d.,-]/g, '')); const n = num(r.sm); if (v !== null && n) { w += n; t += v * n; } });
    return w ? t / w : null;
  };
  const segments = [...new Set(use.map((r) => s(r.fo_bbm)).filter(Boolean))];
  return { total, regular, contract, male: bySex.male ?? null, female: bySex.female ?? null, tenure: wavg('avrg_cnwk_sdytrn'), avgSalary: wavg('jan_salary_am'), salaryTotal, segments };
}

/** 임원 현황(exctvSttus.json): 등기·미등기 인원 + 등기임원 명단 */
export function parseExecutives(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list)) return null;
  const list = b.list.map((r) => ({ name: s(r.nm), position: s(r.ofcps), registered: !!s(r.rgist_exctv_at) && !/미등기/.test(r.rgist_exctv_at), fulltime: s(r.fte_at), job: s(r.chrg_job) }));
  const reg = list.filter((x) => x.registered);
  return { total: list.length, registered: reg.length, unregistered: list.length - reg.length, board: reg };
}

/** 주식의 총수(stockTotqySttus.json) */
export function parseShares(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list)) return null;
  const row = (re) => b.list.find((r) => re.test(r.se || ''));
  const t = row(/합계/) || row(/보통/);
  if (!t) return null;
  const common = row(/보통/);
  const pref = row(/우선/);
  return {
    issued: num(t.istc_totqy), treasury: num(t.tesstk_co), floating: num(t.distb_stock_co),
    authorized: num(t.isu_stock_totqy), common: common ? num(common.istc_totqy) : null, preferred: pref ? num(pref.istc_totqy) : null,
  };
}

const ENDPOINTS = { shares: ['stockTotqySttus', parseShares], major: ['hyslrSttus', parseMajor], minority: ['mrhlSttus', parseMinority], employees: ['empSttus', parseEmployees], executives: ['exctvSttus', parseExecutives] };

/** 정기보고서 항목: 선택 분기부터 최대 4개 분기 거슬러 올라가며 가장 최근 공시값 사용 */
async function periodic(corp, y, q, endpoint, parse) {
  for (let i = 0, yy = y, qq = q; i < 4; i += 1, qq === 1 ? (yy -= 1, qq = 4) : (qq -= 1)) {
    const b = await api.dart(endpoint, { corp_code: corp, bsns_year: yy, reprt_code: REPRT[qq] });
    if (b?.status === '013') continue;
    const v = parse(b);
    if (v) return { ...v, period: { y: yy, q: qq, name: `${yy} ${REPRT_NAME[qq]}` } };
    if (b?.status === '000') continue;
    return null;
  }
  return null;
}

/** 회사 정보 일괄 조회. 각 항목은 실패해도 나머지는 표시(항목별 error) */
export async function fetchCorpInfo(corp, y, q) {
  const tasks = { company: api.dart('company', { corp_code: corp }).then(parseCompany) };
  for (const [k, [ep, parse]] of Object.entries(ENDPOINTS)) tasks[k] = periodic(corp, y, q, ep, parse);
  const keys = Object.keys(tasks);
  const res = await Promise.allSettled(keys.map((k) => tasks[k]));
  const out = {};
  keys.forEach((k, i) => { out[k] = res[i].status === 'fulfilled' ? res[i].value : { error: res[i].reason }; });
  return out;
}

/* ================================================================
 * 자금조달 · 주주환원 · 감사 (DS002 정기보고서 주요정보 — 엔드포인트명은 OpenDART/dart-fss 기준)
 * ================================================================ */

/** 만기 구간 필드명 → 한글 (예: yy1_excess_yy2_below → 1년 초과~2년 이하) */
export function bucketLabel(key) {
  const unit = { de: '일', yy: '년' };
  const tok = (t) => { const m = /^(de|yy)(\d+)$/.exec(t); return m ? `${m[2]}${unit[m[1]]}` : t; };
  let m = /^(de|yy)(\d+)_below$/.exec(key);
  if (m) return `${tok(m[1] + m[2])} 이하`;
  m = /^((?:de|yy)\d+)_excess_((?:de|yy)\d+)_below$/.exec(key);
  if (m) return `${tok(m[1])} 초과~${tok(m[2])} 이하`;
  m = /^((?:de|yy)\d+)_excess$/.exec(key);
  if (m) return `${tok(m[1])} 초과`;
  return null;
}
const BUCKET_RE = /^(de|yy)\d+(_excess(_(de|yy)\d+_below)?|_below)$/;

/** 미상환 잔액(회사채·단기사채·기업어음·신종자본·조건부자본) 공통 파서 → 합계 행 기준 */
export function parseBalance(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list) || !b.list.length) return null;
  const rows = b.list.map((r) => ({
    kind: [s(r.remndr_exprtn1), s(r.remndr_exprtn2)].filter(Boolean).join(' · '),
    buckets: Object.keys(r).filter((k) => BUCKET_RE.test(k)).map((k) => ({ key: k, label: bucketLabel(k), value: num(r[k]) })),
    total: num(r.sm),
    limit: num(r.isu_lmt), remain: num(r.remndr_lmt),
  }));
  const tot = rows.find((r) => /합계/.test(r.kind)) || rows.find((r) => /미상환/.test(r.kind)) || rows[rows.length - 1];
  const total = tot.total ?? (tot.buckets.some((x) => x.value !== null) ? tot.buckets.reduce((a, x) => a + (x.value || 0), 0) : null);
  return { total, buckets: tot.buckets, rows, limit: tot.limit ?? null, remain: tot.remain ?? null, rcept: b.list[0]?.rcept_no || '' };
}

/** 채무증권 발행실적(detScritsIsuAcmslt) — 최근 발행순 */
export function parseIssuance(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list)) return null;
  const list = b.list.map((r) => ({
    company: s(r.isu_cmpny), kind: s(r.scrits_knd_nm), method: s(r.isu_mth_nm), date: s(r.isu_de),
    amount: num(r.facvalu_totamt), rate: s(r.intrt), grade: s(r.evl_grad_instt), maturity: s(r.mtd), repaid: s(r.repy_at), manager: s(r.mngt_cmpny),
  })).filter((x) => x.kind || x.amount !== null);
  list.sort((a, b2) => String(b2.date).localeCompare(String(a.date)));
  return { list, total: list.reduce((a, x) => a + (x.amount || 0), 0) };
}

/** 배당에 관한 사항(alotMatter) — 구분별 당기·전기·전전기 */
export function parseDividends(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list) || !b.list.length) return null;
  const rows = b.list.map((r) => ({ item: s(r.se), stock: s(r.stock_knd), cur: s(r.thstrm), prev: s(r.frmtrm), prev2: s(r.lwfr) })).filter((r) => r.item);
  const find = (re, stockRe) => rows.find((r) => re.test(r.item.replace(/\s/g, '')) && (!stockRe || !r.stock || stockRe.test(r.stock)));
  return {
    rows,
    dps: find(/주당현금배당금/, /보통/)?.cur ?? null,
    payout: find(/현금배당성향/)?.cur ?? null,
    yield: find(/현금배당수익률/, /보통/)?.cur ?? null,
    total: find(/현금배당금총액/)?.cur ?? null,
  };
}

/** 자기주식 취득 및 처분 현황(tesstkAcqsDspsSttus) — 총계 행 */
export function parseTreasury(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list) || !b.list.length) return null;
  const isTot = (r) => /총계|합계/.test(`${s(r.acqs_mth1)}${s(r.acqs_mth2)}${s(r.acqs_mth3)}`);
  const common = (r) => !r.stock_knd || /보통/.test(r.stock_knd);
  const t = b.list.find((r) => isTot(r) && common(r)) || b.list.find(isTot) || null;
  if (!t) return null;
  return { begin: num(t.bsis_qy), acquired: num(t.change_qy_acqs), disposed: num(t.change_qy_dsps), retired: num(t.change_qy_incnr), end: num(t.trmend_qy), stock: s(t.stock_knd) };
}

/** 회계감사인의 명칭 및 감사의견(accnutAdtorNmNdAdtOpinion) */
export function parseAuditor(b) {
  if (!b || b.status !== '000' || !Array.isArray(b.list) || !b.list.length) return null;
  const rows = b.list.map((r) => ({
    year: s(r.bsns_year), auditor: s(r.adtor), opinion: s(r.adt_opinion),
    emphasis: s(r.emphs_matter) || s(r.adt_reprt_spcmnt_matter), kam: s(r.core_adt_matter),
  })).filter((r) => r.auditor || r.opinion);
  return rows.length ? { rows, latest: rows[0] } : null;
}

const FUNDING = {
  bonds: ['cprndNrdmpBlce', parseBalance],
  shortBonds: ['srtpdPsndbtNrdmpBlce', parseBalance],
  cp: ['entrprsBilScritsNrdmpBlce', parseBalance],
  hybrid: ['newCaplScritsNrdmpBlce', parseBalance],
  contingent: ['cndlCaplScritsNrdmpBlce', parseBalance],
  issuance: ['detScritsIsuAcmslt', parseIssuance],
  dividends: ['alotMatter', parseDividends],
  treasury: ['tesstkAcqsDspsSttus', parseTreasury],
  auditor: ['accnutAdtorNmNdAdtOpinion', parseAuditor],
};
export const FUNDING_ENDPOINTS = Object.fromEntries(Object.entries(FUNDING).map(([k, [ep]]) => [k, ep]));

/** 자금조달·주주환원·감사 일괄 조회(항목별 실패 허용, 선택 분기 없으면 직전 공시) */
export async function fetchFunding(corp, y, q) {
  const keys = Object.keys(FUNDING);
  const res = await Promise.allSettled(keys.map((k) => periodic(corp, y, q, FUNDING[k][0], FUNDING[k][1])));
  const out = {};
  keys.forEach((k, i) => { out[k] = res[i].status === 'fulfilled' ? res[i].value : { error: res[i].reason }; });
  return out;
}
