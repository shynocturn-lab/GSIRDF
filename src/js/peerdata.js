/* 동종사 비교 데이터 엔진 — OpenDART 전체 재무제표(fnlttSinglAcntAll) + KRX 분기말 시세
 * 산식·계정 매핑은 GS IR DataFactory v30 동종사 대시보드와 동일한 원칙을 따른다:
 *  - 손익(Flow): 1~N분기 연속 선택은 N분기 누적값 직접 사용, 비연속은 단독분기 합산(Q4 = 연간 − 3분기 누적)
 *  - 재무상태(Stock): 선택 마지막 분기말 잔액(합산하지 않음)
 *  - 비율: 같은 출처 금액으로 재계산(평균·합산 금지), 분모 0·결측은 N/A
 *  - 결측은 0으로 바꾸지 않는다. 대체 출처를 쓰면 반드시 표시한다.
 */
import { api, onForceRefresh } from './api.js';
import { COMPANIES } from './config.js';
import { savedXbrl, loadXbrl, depTotal } from './xbrl.js';

export const REPRT = { 1: '11013', 2: '11012', 3: '11014', 4: '11011' };
const REPRT_NAME = { 1: '1분기보고서', 2: '반기보고서', 3: '3분기보고서', 4: '사업보고서' };

/* ------------------------------------------------------------ 지표 정의 */
export const DEFS = {};
const def = (key, label, type, group) => { DEFS[key] = { key, label, type, group }; };
[['revenue', '매출액'], ['cost', '매출원가'], ['gp', '매출총이익'], ['sga', '판매관리비'], ['op', '영업이익'], ['pretax', '세전이익'], ['net', '당기순이익'], ['attributable', '당기순이익(지배)'], ['netInterest', '순이자비용'], ['ebitda', 'EBITDA'], ['cfo', '영업활동 현금흐름']].forEach(([k, l]) => def(k, l, 'money', '손익·CF'));
[['assets', '자산총계'], ['liabilities', '부채총계'], ['equity', '자본총계'], ['parentEquity', '자본(지배)'], ['cash', '현금 및 현금성자산'], ['shortFinancial', '단기금융상품'], ['borrow', '총차입금(리스 포함)'], ['netBorrow', '순차입금(리스 포함)'], ['shortRepayBurden', '단기상환부담액']].forEach(([k, l]) => def(k, l, 'money', '재무상태표'));
[['costRatio', '매출원가율'], ['gpm', '매출총이익률'], ['margin', '영업이익률'], ['netMargin', '순이익률'], ['roe', 'ROE'], ['roa', 'ROA'], ['debtRatio', '부채비율'], ['currentRatio', '유동비율'], ['equityRatio', '자기자본비율'], ['borrowDep', '차입금의존도'], ['currentDebtRatio', '유동부채비율'], ['nonCurrentDebtRatio', '비유동부채비율'], ['borrowToEquity', '차입금/자기자본']].forEach(([k, l]) => def(k, l, 'percent', '재무비율'));
[['borrowEbitda', '차입금/EBITDA'], ['netEbitda', '순차입금/EBITDA'], ['interestCover', '이자보상배율'], ['per', 'PER(참고)'], ['pbr', 'PBR(참고)']].forEach(([k, l]) => def(k, l, 'multiple', '재무·주가배수'));
[['price', '기말주가'], ['eps', 'EPS(참고)'], ['bps', 'BPS(참고)']].forEach(([k, l]) => def(k, l, 'won', '주가정보'));
def('marketCap', '기말 시가총액', 'money', '주가정보');

export const PNL_CARDS = ['revenue', 'costRatio', 'op', 'sga', 'netInterest', 'margin'];
export const PNL_EXTRA = ['gp', 'pretax', 'net', 'ebitda', 'cfo'];
export const FIN_CARDS = ['netBorrow', 'debtRatio', 'borrowDep', 'roe', 'roa', 'interestCover', 'borrowEbitda', 'netEbitda', 'eps', 'per', 'pbr', 'borrow'];

/* ---------------------------------------------- 계정 매핑 (XBRL ID 우선 → 계정명) */
const MAP = {
  revenue: ['PL', ['ifrs-full_Revenue', 'ifrs_Revenue'], ['매출액', '수익(매출액)', '영업수익', '매출']],
  cost: ['PL', ['ifrs-full_CostOfSales', 'ifrs_CostOfSales'], ['매출원가', '영업비용']],
  gpDirect: ['PL', ['ifrs-full_GrossProfit', 'ifrs_GrossProfit'], ['매출총이익', '매출총이익(손실)']],
  sga: ['PL', ['dart_TotalSellingGeneralAdministrativeExpenses', 'ifrs-full_SellingGeneralAndAdministrativeExpense'], ['판매비와관리비', '판매비및관리비', '판매관리비']],
  op: ['PL', ['dart_OperatingIncomeLoss', 'ifrs-full_ProfitLossFromOperatingActivities'], ['영업이익', '영업이익(손실)', '영업손익']],
  pretax: ['PL', ['ifrs-full_ProfitLossBeforeTax', 'ifrs_ProfitLossBeforeTax'], ['법인세비용차감전순이익', '법인세비용차감전순이익(손실)', '법인세차감전순이익', '법인세비용차감전계속사업이익']],
  net: ['PL', ['ifrs-full_ProfitLoss', 'ifrs_ProfitLoss'], ['당기순이익', '당기순이익(손실)', '분기순이익', '분기순이익(손실)', '반기순이익', '반기순이익(손실)']],
  attributable: ['PL', ['ifrs-full_ProfitLossAttributableToOwnersOfParent'], ['지배기업소유주지분순이익', '지배기업의소유주에게귀속되는당기순이익', '지배기업의소유주에게귀속되는당기순이익(손실)', '지배기업소유주지분']],
  interestIncomePL: ['PL', ['ifrs-full_InterestIncome', 'ifrs-full_RevenueFromInterest'], ['이자수익']],
  interestCostPL: ['PL', ['ifrs-full_InterestExpense'], ['이자비용']],
  assets: ['BS', ['ifrs-full_Assets', 'ifrs_Assets'], ['자산총계']],
  liabilities: ['BS', ['ifrs-full_Liabilities', 'ifrs_Liabilities'], ['부채총계']],
  equity: ['BS', ['ifrs-full_Equity', 'ifrs_Equity'], ['자본총계']],
  parentEquity: ['BS', ['ifrs-full_EquityAttributableToOwnersOfParent'], ['지배기업의소유주에게귀속되는자본', '지배기업소유주지분', '지배기업의소유지분']],
  currentAssets: ['BS', ['ifrs-full_CurrentAssets'], ['유동자산']],
  currentLiabilities: ['BS', ['ifrs-full_CurrentLiabilities'], ['유동부채']],
  nonCurrentLiabilities: ['BS', ['ifrs-full_NoncurrentLiabilities'], ['비유동부채']],
  cash: ['BS', ['ifrs-full_CashAndCashEquivalents'], ['현금및현금성자산']],
  shortFinancial: ['BS', ['dart_ShortTermDepositsNotClassifiedAsCashEquivalents'], ['단기금융상품']],
  shortFinancialAsset: ['BS', ['ifrs-full_OtherCurrentFinancialAssets'], ['단기금융자산', '단기금융상품및단기금융자산', '유동금융상품', '단기예치금', '기타단기금융자산']],
  shortBorrow: ['BS', ['ifrs-full_ShorttermBorrowings'], ['단기차입금', '단기사채']],
  currentLongBorrow: ['BS', ['ifrs-full_CurrentPortionOfLongtermBorrowings'], ['유동성장기차입금', '유동성장기부채']],
  currentBonds: ['BS', ['dart_CurrentPortionOfBonds'], ['유동성사채']],
  currentLease: ['BS', ['ifrs-full_CurrentLeaseLiabilities'], ['유동리스부채', '유동성리스부채']],
  longBorrow: ['BS', ['ifrs-full_LongtermBorrowings', 'dart_LongTermBorrowingsGross'], ['장기차입금']],
  bonds: ['BS', ['dart_BondsIssued', 'ifrs-full_BondsIssued'], ['사채']],
  longLease: ['BS', ['ifrs-full_NoncurrentLeaseLiabilities'], ['비유동리스부채', '리스부채']],
  cfo: ['CF', ['ifrs-full_CashFlowsFromUsedInOperatingActivities'], ['영업활동현금흐름', '영업활동으로인한현금흐름', '영업활동순현금흐름']],
  interestPaidCF: ['CF', ['ifrs-full_InterestPaidClassifiedAsOperatingActivities', 'ifrs-full_InterestPaidClassifiedAsFinancingActivities'], ['이자의지급', '이자지급', '이자의지급액']],
  interestRecvCF: ['CF', ['ifrs-full_InterestReceivedClassifiedAsOperatingActivities', 'ifrs-full_InterestReceivedClassifiedAsInvestingActivities'], ['이자의수취', '이자수취', '이자의수취액']],
  depTotal: ['CF', ['ifrs-full_DepreciationAndAmortisationExpense'], ['감가상각비및상각비', '감가상각비와상각비']],
  dep: ['CF', ['ifrs-full_DepreciationExpense'], ['감가상각비', '유형자산감가상각비']],
  amort: ['CF', ['ifrs-full_AmortisationExpense'], ['무형자산상각비']],
  invDep: ['CF', [], ['투자부동산감가상각비']],
  leaseDep: ['CF', [], ['사용권자산상각비', '사용권자산감가상각비']],
  incomeTax: ['PL', ['ifrs-full_IncomeTaxExpenseContinuingOperations'], ['법인세비용', '법인세비용(수익)', '법인세수익(비용)']],
  nciNet: ['PL', ['ifrs-full_ProfitLossAttributableToNoncontrollingInterests'], ['비지배지분순이익', '비지배지분에귀속되는당기순이익', '비지배지분에귀속되는당기순이익(손실)', '비지배지분']],
  nciEquity: ['BS', ['ifrs-full_NoncontrollingInterests'], ['비지배지분']],
  epsBasic: ['PL', ['ifrs-full_BasicEarningsLossPerShare'], ['기본주당이익', '기본주당이익(손실)', '기본주당순이익', '기본주당순이익(손실)', '기본및희석주당이익', '기본및희석주당이익(손실)']],
};

/* ---------------------------------------- 계정명 패턴 로직 (정확한 계정명이 없을 때) */
const EX_BORROW = /(이자|충당|미지급|보증|전환권|상환권|파생|조정|할인|할증|비율|채권|대여|손실|이익|부채합계)/;
const SUBTOTAL_BORROW = /^(총|순)?차입금(합계|총계)?$/;
/** 재무상태표 부채 중 차입금·사채·리스부채 성격 계정(결합 계정 포함) */
export function borrowRows(rows) {
  return rows.filter((r) => r.sj_div === 'BS' && /(차입금|사채|리스부채)/.test(clean(r.account_nm)) && !EX_BORROW.test(clean(r.account_nm)));
}
/** 현금흐름표 감가상각·상각비(총계 계정이 있으면 그것만) */
export function depRows(rows) {
  const c = rows.filter((r) => r.sj_div === 'CF' && /(감가상각|상각비)/.test(clean(r.account_nm)) && !/(대손|환입|손상|처분|손실|이익|누계|할인|할증|사채|금융|이자|전환|리스부채|충당)/.test(clean(r.account_nm)));
  const total = c.filter((r) => /및|와/.test(clean(r.account_nm)));
  return total.length === 1 ? total : c.filter((r) => !/및|와/.test(clean(r.account_nm)));
}
/** 이자비용(손익)·이자지급/수취(현금흐름) 패턴 — 리스이자·퇴직급여순이자 등 하위 항목 제외 */
const EX_INT_SUB = /(외|제외|리스|충당|복구|퇴직|확정급여|사채할인|할인차금|자본화|미지급|기타|전환)/;
export const interestRows = {
  costPL: (rows) => rows.filter((r) => ['IS', 'CIS'].includes(r.sj_div) && /이자비용/.test(clean(r.account_nm)) && !EX_INT_SUB.test(clean(r.account_nm))),
  paidCF: (rows) => rows.filter((r) => r.sj_div === 'CF' && /이자/.test(clean(r.account_nm)) && /(지급|지출|납부)/.test(clean(r.account_nm)) && !/(배당|리스|미지급)/.test(clean(r.account_nm))),
  recvCF: (rows) => rows.filter((r) => r.sj_div === 'CF' && /이자/.test(clean(r.account_nm)) && /(수취|수입|수령)/.test(clean(r.account_nm)) && !/(배당|리스|미수)/.test(clean(r.account_nm))),
};
const BORROW_PARTS = ['shortBorrow', 'currentLongBorrow', 'currentBonds', 'currentLease', 'longBorrow', 'bonds', 'longLease'];
const FLOW = new Set(['revenue', 'cost', 'gpDirect', 'sga', 'op', 'pretax', 'net', 'attributable', 'interestIncomePL', 'interestCostPL', 'cfo', 'interestPaidCF', 'interestRecvCF', 'depTotal', 'dep', 'amort', 'invDep', 'leaseDep']);

const num = (x) => {
  const t = String(x ?? '').replace(/,/g, '').trim();
  return /^[+-]?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};
const clean = (s) => String(s || '').replace(/[\s·ㆍ]/g, '');

/** 한 보고서의 계정 → {ytd, single, end, prev, acc} */
export function normalize(list, q) {
  const out = {};
  for (const [key, [kind, ids, names]] of Object.entries(MAP)) {
    const pool = list.filter((r) => (kind === 'PL' ? ['IS', 'CIS'].includes(r.sj_div) : r.sj_div === kind));
    let c = pool.filter((r) => ids.includes(r.account_id));
    if (!c.length) c = pool.filter((r) => names.includes(clean(r.account_nm)));
    if (c.length > 1 && kind === 'PL') { const is = c.filter((r) => r.sj_div === 'IS'); if (is.length) c = is; }
    if (c.length > 1) {
      const vals = new Set(c.map((r) => num(r.thstrm_amount)));
      if (vals.size > 1) { out[key] = { dup: true }; continue; }
    }
    if (!c.length) continue;
    const r = c[0];
    const v = { acc: `${r.sj_div} · ${r.account_nm}${r.account_id && !r.account_id.startsWith('-') ? ` (${r.account_id})` : ''}` };
    if (kind === 'PL') {
      v.single = q < 4 ? num(r.thstrm_amount) : null;
      v.ytd = q === 1 || q === 4 ? num(r.thstrm_amount) : (num(r.thstrm_add_amount) ?? null);
    } else if (kind === 'CF') {
      v.ytd = num(r.thstrm_amount); // 현금흐름표는 누적
    } else {
      v.end = num(r.thstrm_amount);
      v.prev = num(r.frmtrm_amount); // 직전 사업연도말
    }
    out[key] = v;
  }
  return out;
}

/* ------------------------------------------------------------ 수집 */
const cache = new Map(); // `${corp}|${y}|${q}` → Promise<report|null>

/** fsPref: 'CFS'(연결 우선, 없으면 별도) | 'OFS'(별도 우선) */
export function fetchReport(corp, y, q, fsPref = 'CFS') {
  const k = `${corp}|${y}|${q}|${fsPref}`;
  if (cache.has(k)) return cache.get(k);
  const p = (async () => {
    for (const fs of fsPref === 'OFS' ? ['OFS', 'CFS'] : ['CFS', 'OFS']) {
      const body = await api.dart('fnlttSinglAcntAll', { corp_code: corp, bsns_year: y, reprt_code: REPRT[q], fs_div: fs });
      if (body?.status === '000' && Array.isArray(body.list) && body.list.length) {
        const rows = body.list.map((r) => ({ sj_div: r.sj_div, account_id: r.account_id, account_nm: r.account_nm, ord: r.ord, thstrm_amount: r.thstrm_amount, thstrm_add_amount: r.thstrm_add_amount, frmtrm_amount: r.frmtrm_amount, frmtrm_add_amount: r.frmtrm_add_amount }));
        return { fs, rcept: body.list[0].rcept_no || '', q, y, acc: normalize(body.list, q), rows };
      }
    }
    return null; // 013: 미공시
  })();
  cache.set(k, p);
  p.catch(() => cache.delete(k));
  return p;
}

/** 주식의 총수 현황(stockTotqySttus): 유통주식수 = 발행주식총수 − 자기주식 (비상장사 포함) */
const sharesCache = new Map();
export function fetchShares(corp, y, q) {
  const k = `${corp}|${y}|${q}`;
  if (sharesCache.has(k)) return sharesCache.get(k);
  const p = api.dart('stockTotqySttus', { corp_code: corp, bsns_year: y, reprt_code: REPRT[q] }).then((b) => {
    if (b?.status !== '000' || !Array.isArray(b.list)) return null;
    const pick = (r) => ({ distb: num(r.distb_stock_co), issued: num(r.istc_totqy), treasury: num(r.tesstk_co) });
    const total = b.list.find((r) => /합계/.test(r.se || '')) || b.list.find((r) => /보통/.test(r.se || ''));
    if (!total) return null;
    const v = pick(total);
    if (!v.distb && v.issued) v.distb = v.issued - (v.treasury || 0);
    return v.distb ? { ...v, rcept: b.list[0].rcept_no || '' } : null;
  }).catch(() => { sharesCache.delete(k); return null; });
  sharesCache.set(k, p);
  return p;
}

/** 단일회사 주요 재무지표(fnlttSinglIndx, 2023년 3분기~): 안정성지표의 이자보상배율 */
const indexCache = new Map();
export function fetchStability(corp, y, q) {
  const k = `${corp}|${y}|${q}`;
  if (indexCache.has(k)) return indexCache.get(k);
  const p = api.dart('fnlttSinglIndx', { corp_code: corp, bsns_year: y, reprt_code: REPRT[q], idx_cl_code: 'M220000' }).then((b) => {
    if (b?.status !== '000' || !Array.isArray(b.list)) return null;
    const r = b.list.find((x) => /이자보상/.test(x.idx_nm || ''));
    const v = r ? num(r.idx_val) : null;
    return v === null ? null : { interestCover: v, rcept: r.rcept_no || b.list[0].rcept_no || '' };
  }).catch(() => { indexCache.delete(k); return null; });
  indexCache.set(k, p);
  return p;
}

const quarterEnd = (y, q) => `${y}${['', '0331', '0630', '0930', '1231'][q]}`;
export function kstToday() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ''); }

const priceCache = new Map();
/* 새로고침(↻) 시 세션 메모리 캐시도 비움 → 정정공시·최신 보고서를 다시 확인(기기 저장본 규칙은 api.js가 적용) */
onForceRefresh(() => { cache.clear(); sharesCache.clear(); indexCache.clear(); priceCache.clear(); });
export function fetchPrices(y, q) {
  const d = quarterEnd(y, q);
  if (d > kstToday()) return Promise.resolve(null);
  if (priceCache.has(d)) return priceCache.get(d);
  const codes = COMPANIES.filter((c) => c.ticker).map((c) => c.ticker);
  const p = api.snapshotAt(codes, d).then((s) => ({ basDd: s.basDd, by: Object.fromEntries(s.stocks.map((x) => [x.code, x])) }));
  priceCache.set(d, p);
  p.catch(() => priceCache.delete(d));
  return p;
}

/** 선택(회사·연도·분기)에 필요한 보고서 목록 */
export function plan(companies, years, qs) {
  const prefix = qs.every((q, i) => q === i + 1);
  const need = [];
  for (const c of companies) {
    for (const y of years) {
      const quarters = prefix ? [qs.at(-1)] : [...new Set(qs.flatMap((q) => (q === 1 ? [1] : [q, q - 1])))];
      quarters.forEach((q) => need.push([c, y, q]));
    }
  }
  return need;
}

/** 분기 범위 [{y,q}] 목록 (from·to 포함, 오래된 것부터) */
export function quarterRange(fromY, fromQ, toY, toQ) {
  const out = [];
  for (let y = fromY, q = fromQ; y < toY || (y === toY && q <= toQ); q === 4 ? (y += 1, q = 1) : (q += 1)) out.push({ y, q });
  return out;
}
/** 최근 공시가 있을 법한 마지막 분기(분기말 + 45일 경과 기준, 사업보고서는 90일) */
export function latestFiledQuarter(today = kstToday()) {
  const t = Date.UTC(+today.slice(0, 4), +today.slice(4, 6) - 1, +today.slice(6, 8));
  for (const { y, q } of quarterRange(+today.slice(0, 4) - 2, 1, +today.slice(0, 4), 4).reverse()) {
    const e = quarterEnd(y, q);
    const end = Date.UTC(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6, 8));
    if (t - end >= (q === 4 ? 90 : 45) * 86400e3) return { y, q };
  }
  return { y: +today.slice(0, 4) - 1, q: 4 };
}

/** 분기별 보고서 일괄 수집(분기 추이용). 결과 store 형식은 collect와 동일 */
export async function collectQuarters(companies, quarters, fsPref = 'CFS', onProgress) {
  const store = new Map();
  const errors = [];
  const jobs = companies.flatMap((c) => quarters.map(({ y, q }) => [c, y, q]));
  let done = 0; let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const [c, y, q] = jobs[i++];
      if (quarterEnd(y, q) <= kstToday()) {
        try { store.set(`${c.id}|${y}|${q}`, await fetchReport(c.corp, y, q, fsPref)); } catch (err) { errors.push({ c, y, q, err }); }
      }
      done++; onProgress?.(done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length || 1) }, worker));
  const xbrl = await hydrateSavedXbrl(store);
  return { store, xbrl, prices: new Map(), shares: new Map(), stability: new Map(), errors };
}

/** 이미 기기에 저장된 XBRL 요약본만 네트워크 0회로 data.xbrl에 연결 */
async function hydrateSavedXbrl(store) {
  const xbrl = new Map();
  const tasks = [];
  for (const [k, rep] of store.entries()) {
    if (!rep?.rcept) continue;
    const [cid, ys, qs] = k.split('|');
    const co = COMPANIES.find((c) => c.id === cid);
    if (!co) continue;
    tasks.push(savedXbrl(co.corp, +ys, +qs, rep.fs || 'CFS', rep.rcept).then((r) => {
      if (r.status === 'fresh' && r.data) xbrl.set(k, r.data);
    }).catch(() => {}));
  }
  await Promise.all(tasks);
  return xbrl;
}

/**
 * 선택 범위 중 본문 재무제표에 차입금·감가상각비·이자비용이 누락된 보고서만 선별해 XBRL 주석 보완
 * - 비상장 3사 및 구보고서의 DART_013/014는 중단 없이 건너뛰고 통계 반환
 */
export async function enrichWithXbrl(data, companies, years, qs, onProgress, signal) {
  if (!data.xbrl) data.xbrl = new Map();
  const jobs = plan(companies, years, qs);
  const targets = [];
  for (const [c, y, q] of jobs) {
    const k = `${c.id}|${y}|${q}`;
    const rep = data.store.get(k);
    if (!rep?.rcept || data.xbrl.has(k)) continue;
    const mainBRows = borrowRows(rep.rows || []);
    const hasMainBorrow = BORROW_PARTS.some((p) => rep.acc[p]?.end != null) || mainBRows.length > 0;
    const hasMainLease = rep.acc.currentLease?.end != null || rep.acc.longLease?.end != null || mainBRows.some((r) => /리스부채/.test(clean(r.account_nm)));
    const hasMainDep = rep.acc.depTotal?.ytd != null || rep.acc.dep?.ytd != null || depRows(rep.rows || []).length > 0;
    const hasMainInt = rep.acc.interestCostPL?.ytd != null || interestRows.costPL(rep.rows || []).length > 0;
    if (!hasMainBorrow || !hasMainLease || !hasMainDep || !hasMainInt) targets.push([c, y, q, rep, k]);
  }
  let done = 0; let loaded = 0; let cached = 0; let unavailable = 0; let failed = 0;
  let idx = 0;
  async function worker() {
    while (idx < targets.length) {
      if (signal?.aborted) return;
      const [c, y, q, rep, k] = targets[idx++];
      try {
        const res = await loadXbrl({ corp: c.corp, y, q, fs: rep.fs || 'CFS', rcept: rep.rcept });
        data.xbrl.set(k, res.data);
        if (res.fromStore) cached += 1; else loaded += 1;
      } catch (err) {
        if (err?.code === 'DART_013' || err?.code === 'DART_014') unavailable += 1;
        else failed += 1;
      }
      done += 1;
      onProgress?.(done, targets.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, targets.length || 1) }, worker));
  return { total: targets.length, loaded, cached, unavailable, failed };
}

/**
 * 재무제표 전체 계정표 — 기준(single: 분기 단독 / ytd: 누적)별 당기·전년 동기 값
 * - 손익: 단독 = 당기 3개월(Q4 = 연간 − 3분기 누적), 누적 = 1~N분기 누적. 전년 동기도 같은 기준.
 * - 현금흐름: DART 공시는 누적 → 단독은 (당 분기 누적 − 직전 분기 누적).
 * - 재무상태: 기말 잔액 vs 전기말(기준 무관).
 * @param rep     선택 분기 보고서   @param prevRep 같은 해 직전 분기 보고서(단독 산출용, 1분기면 없음)
 */
export function statementRows(rep, prevRep, basis) {
  if (!rep?.rows) return [];
  const q = rep.q;
  const keyOf = (r) => `${r.sj_div === 'CIS' ? 'IS' : r.sj_div}|${r.account_id && !r.account_id.startsWith('-') ? r.account_id : clean(r.account_nm)}`;
  const prevMap = new Map((prevRep?.rows || []).map((r) => [keyOf(r), r]));
  const out = [];
  for (const r of rep.rows) {
    const sj = r.sj_div === 'CIS' ? 'IS' : r.sj_div;
    if (!['IS', 'BS', 'CF'].includes(sj)) continue;
    let cur = null; let prior = null; let note = '';
    if (sj === 'BS') { cur = num(r.thstrm_amount); prior = num(r.frmtrm_amount); note = '기말 vs 전기말'; }
    else if (sj === 'IS') {
      if (basis === 'ytd') {
        cur = q === 1 || q === 4 ? num(r.thstrm_amount) : num(r.thstrm_add_amount);
        prior = q === 1 || q === 4 ? num(r.frmtrm_amount) : num(r.frmtrm_add_amount);
      } else if (q < 4) { cur = num(r.thstrm_amount); prior = num(r.frmtrm_amount); }
      else {
        const p = prevMap.get(keyOf(r));
        const pCur = p ? num(p.thstrm_add_amount) : null; const pPrior = p ? num(p.frmtrm_add_amount) : null;
        cur = num(r.thstrm_amount) !== null && pCur !== null ? num(r.thstrm_amount) - pCur : null;
        prior = num(r.frmtrm_amount) !== null && pPrior !== null ? num(r.frmtrm_amount) - pPrior : null;
        note = '4분기 = 연간 − 3분기 누적';
      }
    } else { // CF
      if (basis === 'ytd' || q === 1) { cur = num(r.thstrm_amount); prior = num(r.frmtrm_amount); }
      else {
        const p = prevMap.get(keyOf(r));
        cur = p && num(r.thstrm_amount) !== null && num(p.thstrm_amount) !== null ? num(r.thstrm_amount) - num(p.thstrm_amount) : null;
        prior = p && num(r.frmtrm_amount) !== null && num(p.frmtrm_amount) !== null ? num(r.frmtrm_amount) - num(p.frmtrm_amount) : null;
        note = '단독 = 당 분기 누적 − 직전 분기 누적';
      }
    }
    const chg = cur !== null && prior !== null && prior !== 0 ? ((cur - prior) / Math.abs(prior)) * 100 : null;
    out.push({ sj, name: r.account_nm, id: r.account_id, cur, prior, chg, note });
  }
  return out;
}

/** statementRows 결과에서 표준 계정(XBRL ID 우선 → 계정명)을 찾아 당기·비교 값을 반환 */
export function comparative(stRows, key) {
  const m = MAP[key];
  if (!m) return null;
  const [kind, ids, names] = m;
  const sj = kind === 'PL' ? 'IS' : kind;
  const pool = stRows.filter((r) => r.sj === sj);
  return pool.find((r) => ids.includes(r.id)) || pool.find((r) => names.includes(clean(r.name))) || null;
}

/** 순차·병렬(4) 수집. onProgress(done,total). 오류는 모아서 반환 */
export async function collect(companies, years, qs, onProgress, signal) {
  const jobs = plan(companies, years, qs);
  const store = new Map();
  const errors = [];
  let done = 0;
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      if (signal?.aborted) return;
      const [c, y, q] = jobs[i++];
      if (quarterEnd(y, q) > kstToday()) { done++; onProgress?.(done, jobs.length); continue; }
      try { store.set(`${c.id}|${y}|${q}`, await fetchReport(c.corp, y, q)); } catch (err) { errors.push({ c, y, q, err }); }
      done++; onProgress?.(done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length || 1) }, worker));
  const prices = new Map();
  const endQ = qs.at(-1);
  await Promise.all(years.map(async (y) => { try { prices.set(y, await fetchPrices(y, endQ)); } catch (err) { prices.set(y, null); errors.push({ y, q: endQ, err, krx: true }); } }));
  // 보조 출처: 유통주식수(전 회사) · DART 이자보상배율(이자 계정을 못 찾은 경우만, 2023년~)
  const shares = new Map();
  const stability = new Map();
  const extra = [];
  for (const c of companies) {
    for (const y of years) {
      if (quarterEnd(y, endQ) > kstToday()) continue;
      const rep = store.get(`${c.id}|${y}|${endQ}`);
      if (!rep) continue;
      extra.push(fetchShares(c.corp, y, endQ).then((v) => { if (v) shares.set(`${c.id}|${y}`, v); }));
      const hasInterest = rep.acc.interestCostPL || interestRows.costPL(rep.rows).length || rep.acc.interestPaidCF || interestRows.paidCF(rep.rows).length;
      if (!hasInterest && y >= 2023) extra.push(fetchStability(c.corp, y, endQ).then((v) => { if (v) stability.set(`${c.id}|${y}`, v); }));
    }
  }
  await Promise.all(extra);
  const xbrl = await hydrateSavedXbrl(store);
  return { store, xbrl, prices, shares, stability, errors };
}

/* ------------------------------------------------------------ 계산 */
const NA = (note) => ({ value: null, note, src: '' });

export function makeCalc(data, opts = {}) {
  const get = (c, y, q) => data.store.get(`${c.id}|${y}|${q}`);

  function calc(c, y, qs, key) {
    if (!qs.length) return NA('분기 미선택');
    const end = qs.at(-1);
    const prefix = qs.every((q, i) => q === i + 1);
    if (quarterEnd(y, end) > kstToday()) return NA('기간 미도래');
    const endRep = get(c, y, end);
    const label = `${y} ${REPRT_NAME[end]}`;
    const srcOf = (r) => (r ? `OpenDART ${r.fs === 'CFS' ? '연결' : '별도'} · ${y} ${REPRT_NAME[r.q]} · 접수 ${r.rcept}` : '');
    if (endRep === undefined) return NA('조회 실패(오류 목록 참고)');
    if (endRep === null) return NA(`${label} 미공시`);

    /* ---- 기본 계정 */
    const flowOf = (k) => {
      if (prefix) {
        const a = endRep.acc[k];
        if (!a) return NA(`${k} 계정 없음`);
        if (a.dup) return NA('계정 중복(판단 불가)');
        return a.ytd === null || a.ytd === undefined ? NA('누적값 없음') : { value: a.ytd, note: `1~${end}분기 누적 · ${a.acc}`, src: srcOf(endRep) };
      }
      let sum = 0;
      const parts = [];
      for (const q of qs) {
        const r = get(c, y, q);
        if (!r) return NA(`${y} ${REPRT_NAME[q]} 미공시`);
        const a = r.acc[k];
        if (!a || a.dup) return NA(`${q}분기 계정 없음`);
        let v = null;
        if (MAP[k][0] === 'PL' && q < 4) v = a.single;
        else {
          const prevQ = q - 1;
          if (prevQ === 0) v = a.ytd;
          else {
            const pr = get(c, y, prevQ);
            const pa = pr?.acc[k];
            v = a.ytd !== null && a.ytd !== undefined && pa && pa.ytd !== null && pa.ytd !== undefined ? a.ytd - pa.ytd : null;
          }
        }
        if (v === null || v === undefined) return NA(`${q}분기 단독값 산출 불가`);
        sum += v;
        parts.push(`${q}Q`);
      }
      return { value: sum, note: `${parts.join('+')} 단독분기 합계 (Q4 = 연간 − 3분기 누적)`, src: srcOf(endRep) };
    };
    const stockOf = (k) => {
      const a = endRep.acc[k];
      if (!a) return NA(`${k} 계정 없음`);
      if (a.dup) return NA('계정 중복(판단 불가)');
      return a.end === null || a.end === undefined ? NA('기말값 없음') : { value: a.end, note: `${end}분기말 잔액 · ${a.acc}`, src: srcOf(endRep) };
    };
    const ratio = (a, b, m, note) => (a.value === null || b.value === null || b.value === 0
      ? NA(a.value === null ? a.note : b.value === 0 ? '분모 0' : b.note)
      : { value: (a.value / b.value) * m, note, src: a.src || b.src });

    /* ---- 계정명 패턴 행 집계(정확한 계정이 없을 때) : 손익=선택기간, 현금흐름=누적 차감 */
    const rowAmt = (r, q, kind, mode) => {
      const t = num(r.thstrm_amount); const add = num(r.thstrm_add_amount);
      if (kind === 'CF') return t;
      if (mode === 'single') return q < 4 ? t : null;
      return q === 1 || q === 4 ? t : add;
    };
    const patternFlow = (select, kind) => {
      const sumRows = (rep, mode) => {
        const rs = select(rep.rows || []);
        if (!rs.length) return null;
        const vals = rs.map((r) => rowAmt(r, rep.q, kind, mode));
        return vals.some((v) => v === null) ? null : { v: vals.reduce((s, v) => s + Math.abs(v), 0), names: rs.map((r) => r.account_nm) };
      };
      if (prefix) {
        const s = sumRows(endRep, 'ytd');
        return s ? { value: s.v, note: `계정명 로직 집계: ${s.names.join(', ')}`, src: srcOf(endRep), logic: true } : NA('해당 계정 없음');
      }
      let total = 0; let names = [];
      for (const q of qs) {
        const r = get(c, y, q); if (!r) return NA(`${q}분기 미공시`);
        let v;
        if (kind === 'PL' && q < 4) { const s = sumRows(r, 'single'); if (!s) return NA(`${q}분기 해당 계정 없음`); v = s.v; names = s.names; } else {
          const a = sumRows(r, 'ytd'); if (!a) return NA(`${q}분기 해당 계정 없음`);
          const pr = q > 1 ? get(c, y, q - 1) : null; const b = pr ? sumRows(pr, 'ytd') : { v: 0 };
          if (!b) return NA(`${q - 1}분기 해당 계정 없음`); v = a.v - b.v; names = a.names;
        }
        total += v;
      }
      return { value: total, note: `계정명 로직 집계(단독분기 합계): ${names.join(', ')}`, src: srcOf(endRep), logic: true };
    };
    const logic = (v, note) => ({ ...v, note, logic: true });
    const hasNci = () => !!(endRep.acc.nciEquity || endRep.acc.nciNet);
    const getX = (cc, yy, qq) => data.xbrl?.get(`${cc.id}|${yy}|${qq}`) || null;
    const endX = getX(c, y, end);
    const xSrcOf = (x) => (x ? `OpenDART XBRL 주석 · ${x.fs === 'OFS' ? '별도' : '연결'} · ${x.y} ${REPRT_NAME[x.q]} · 접수 ${x.rcept}` : '');
    const xbrlFlow = (pick, labelName) => {
      if (prefix) {
        if (!endX) return null;
        const v = pick(endX, 'ytd');
        return Number.isFinite(v) ? { value: v, note: `XBRL 주석 1~${end}분기 누적 · ${labelName}`, src: xSrcOf(endX), xbrl: true } : null;
      }
      let sum = 0;
      for (const q of qs) {
        const x = getX(c, y, q);
        if (!x) return null;
        let v = pick(x, 'single');
        if (!Number.isFinite(v)) {
          if (q === 1) v = pick(x, 'ytd');
          else {
            const px = getX(c, y, q - 1);
            const a = pick(x, 'ytd'); const b = px ? pick(px, 'ytd') : null;
            v = Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
          }
        }
        if (!Number.isFinite(v)) return null;
        sum += v;
      }
      return { value: sum, note: `XBRL 주석 단독분기 합계 · ${labelName}`, src: xSrcOf(endX), xbrl: true };
    };

    const f = (k) => calc(c, y, qs, k);
    switch (key) {
      case 'revenue': case 'op': case 'net': case 'cfo':
        return flowOf(key);
      case 'cost': {
        const d = flowOf('cost'); if (d.value !== null) return d;
        const r = flowOf('revenue'); const g = flowOf('gpDirect');
        return r.value === null || g.value === null ? d : logic({ value: r.value - g.value, src: r.src }, '로직: 매출액 − 매출총이익 (매출원가 계정 미표시)');
      }
      case 'sga': {
        const d = flowOf('sga'); if (d.value !== null) return d;
        const g = f('gp'); const o = flowOf('op');
        return g.value === null || o.value === null ? d : logic({ value: g.value - o.value, src: g.src }, '로직: 매출총이익 − 영업이익 (판관비 계정 미표시 · 기타영업손익이 있으면 포함됨)');
      }
      case 'pretax': {
        const d = flowOf('pretax'); if (d.value !== null) return d;
        const n = flowOf('net'); const t = flowOf('incomeTax');
        return n.value === null || t.value === null ? d : logic({ value: n.value + t.value, src: n.src }, '로직: 당기순이익 + 법인세비용');
      }
      case 'attributable': {
        const d = flowOf('attributable'); if (d.value !== null) return d;
        const n = flowOf('net'); if (n.value === null) return d;
        const nci = flowOf('nciNet');
        if (nci.value !== null) return logic({ value: n.value - nci.value, src: n.src }, '로직: 당기순이익 − 비지배지분 순이익');
        return hasNci() ? d : logic({ value: n.value, src: n.src }, '로직: 비지배지분 계정이 없어 당기순이익 = 지배순이익');
      }
      case 'gp': {
        const d = flowOf('gpDirect');
        if (d.value !== null) return d;
        const a = flowOf('revenue'); const b = flowOf('cost');
        return a.value === null || b.value === null ? NA('매출총이익 계정·매출원가 없음') : { value: a.value - b.value, note: '매출액 − 매출원가', src: a.src };
      }
      case 'interestCost': {
        // 1순위: 손익계산서 본문 정확한 이자비용 → 2순위: XBRL 주석 27 발생주의 이자비용 → 3순위: IS 패턴(하위항목 제외) → 4순위: CF 이자지급(영업+재무 합산)
        const d = flowOf('interestCostPL'); if (d.value !== null) return d;
        const xi = xbrlFlow((x, k) => x.interest?.[k]?.expense?.value, '이자비용(금융원가 주석)');
        if (xi) return xi;
        const pl = patternFlow(interestRows.costPL, 'PL'); if (pl.value !== null) return pl;
        // CF 이자지급이 영업활동·재무활동으로 분리된 회사(예: 현대건설·DL이앤씨)는 두 행을 합산해야 과소계상 방지
        const cfRows = interestRows.paidCF(endRep.rows || []);
        let p = cfRows.length > 1 ? patternFlow(interestRows.paidCF, 'CF') : flowOf('interestPaidCF');
        if (p.value === null) p = patternFlow(interestRows.paidCF, 'CF');
        return p.value === null ? NA('이자비용·이자지급 계정 없음(주석 공시)') : { ...p, value: Math.abs(p.value), note: `현금흐름표 이자지급(현금기준 대체)${p.logic ? ' · ' + p.note : ''}` };
      }
      case 'interestIncome': {
        const d = flowOf('interestIncomePL'); if (d.value !== null) return d;
        const xi = xbrlFlow((x, k) => x.interest?.[k]?.income?.value, '이자수익(금융수익 주석)');
        if (xi) return xi;
        const cfRows = interestRows.recvCF(endRep.rows || []);
        let p = cfRows.length > 1 ? patternFlow(interestRows.recvCF, 'CF') : flowOf('interestRecvCF');
        if (p.value === null) p = patternFlow(interestRows.recvCF, 'CF');
        return p.value === null ? NA('이자수익·이자수취 계정 없음') : { ...p, value: Math.abs(p.value), note: '현금흐름표 이자수취(현금기준 대체)' };
      }
      case 'netInterest': {
        const ic = f('interestCost');
        if (ic.value === null) return NA('이자비용이 재무제표 본문에 없음(주석 공시) · 금융원가로 대체하지 않음');
        const ii = f('interestIncome');
        const cash = /현금기준/.test(ic.note);
        return { value: ic.value - (ii.value ?? 0), note: `${ic.xbrl ? 'XBRL 주석 이자비용 − 이자수익(발생주의)' : cash ? '현금흐름표 이자지급 − 이자수취 (현금기준 대체)' : '손익계산서 이자비용 − 이자수익'}${ii.value === null ? ' (이자수익 미표시 → 0)' : ''}`, src: ic.src, logic: ic.logic, xbrl: !!(ic.xbrl || ii.xbrl) };
      }
      case 'ebitda': {
        const op = flowOf('op');
        if (op.value === null) return op;
        const xDep = xbrlFlow((x, k) => depTotal(x.dep?.[k]), '감가상각비 4종(유형·무형·투자부동산·사용권)');
        if (xDep) return { value: op.value + Math.abs(xDep.value), note: `영업이익 + ${xDep.note}`, src: xDep.src, xbrl: true };
        const tot = flowOf('depTotal');
        if (tot.value !== null) return { value: op.value + Math.abs(tot.value), note: '영업이익 + 감가상각비및상각비(현금흐름표)', src: op.src };
        const parts = ['dep', 'amort', 'invDep', 'leaseDep'].map(flowOf);
        if (parts[0].value !== null) return { value: op.value + parts.reduce((s, p) => s + Math.abs(p.value || 0), 0), note: '영업이익 + 감가상각비·무형·투자부동산·사용권 상각비(현금흐름표)', src: op.src };
        const pat = patternFlow(depRows, 'CF');
        if (pat.value !== null) return logic({ value: op.value + pat.value, src: op.src }, `로직: 영업이익 + ${pat.note.replace('계정명 로직 집계: ', '')}`);
        return NA('감가상각비가 현금흐름표 본문에 없음(주석 공시 — [XBRL 주석 보완] 실행)');
      }
      case 'assets': case 'liabilities': case 'equity': case 'cash': case 'currentAssets': case 'currentLiabilities': case 'nonCurrentLiabilities':
        return stockOf(key);
      case 'parentEquity': {
        const d = stockOf('parentEquity'); if (d.value !== null) return d;
        const e = stockOf('equity'); if (e.value === null) return d;
        const nci = stockOf('nciEquity');
        if (nci.value !== null) return logic({ value: e.value - nci.value, src: e.src }, '로직: 자본총계 − 비지배지분');
        return hasNci() ? d : logic({ value: e.value, src: e.src }, '로직: 비지배지분 계정이 없어 자본총계 = 지배자본');
      }
      case 'shortFinancial': {
        const d = stockOf('shortFinancial');
        if (d.value !== null) return d;
        const a = stockOf('shortFinancialAsset');
        if (a.value !== null) return a;
        return endRep.acc.assets ? { value: 0, note: '재무상태표에 단기금융상품·단기금융자산 미표시 → 0', src: srcOf(endRep) } : d;
      }
      case 'borrow': {
        const parts = BORROW_PARTS.map((k) => endRep.acc[k]).filter((a) => a && !a.dup && a.end !== null && a.end !== undefined);
        const exactNames = new Set(parts.map((a) => clean(a.acc.split(' · ')[1].split(' (')[0])));
        let extra = borrowRows(endRep.rows || []).filter((r) => !exactNames.has(clean(r.account_nm)) && num(r.thstrm_amount) !== null);
        if (parts.length) extra = extra.filter((r) => !SUBTOTAL_BORROW.test(clean(r.account_nm)));
        else if (extra.length > 1) extra = extra.filter((r) => !SUBTOTAL_BORROW.test(clean(r.account_nm)));
        if (parts.length || extra.length) {
          let value = parts.reduce((s, a) => s + a.end, 0) + extra.reduce((s, r) => s + num(r.thstrm_amount), 0);
          const names = [...parts.map((a) => a.acc.split(' · ')[1].split(' (')[0]), ...extra.map((r) => `${r.account_nm}(로직)`)];
          // 본문 BS에 리스부채가 누락(기타금융부채 통합)된 회사(IPARK현산·삼성E&A 등)는 XBRL 주석 리스부채를 자동 보완 합산
          const hasMainLease = !!(endRep.acc.currentLease?.end != null || endRep.acc.longLease?.end != null || extra.some((r) => /리스부채/.test(clean(r.account_nm))));
          const xb = endX?.borrow?.end;
          let usedXbrlLease = false;
          if (!hasMainLease && xb) {
            const xcl = xb.items.currentLease?.net || 0;
            const xll = xb.items.longLease?.net || 0;
            if (xcl + xll > 0) {
              value += xcl + xll;
              if (xcl > 0) names.push(`유동리스부채 ${Math.round(xcl / 1e8).toLocaleString('ko-KR')}억(XBRL)`);
              if (xll > 0) names.push(`비유동리스부채 ${Math.round(xll / 1e8).toLocaleString('ko-KR')}억(XBRL)`);
              usedXbrlLease = true;
            }
          }
          return { value, note: `기말 차입금 합계(리스 포함): ${names.join(', ')} · 미표시 항목은 0`, src: usedXbrlLease ? `${srcOf(endRep)} + ${xSrcOf(endX)}` : srcOf(endRep), logic: extra.length > 0, xbrl: usedXbrlLease };
        }
        const xb = endX?.borrow?.end;
        if (xb && Number.isFinite(xb.total)) {
          const used = Object.values(xb.items).filter(Boolean).map((x) => `${x.label} ${Math.round(x.net / 1e8).toLocaleString('ko-KR')}억${x.disc ? `(할인-${Math.round(x.disc / 1e8).toLocaleString('ko-KR')}억)` : ''}`);
          return { value: xb.total, note: `XBRL 주석 총차입금(순액·리스 포함): ${used.join(' + ')}`, src: xSrcOf(endX), xbrl: true };
        }
        return NA('본문 차입금 미분리(단기·장기금융부채 통합) — [XBRL 주석 보완] 실행 시 주석에서 추출');
      }
      case 'shortRepayBurden': {
        const a = endRep.acc.currentLongBorrow; const b = endRep.acc.currentBonds;
        if (a?.dup || b?.dup) return NA('계정 중복(판단 불가)');
        const has = (x) => x && x.end !== null && x.end !== undefined;
        const xb0 = endX?.borrow?.end;
        if (has(a) || has(b)) {
          let val = (has(a) ? a.end : 0) + (has(b) ? b.end : 0);
          const parts = [has(a) && `유동성장기부채 ${a.acc.split(' · ')[1].split(' (')[0]}`, has(b) && '유동성사채'].filter(Boolean);
          let usedXb = false;
          if (!has(b) && xb0?.items?.currentBonds?.net > 0 && !(has(a) && /사채/.test(clean(a.acc.split(' · ')[1].split(' (')[0])))) {
            val += xb0.items.currentBonds.net;
            parts.push(`유동성사채 ${Math.round(xb0.items.currentBonds.net / 1e8).toLocaleString('ko-KR')}억(XBRL)`);
            usedXb = true;
          }
          if (!has(a) && xb0?.items?.currentLongBorrow?.net > 0) {
            val += xb0.items.currentLongBorrow.net;
            parts.push(`유동성장기부채 ${Math.round(xb0.items.currentLongBorrow.net / 1e8).toLocaleString('ko-KR')}억(XBRL)`);
            usedXb = true;
          }
          return { value: val, note: `단기상환부담액 = 유동성장기부채 + 유동성사채 (${parts.join(', ')})`, src: usedXb ? `${srcOf(endRep)} + ${xSrcOf(endX)}` : srcOf(endRep), logic: !usedXb, xbrl: usedXb };
        }
        // 유동성 장기차입금 + 사채 결합 계정(예: 유동성장기차입금및사채, DL이앤씨 등) 인식 — 단기차입금·리스 포함 행은 제외
        const curMatRows = (endRep.rows || []).filter((r) => {
          const nm = clean(r.account_nm);
          return r.sj_div === 'BS' && /유동성/.test(nm) && /(장기|사채)/.test(nm) && !/(단기차입|리스|할인|이자|충당|보증|파생)/.test(nm) && num(r.thstrm_amount) !== null;
        });
        if (curMatRows.length) {
          const val = curMatRows.reduce((s, r) => s + num(r.thstrm_amount), 0);
          return { value: val, note: `단기상환부담액(결합 계정): ${curMatRows.map((r) => r.account_nm).join(', ')}`, src: srcOf(endRep), logic: true };
        }
        const xb = endX?.borrow?.end;
        if (xb && Number.isFinite(xb.shortRepay)) {
          return { value: xb.shortRepay, note: 'XBRL 주석 단기상환부담액 = 유동성장기부채(순) + 유동성사채(순)', src: xSrcOf(endX), xbrl: true };
        }
        const combined = (endRep.rows || []).find((r) => r.sj_div === 'BS' && /(단기차입금.*(및|과|와).*유동성|단기금융부채)/.test(clean(r.account_nm)));
        if (combined) return NA(`통합 계정(${combined.account_nm}) — [XBRL 주석 보완] 필요`);
        return { value: 0, note: '유동성장기부채·유동성사채 계정 없음(0)', src: srcOf(endRep) };
      }
      case 'currentDebtRatio': return ratio(f('currentLiabilities'), f('equity'), 100, '유동부채 / 자본총계');
      case 'nonCurrentDebtRatio': {
        const nc = f('nonCurrentLiabilities');
        if (nc.value !== null) return ratio(nc, f('equity'), 100, '비유동부채 / 자본총계');
        const l = f('liabilities'); const c = f('currentLiabilities');
        if (l.value === null || c.value === null) return NA(nc.note);
        const r = ratio({ value: l.value - c.value, src: l.src }, f('equity'), 100, '(부채총계 − 유동부채) / 자본총계');
        return r.value === null ? r : logic(r, '로직: 비유동부채 = 부채총계 − 유동부채, ÷ 자본총계');
      }
      case 'borrowToEquity': {
        const b = f('borrow'); const r = ratio(b, f('equity'), 100, '총차입금 / 자본총계');
        return r.value === null ? r : { ...r, xbrl: !!b.xbrl, logic: !!b.logic };
      }
      case 'netBorrow': {
        const b = f('borrow'); const cash = f('cash'); const sf = f('shortFinancial');
        if (b.value === null || cash.value === null) return NA(b.value === null ? b.note : cash.note);
        return { value: b.value - cash.value - (sf.value || 0), note: `총차입금 − 현금및현금성자산 − ${sf.note.includes('단기금융자산') ? '단기금융자산' : '단기금융상품'} (음수 = 순현금)`, src: b.src, xbrl: !!b.xbrl, logic: !!b.logic };
      }
      case 'costRatio': return ratio(f('cost'), f('revenue'), 100, '매출원가 / 매출액');
      case 'gpm': return ratio(f('gp'), f('revenue'), 100, '매출총이익 / 매출액');
      case 'margin': return ratio(f('op'), f('revenue'), 100, '영업이익 / 매출액');
      case 'netMargin': return ratio(f('net'), f('revenue'), 100, '당기순이익 / 매출액');
      case 'debtRatio': return ratio(f('liabilities'), f('equity'), 100, '부채총계 / 자본총계');
      case 'currentRatio': return ratio(f('currentAssets'), f('currentLiabilities'), 100, '유동자산 / 유동부채');
      case 'equityRatio': return ratio(f('equity'), f('assets'), 100, '자본총계 / 자산총계');
      case 'borrowDep': {
        const b = f('borrow'); const r = ratio(b, f('assets'), 100, '총차입금 / 자산총계');
        return r.value === null ? r : { ...r, xbrl: !!b.xbrl, logic: !!b.logic };
      }
      case 'interestCover': {
        const ic = f('interestCost');
        const r = ratio(f('op'), ic, 1, '영업이익 / 이자비용');
        if (r.value !== null) return { ...r, note: ic.xbrl ? '영업이익 / 이자비용(XBRL 주석)' : /현금기준/.test(ic.note) ? '영업이익 / 이자지급액(현금기준 대체)' : r.note, logic: ic.logic, xbrl: !!ic.xbrl };
        const s = data.stability?.get(`${c.id}|${y}`);
        return s ? { value: s.interestCover, note: 'DART 단일회사 주요재무지표(안정성) 이자보상배율 — 주석 포함 DART 산출값', src: `OpenDART 주요재무지표 · ${label} · 접수 ${s.rcept}`, alt: true } : r;
      }
      case 'roe': case 'roa': {
        const nk = key === 'roe' ? 'attributable' : 'net';
        const bk = key === 'roe' ? 'parentEquity' : 'assets';
        const n = f(nk);
        if (n.value === null) return n;
        const endBal = f(bk);
        // 기초 잔액: 1분기부터면 전기말(보고서 전기 열), 아니면 선택 첫 분기 직전 분기말
        const first = qs[0];
        let begin = null;
        if (first === 1) {
          const a = endRep.acc[bk];
          begin = a?.prev ?? null;
          if (begin === null && bk === 'parentEquity') { const e = endRep.acc.equity; begin = !hasNci() && e ? e.prev : null; }
        } else {
          const pr = get(c, y, first - 1);
          const a = pr?.acc[bk];
          begin = a?.end ?? (bk === 'parentEquity' && pr && !(pr.acc.nciEquity) && pr.acc.equity ? pr.acc.equity.end : null);
        }
        if (endBal.value === null || begin === null || begin === undefined) return NA(`${DEFS[bk].label} 기초·기말 잔액 없음`);
        const avg = (endBal.value + begin) / 2;
        return avg === 0 ? NA('분모 0') : { value: (n.value / avg) * 100, note: `${DEFS[nk].label} / 평균 ${DEFS[bk].label}(${first === 1 ? '전기말' : `${first - 1}분기말`}·${end}분기말) · 연율화 없음${prefix ? '' : ' · 비연속 선택 참고값'}`, src: n.src, logic: n.logic || endBal.logic || !prefix };
      }
      case 'borrowEbitda': case 'netEbitda': {
        const n = f(key === 'borrowEbitda' ? 'borrow' : 'netBorrow'); const e = f('ebitda');
        const factor = opts.annualize ? 4 / qs.length : 1;
        const r = ratio(n, e.value === null ? e : { ...e, value: e.value * factor }, 1, `기말 ${key === 'borrowEbitda' ? '차입금' : '순차입금'} / 선택기간 EBITDA${factor !== 1 ? ` × ${factor.toFixed(2)}(연환산)` : ' · 연환산 없음'}`);
        return r.value === null ? r : { ...r, xbrl: !!(n.xbrl || e.xbrl), logic: !!(n.logic || e.logic) };
      }
      case 'price': case 'marketCap': case 'eps': case 'bps': case 'per': case 'pbr': {
        const pr = data.prices.get(y);
        const s = c.ticker ? pr?.by?.[c.ticker] : null;
        const krxSrc = pr ? `KRX 일별 확정치 · ${pr.basDd}` : '';
        if (key === 'price') return !c.ticker ? NA('비상장 회사: 거래소 주가 없음') : s?.close ? { value: s.close, note: `${end}분기말 직전 거래일 종가`, src: krxSrc } : NA('KRX 분기말 시세 없음');
        if (key === 'marketCap') return !c.ticker ? NA('비상장 회사: 시가총액 없음') : s?.mktcap ? { value: s.mktcap, note: `${end}분기말 직전 거래일 시가총액`, src: krxSrc } : NA('KRX 시가총액 없음');
        // 주식수: 1순위 DART 유통주식수(발행 − 자기주식, 비상장 포함) → 2순위 KRX 상장주식수
        const sh = data.shares?.get(`${c.id}|${y}`);
        const shares = sh?.distb || s?.shares || null;
        const shareNote = sh?.distb ? 'DART 유통주식수(발행−자기주식)' : 'KRX 상장주식수(자기주식 포함)';
        const shareSrc = sh?.distb ? `OpenDART 주식의총수 · 접수 ${sh.rcept}` : krxSrc;
        let eps;
        const official = prefix ? flowOf('epsBasic') : NA('');
        if (official.value !== null) eps = { ...official, note: `DART 공시 기본주당이익(가중평균 주식수) · ${official.note}` };
        else eps = shares ? ratio(f('attributable'), { value: shares, note: '' }, 1, `로직: 선택기간 지배순이익 / ${shareNote}`) : NA('주식수 없음');
        if (!eps.src && eps.value !== null) eps.src = shareSrc;
        if (eps.value !== null && official.value === null) eps.logic = true;
        const bps = shares ? { ...ratio(f('parentEquity'), { value: shares, note: '' }, 1, `로직: 기말 지배자본 / ${shareNote}`), logic: true } : NA('주식수 없음');
        if (key === 'eps') return eps;
        if (key === 'bps') return bps;
        if (!c.ticker) return NA('비상장 회사: 주가가 없어 PER·PBR 산정 불가');
        const price = s?.close ? { value: s.close, note: '' } : NA('주가 없음');
        const base = key === 'per' ? eps : bps;
        if (base.value !== null && base.value <= 0) return NA(key === 'per' ? '적자(EPS ≤ 0): PER 산정 불가' : 'BPS ≤ 0');
        const r = ratio(price, base, 1, key === 'per' ? `분기말 주가 / EPS(${official.value !== null ? 'DART 공시' : '로직'}, 연환산 없음)` : '분기말 주가 / BPS(로직)');
        return { ...r, src: r.value === null ? '' : `${krxSrc} + ${base.src}`, logic: base.logic };
      }
      default: return NA('정의되지 않은 지표');
    }
  }
  return calc;
}

/* ------------------------------------------------------- API 미제공 항목 분석 */
export const SOURCE_NOTES = {
  netInterest: '이자비용은 대부분 주석에만 공시됩니다(손익계산서는 "금융원가"로 합산). ① 손익계산서 이자비용 → ② 계정명에 "이자비용"이 든 손익 계정(로직) → ③ 현금흐름표 "이자의 지급/수취"(현금기준 대체) 순서로 찾고, 금융원가로 대체하지 않습니다.',
  interestCover: '① 영업이익 / 이자비용(위 순서) → ② 이자 계정이 전혀 없으면 DART 단일회사 주요재무지표(안정성)의 이자보상배율(주석 포함 DART 산출값, 2023년 3분기~).',
  ebitda: '① XBRL 주석 감가상각비 4종(유형·무형·투자부동산·사용권자산) 합계 → ② 현금흐름표 본문 상각비 계정 순으로 계산합니다. 상장사는 [XBRL 주석 보완] 클릭 시 자동 추출됩니다.',
  borrowEbitda: 'EBITDA(감가상각비)가 없으면 N/A입니다.',
  netEbitda: 'EBITDA(감가상각비)가 없으면 N/A입니다.',
  per: '비상장(포스코이앤씨·롯데건설·SK에코플랜트)은 주가가 없어 산정 불가. EPS는 DART 공시 기본주당이익 우선, 없으면 지배순이익 / 유통주식수(로직).',
  pbr: '비상장 회사는 주가가 없어 산정 불가. BPS = 기말 지배자본 / DART 유통주식수(로직).',
  eps: 'DART 공시 기본주당이익(누적 선택 시) 우선 → 없거나 비연속 선택이면 지배순이익 / DART 유통주식수(발행−자기주식, 비상장 포함)로 계산.',
  bps: '기말 지배자본 / DART 유통주식수. 비상장 회사도 계산됩니다.',
  borrow: '재무상태표 본문 7개/결합 차입금 계정을 우선 합산하고, 본문이 단기·장기금융부채로 통합된 회사(GS건설 등)는 [XBRL 주석 보완]으로 주석 17·18·15의 7종 차입금(할인차금 차감 순액, 파생·금융보증 제외)을 추출합니다.',
  netBorrow: '총차입금 − 현금및현금성자산 − 단기금융상품(또는 단기금융자산). 근거 팝업에서 실제 사용한 계정명·XBRL 출처를 확인하세요.',
  sga: '판관비 계정이 없으면 로직: 매출총이익 − 영업이익(기타영업손익이 있으면 함께 포함).',
  cost: '매출원가 계정이 없으면 로직: 매출액 − 매출총이익.',
  attributable: '지배순이익 계정이 없으면 로직: 당기순이익 − 비지배지분순이익 (비지배지분이 없으면 당기순이익).',
  parentEquity: '지배자본 계정이 없으면 로직: 자본총계 − 비지배지분 (비지배지분이 없으면 자본총계).',
  roe: '지배순이익 / 평균 지배자본. 기초 = 1분기부터면 전기말, 아니면 선택 첫 분기 직전 분기말(비연속 선택도 계산, 참고값). 연율화하지 않습니다.',
  roa: '당기순이익 / 평균 자산총계. 기초 잔액 규칙은 ROE와 같습니다.',
};
