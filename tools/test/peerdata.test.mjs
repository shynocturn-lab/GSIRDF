// 동종사 계산 엔진 단위 테스트 — 실행: node --test tools/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, makeCalc, plan, DEFS, FIN_CARDS, PNL_CARDS, PNL_EXTRA } from '../../src/js/peerdata.js';
import { companyById } from '../../src/js/config.js';

const GS = companyById('gs');           // 상장
const POSCO = companyById('posco');     // 비상장
const row = (sj, id, nm, cur, add = '', prev = '') => ({ sj_div: sj, account_id: id, account_nm: nm, thstrm_amount: String(cur), thstrm_add_amount: String(add), frmtrm_amount: String(prev) });

/** 분기 q 보고서: 연간 Y 기준 균등 분기(단독 = Y/4, 누적 = Y*q/4) */
function report(q, { y = 2025, fs = 'CFS', scale = 1, extra = [], omit = [] } = {}) {
  const Y = { rev: 1200, cost: 1080, sga: 40, op: 80, pre: 70, net: 50, own: 45, cfo: 100, ip: 20, ir: 8, dep: 30 };
  const s = (k) => Y[k] * scale / 4;
  const ytd = (k) => Y[k] * scale * q / 4;
  const pl = (id, nm, k) => row('IS', id, nm, q === 4 ? Y[k] * scale : s(k), q === 4 ? '' : ytd(k));
  const list = [
    pl('ifrs-full_Revenue', '매출액', 'rev'), pl('ifrs-full_CostOfSales', '매출원가', 'cost'),
    pl('dart_TotalSellingGeneralAdministrativeExpenses', '판매비와관리비', 'sga'), pl('dart_OperatingIncomeLoss', '영업이익', 'op'),
    pl('ifrs-full_ProfitLossBeforeTax', '법인세비용차감전순이익', 'pre'), pl('ifrs-full_ProfitLoss', '당기순이익', 'net'),
    pl('ifrs-full_ProfitLossAttributableToOwnersOfParent', '지배기업의 소유주에게 귀속되는 당기순이익', 'own'),
    row('BS', 'ifrs-full_Assets', '자산총계', 2000, '', 1800), row('BS', 'ifrs-full_Liabilities', '부채총계', 1200, '', 1100),
    row('BS', 'ifrs-full_Equity', '자본총계', 800, '', 700), row('BS', 'ifrs-full_EquityAttributableToOwnersOfParent', '지배기업의 소유주에게 귀속되는 자본', 700, '', 600),
    row('BS', 'ifrs-full_CurrentAssets', '유동자산', 1000), row('BS', 'ifrs-full_CurrentLiabilities', '유동부채', 800),
    row('BS', 'ifrs-full_CashAndCashEquivalents', '현금및현금성자산', 150), row('BS', '-표준계정코드 미사용-', '단기금융상품', 50),
    row('BS', 'ifrs-full_ShorttermBorrowings', '단기차입금', 100), row('BS', '-표준계정코드 미사용-', '사채', 200), row('BS', 'ifrs-full_NoncurrentLeaseLiabilities', '리스부채', 20),
    row('CF', 'ifrs-full_CashFlowsFromUsedInOperatingActivities', '영업활동현금흐름', ytd('cfo')),
    row('CF', 'ifrs-full_InterestPaidClassifiedAsOperatingActivities', '이자의 지급', -ytd('ip')),
    row('CF', 'ifrs-full_InterestReceivedClassifiedAsOperatingActivities', '이자의 수취', ytd('ir')),
    row('CF', 'ifrs-full_DepreciationExpense', '감가상각비', ytd('dep')),
    ...extra,
  ].filter((r) => !omit.includes(r.account_nm));
  return { fs, rcept: '20260315000123', q, y, acc: normalize(list, q), rows: list }; // fetchReport와 동일하게 원 계정행 포함
}
function data(entries, prices = new Map()) {
  return { store: new Map(entries), prices };
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

/* ---------------- normalize */
test('01 반기 손익: 단독 = 당기, 누적 = 누적금액', () => { const a = report(2).acc.revenue; assert.equal(a.single, 300); assert.equal(a.ytd, 600); });
test('02 사업보고서 손익: 누적 = 연간', () => { const a = report(4).acc.revenue; assert.equal(a.ytd, 1200); assert.equal(a.single, null); });
test('03 1분기: 누적 = 당기', () => { assert.equal(report(1).acc.op.ytd, 20); });
test('04 XBRL ID 우선, 없으면 공백 제거한 계정명', () => { const r = report(2); assert.ok(r.acc.attributable.acc.includes('ProfitLossAttributableToOwnersOfParent')); assert.equal(r.acc.shortFinancial.end, 50); });
test('05 값이 다른 중복 계정 → dup(판단 불가)', () => { const acc = normalize([row('IS', '', '매출액', 1), row('IS', '', '매출액', 2)], 4); assert.equal(acc.revenue.dup, true); });
test('06 IS·CIS 중복 시 IS 우선', () => { const acc = normalize([row('CIS', 'ifrs-full_Revenue', '매출액', 9), row('IS', 'ifrs-full_Revenue', '매출액', 7)], 4); assert.equal(acc.revenue.ytd, 7); });
test('07 재무상태표: 기말 + 전기말', () => { const a = report(4).acc.assets; assert.equal(a.end, 2000); assert.equal(a.prev, 1800); });
test('08 현금흐름표는 누적값', () => { assert.equal(report(3).acc.cfo.ytd, 75); });

/* ---------------- 기간 계산 */
const D = data([[`gs|2025|1`, report(1)], [`gs|2025|2`, report(2)], [`gs|2025|3`, report(3)], [`gs|2025|4`, report(4)]]);
const calc = makeCalc(D);
test('09 연간(1~4분기) = 사업보고서 누적', () => { assert.equal(calc(GS, 2025, [1, 2, 3, 4], 'revenue').value, 1200); });
test('10 1~2분기 누적 = 반기 누적', () => { assert.equal(calc(GS, 2025, [1, 2], 'op').value, 40); });
test('11 비연속 2+4분기 = 2Q 단독 + (연간 − 3Q 누적)', () => { assert.equal(calc(GS, 2025, [2, 4], 'revenue').value, 300 + (1200 - 900)); });
test('12 3분기 단독(손익) = 3분기 당기값', () => { assert.equal(calc(GS, 2025, [3], 'net').value, 12.5); });
test('13 3분기 단독(현금흐름) = 3Q 누적 − 2Q 누적', () => { assert.equal(calc(GS, 2025, [3], 'cfo').value, 25); });
test('14 재무상태는 마지막 분기말 잔액(합산 안 함)', () => { assert.equal(calc(GS, 2025, [2, 4], 'assets').value, 2000); });
test('15 매출총이익: 계정 없으면 매출 − 원가', () => { assert.equal(calc(GS, 2025, [1, 2, 3, 4], 'gp').value, 120); });
test('16 순이자비용: 손익계산서 없으면 현금흐름표 이자지급(절댓값) − 이자수취', () => { const v = calc(GS, 2025, [1, 2, 3, 4], 'netInterest'); assert.equal(v.value, 20 - 8); assert.match(v.note, /현금기준 대체/); });
test('17 순이자비용: 손익계산서 이자비용이 있으면 우선', () => {
  const r = report(4, { extra: [row('IS', 'ifrs-full_InterestExpense', '이자비용', 33), row('IS', 'ifrs-full_InterestIncome', '이자수익', 3)] });
  const v = makeCalc(data([[`gs|2025|4`, r]]))(GS, 2025, [1, 2, 3, 4], 'netInterest'); assert.equal(v.value, 30); assert.match(v.note, /손익계산서/);
});
test('18 이자 계정 전무 → N/A (금융원가로 대체하지 않음)', () => {
  const r = report(4, { omit: ['이자의 지급', '이자의 수취'], extra: [row('IS', 'ifrs-full_FinanceCosts', '금융원가', 99)] });
  const v = makeCalc(data([[`gs|2025|4`, r]]))(GS, 2025, [1, 2, 3, 4], 'netInterest'); assert.equal(v.value, null); assert.match(v.note, /금융원가로 대체하지 않음/);
});
test('19 EBITDA = 영업이익 + 감가상각비, 감가상각 없으면 N/A', () => {
  assert.equal(calc(GS, 2025, [1, 2, 3, 4], 'ebitda').value, 110);
  const v = makeCalc(data([[`gs|2025|4`, report(4, { omit: ['감가상각비'] })]]))(GS, 2025, [1, 2, 3, 4], 'ebitda'); assert.equal(v.value, null);
});
test('20 총차입금 = 표시된 차입 계정 합(미표시 0), 순차입금 = 차입금 − 현금 − 단기금융상품', () => {
  assert.equal(calc(GS, 2025, [1, 2, 3, 4], 'borrow').value, 320); assert.equal(calc(GS, 2025, [1, 2, 3, 4], 'netBorrow').value, 120);
});
test('21 차입 계정이 하나도 없으면 N/A(0으로 만들지 않음)', () => {
  const v = makeCalc(data([[`gs|2025|4`, report(4, { omit: ['단기차입금', '사채', '리스부채'] })]]))(GS, 2025, [1, 2, 3, 4], 'borrow'); assert.equal(v.value, null);
});
test('22 비율 재계산: 원가율·영업이익률·부채비율·유동비율·차입금의존도', () => {
  near(calc(GS, 2025, [1, 2, 3, 4], 'costRatio').value, 90); near(calc(GS, 2025, [1, 2, 3, 4], 'margin').value, 80 / 1200 * 100);
  near(calc(GS, 2025, [1, 2, 3, 4], 'debtRatio').value, 150); near(calc(GS, 2025, [1, 2, 3, 4], 'currentRatio').value, 125);
  near(calc(GS, 2025, [1, 2, 3, 4], 'borrowDep').value, 16);
});
test('23 ROE = 지배순이익 / 평균 지배자본(전기말·당기말), ROA 동일 원칙', () => {
  near(calc(GS, 2025, [1, 2, 3, 4], 'roe').value, 45 / 650 * 100); near(calc(GS, 2025, [1, 2, 3, 4], 'roa').value, 50 / 1900 * 100);
  // 비연속 2+4분기: 지배순익(2Q 단독 + Q4 단독 = 22.5) / 평균(1분기말 700, 4분기말 700)
  near(calc(GS, 2025, [2, 4], 'roe').value, 22.5 / 700 * 100);
  assert.match(calc(GS, 2025, [2, 4], 'roe').note, /1분기말/);
});
test('24 이자보상배율 = 영업이익 / 이자비용(현금기준 대체)', () => { near(calc(GS, 2025, [1, 2, 3, 4], 'interestCover').value, 4); });
test('25 차입금/EBITDA 연환산: 1~2분기 × 2', () => {
  const a = makeCalc(D)(GS, 2025, [1, 2], 'borrowEbitda').value; const b = makeCalc(D, { annualize: true })(GS, 2025, [1, 2], 'borrowEbitda').value;
  near(b, a / 2);
});
test('26 분모 0 → N/A', () => {
  const r = report(4, { extra: [], omit: ['매출액'] }); r.acc.revenue = { ytd: 0, acc: 'IS · 매출액' };
  const v = makeCalc(data([[`gs|2025|4`, r]]))(GS, 2025, [1, 2, 3, 4], 'margin'); assert.equal(v.value, null); assert.match(v.note, /분모 0/);
});
test('27 주가 지표: 분기말 KRX 종가·시총·EPS·PER·PBR', () => {
  const prices = new Map([[2025, { basDd: '20251230', by: { '006360': { close: 20000, mktcap: 1.7e12, shares: 9 } } }]]);
  const c = makeCalc(data([[`gs|2025|4`, report(4)]], prices));
  assert.equal(c(GS, 2025, [1, 2, 3, 4], 'price').value, 20000); assert.equal(c(GS, 2025, [1, 2, 3, 4], 'eps').value, 5);
  assert.equal(c(GS, 2025, [1, 2, 3, 4], 'per').value, 4000); near(c(GS, 2025, [1, 2, 3, 4], 'pbr').value, 20000 / (700 / 9));
});
test('28 비상장사 주가 지표 → N/A(사유 표시), 적자 EPS → PER N/A', () => {
  const c = makeCalc(data([[`posco|2025|4`, report(4)]]));
  assert.match(c(POSCO, 2025, [1, 2, 3, 4], 'per').note, /비상장/);
  const prices = new Map([[2025, { basDd: '20251230', by: { '006360': { close: 20000, mktcap: 1, shares: 9 } } }]]);
  const r = report(4); r.acc.attributable = { ytd: -10, acc: 'IS · 지배' };
  assert.match(makeCalc(data([[`gs|2025|4`, r]], prices))(GS, 2025, [1, 2, 3, 4], 'per').note, /적자/);
});
test('29 미공시(null)·조회실패(undefined)·미래기간 구분', () => {
  const c = makeCalc(data([[`gs|2025|4`, null]]));
  assert.match(c(GS, 2025, [1, 2, 3, 4], 'revenue').note, /미공시/);
  assert.match(c(GS, 2024, [1, 2, 3, 4], 'revenue').note, /조회 실패/);
  assert.match(c(GS, 2099, [1], 'revenue').note, /미도래/);
});
test('30 수집 계획: 연속 선택은 마지막 분기만, 비연속은 해당·직전 분기', () => {
  assert.deepEqual(plan([GS], [2025], [1, 2, 3, 4]).map((x) => x[2]), [4]);
  assert.deepEqual(plan([GS], [2025], [2, 4]).map((x) => x[2]).sort(), [1, 2, 3, 4]);
  assert.ok([...FIN_CARDS, ...PNL_CARDS, ...PNL_EXTRA].every((k) => DEFS[k]), '모든 카드 지표 정의 존재');
});

/* ================== v1.7 로직 계산(공시 계정 간 산식·계정명 패턴·보조 출처) */
const one = (r, k, extra = {}) => makeCalc({ store: new Map([[`gs|2025|4`, r]]), prices: new Map(), ...extra })(GS, 2025, [1, 2, 3, 4], k);
test('31 결합 차입금 계정(단기차입금및유동성장기부채)을 정확 계정과 함께 합산·로직 표시', () => {
  const v = one(report(4, { extra: [row('BS', '-', '단기차입금및유동성장기부채', 70)] }), 'borrow');
  assert.equal(v.value, 320 + 70); assert.equal(v.logic, true); assert.match(v.note, /단기차입금및유동성장기부채\(로직\)/);
});
test('32 정확 계정이 없고 결합 계정만 있으면 결합 계정으로 계산, 소계(차입금) 중복 제외', () => {
  const r = report(4, { omit: ['단기차입금', '사채', '리스부채'], extra: [row('BS', '-', '단기차입금및사채', 300), row('BS', '-', '장기차입금(유동성제외)', 80), row('BS', '-', '차입금', 380)] });
  assert.equal(one(r, 'borrow').value, 380);
});
test('33 차입 성격이 아닌 계정 제외(사채할인발행차금·미지급이자·차입금충당)', () => {
  const v = one(report(4, { extra: [row('BS', '-', '사채할인발행차금', -5), row('BS', '-', '미지급이자(차입금)', 9), row('BS', '-', '전환권조정', -3)] }), 'borrow');
  assert.equal(v.value, 320);
});
test('34 판관비 계정 없음 → 로직: 매출총이익 − 영업이익', () => { const v = one(report(4, { omit: ['판매비와관리비'] }), 'sga'); assert.equal(v.value, 120 - 80); assert.equal(v.logic, true); });
test('35 매출원가 계정 없음 → 로직: 매출액 − 매출총이익', () => {
  const v = one(report(4, { omit: ['매출원가'], extra: [row('IS', 'ifrs-full_GrossProfit', '매출총이익', 120)] }), 'cost'); assert.equal(v.value, 1080); assert.equal(v.logic, true);
});
test('36 세전이익 계정 없음 → 로직: 당기순이익 + 법인세비용', () => {
  const v = one(report(4, { omit: ['법인세비용차감전순이익'], extra: [row('IS', 'ifrs-full_IncomeTaxExpenseContinuingOperations', '법인세비용', 20)] }), 'pretax'); assert.equal(v.value, 70);
});
test('37 지배순이익: 비지배순이익 차감 / 비지배 없으면 순이익 / 비지배 자본만 있으면 N/A', () => {
  const base = { omit: ['지배기업의 소유주에게 귀속되는 당기순이익'] };
  assert.equal(one(report(4, { ...base, extra: [row('IS', 'ifrs-full_ProfitLossAttributableToNoncontrollingInterests', '비지배지분', 6)] }), 'attributable').value, 44);
  assert.equal(one(report(4, base), 'attributable').value, 50);
  assert.equal(one(report(4, { ...base, extra: [row('BS', 'ifrs-full_NoncontrollingInterests', '비지배지분', 100)] }), 'attributable').value, null);
});
test('38 지배자본: 자본총계 − 비지배지분 / 비지배 없으면 자본총계', () => {
  const base = { omit: ['지배기업의 소유주에게 귀속되는 자본'] };
  assert.equal(one(report(4, { ...base, extra: [row('BS', 'ifrs-full_NoncontrollingInterests', '비지배지분', 100)] }), 'parentEquity').value, 700);
  assert.equal(one(report(4, base), 'parentEquity').value, 800);
});
test('39 감가상각 계정명 패턴 집계로 EBITDA(로직), 환입·손상은 제외', () => {
  const r = report(4, { omit: ['감가상각비'], extra: [row('CF', '-', '유형자산상각비(조정)', 25), row('CF', '-', '사용권자산 상각비', 5), row('CF', '-', '손상차손환입', 99)] });
  const v = one(r, 'ebitda'); assert.equal(v.value, 80 + 30); assert.equal(v.logic, true);
});
test('40 이자비용 계정명 변형(이자비용(금융원가)) 인식', () => {
  const v = one(report(4, { extra: [row('IS', '-', '이자비용(금융원가)', 18)] }), 'interestCost'); assert.equal(v.value, 18); assert.equal(v.logic, true);
});
test('41 이자 계정 전무 → DART 주요재무지표 이자보상배율(지표) 사용', () => {
  const r = report(4, { omit: ['이자의 지급', '이자의 수취'] });
  const v = one(r, 'interestCover', { stability: new Map([['gs|2025', { interestCover: 3.7, rcept: '20260315000999' }]]) });
  assert.equal(v.value, 3.7); assert.equal(v.alt, true); assert.match(v.src, /주요재무지표/);
});
test('42 EPS: DART 기본주당이익 우선 / 없으면 지배순익÷DART 유통주식수 / 비상장 BPS 계산·PER N/A', () => {
  assert.equal(one(report(4, { extra: [row('IS', 'ifrs-full_BasicEarningsLossPerShare', '기본주당이익', 512)] }), 'eps').value, 512);
  const sh = new Map([['gs|2025', { distb: 5, rcept: 'x' }]]);
  const e = one(report(4), 'eps', { shares: sh }); assert.equal(e.value, 9); assert.equal(e.logic, true);
  const pc = makeCalc({ store: new Map([[`posco|2025|4`, report(4)]]), prices: new Map(), shares: new Map([['posco|2025', { distb: 7, rcept: 'y' }]]) });
  assert.equal(pc(POSCO, 2025, [1, 2, 3, 4], 'bps').value, 100); assert.equal(pc(POSCO, 2025, [1, 2, 3, 4], 'per').value, null);
});
test('43 비연속 3분기 단독 ROA: 기초 = 2분기말', () => {
  const d2 = data([[`gs|2025|2`, report(2)], [`gs|2025|3`, report(3)]]);
  const v = makeCalc(d2)(GS, 2025, [3], 'roa'); near(v.value, 12.5 / 2000 * 100); assert.match(v.note, /2분기말/);
});
