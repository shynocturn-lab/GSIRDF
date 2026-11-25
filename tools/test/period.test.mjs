// 분기/누적 기준 단위 테스트 — 실행: node --test tools/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementRows, comparative, normalize, quarterRange, latestFiledQuarter, makeCalc } from '../../src/js/peerdata.js';
import { periodText, qsFor, basisOf, quartersFor } from '../../src/js/period.js';
import { companyById } from '../../src/js/config.js';

/* 실제 DART 형식: 손익 thstrm = 3개월(4분기 보고서는 연간), add = 누적 / 현금흐름 thstrm = 누적 / 재무상태 = 잔액 */
const R = (sj, id, nm, cur, add = '', prev = '', prevAdd = '') => ({ sj_div: sj, account_id: id, account_nm: nm, thstrm_amount: String(cur), thstrm_add_amount: String(add), frmtrm_amount: String(prev), frmtrm_add_amount: String(prevAdd) });
// 분기 단독 매출: 1Q 100 · 2Q 120 · 3Q 130 · 4Q 150 (연간 500) / 전년: 90 · 100 · 110 · 100 (연간 400)
const CUR = [100, 120, 130, 150]; const PRV = [90, 100, 110, 100];
const ytd = (a, q) => a.slice(0, q).reduce((s, v) => s + v, 0);
const CFO = [30, 20, 25, 45]; const CFOP = [10, 10, 10, 10];
function rep(q) {
  const rows = [
    q === 4 ? R('IS', 'ifrs-full_Revenue', '매출액', 500, '', 400, '') : R('IS', 'ifrs-full_Revenue', '매출액', CUR[q - 1], ytd(CUR, q), PRV[q - 1], ytd(PRV, q)),
    q === 4 ? R('CIS', 'dart_OperatingIncomeLoss', '영업이익', 50, '', 40) : R('CIS', 'dart_OperatingIncomeLoss', '영업이익', CUR[q - 1] / 10, ytd(CUR, q) / 10, PRV[q - 1] / 10, ytd(PRV, q) / 10),
    R('BS', 'ifrs-full_Assets', '자산총계', 1000 + q, '', 900),
    R('BS', '-표준계정코드 미사용-', '단기금융상품', 50, '', 40),
    R('CF', 'ifrs-full_CashFlowsFromUsedInOperatingActivities', '영업활동현금흐름', ytd(CFO, q), '', ytd(CFOP, q)),
    R('SCE', 'x', '자본변동', 1, '', 1),
  ];
  return { y: 2025, q, rows };
}
const find = (rows, nm) => rows.find((r) => r.name === nm);

test('손익 단독: 1~3분기는 3개월 당기·전년 동기', () => {
  for (const q of [1, 2, 3]) {
    const r = find(statementRows(rep(q), q > 1 ? rep(q - 1) : null, 'single'), '매출액');
    assert.equal(r.cur, CUR[q - 1]); assert.equal(r.prior, PRV[q - 1]);
  }
});
test('손익 단독 4분기 = 연간 − 3분기 누적(당기·전년 모두)', () => {
  const r = find(statementRows(rep(4), rep(3), 'single'), '매출액');
  assert.equal(r.cur, 150); assert.equal(r.prior, 100); assert.match(r.note, /연간/);
});
test('손익 단독 4분기 — 3분기 보고서 없으면 N/A(추정하지 않음)', () => {
  const r = find(statementRows(rep(4), null, 'single'), '매출액');
  assert.equal(r.cur, null); assert.equal(r.chg, null);
});
test('손익 누적: 1Q = 단독, 2·3Q = 누적, 4Q = 연간', () => {
  assert.equal(find(statementRows(rep(1), null, 'ytd'), '매출액').cur, 100);
  assert.equal(find(statementRows(rep(2), rep(1), 'ytd'), '매출액').cur, 220);
  const r3 = find(statementRows(rep(3), rep(2), 'ytd'), '매출액');
  assert.equal(r3.cur, 350); assert.equal(r3.prior, 300);
  const r4 = find(statementRows(rep(4), rep(3), 'ytd'), '매출액');
  assert.equal(r4.cur, 500); assert.equal(r4.prior, 400);
});
test('누적 = 단독 분기 합 (1~4분기 전 구간)', () => {
  for (const q of [1, 2, 3, 4]) {
    const y = find(statementRows(rep(q), q > 1 ? rep(q - 1) : null, 'ytd'), '매출액').cur;
    const s = [1, 2, 3, 4].slice(0, q).reduce((t, k) => t + find(statementRows(rep(k), k > 1 ? rep(k - 1) : null, 'single'), '매출액').cur, 0);
    assert.equal(y, s, `q${q}`);
  }
});
test('포괄손익계산서(CIS)도 손익으로 분류', () => {
  const r = find(statementRows(rep(2), rep(1), 'single'), '영업이익');
  assert.equal(r.sj, 'IS'); assert.equal(r.cur, 12);
});
test('현금흐름 단독 = 당 분기 누적 − 직전 분기 누적, 누적은 그대로', () => {
  assert.equal(find(statementRows(rep(1), null, 'single'), '영업활동현금흐름').cur, 30);
  const s3 = find(statementRows(rep(3), rep(2), 'single'), '영업활동현금흐름');
  assert.equal(s3.cur, 25); assert.equal(s3.prior, 10);
  assert.equal(find(statementRows(rep(4), rep(3), 'single'), '영업활동현금흐름').cur, 45);
  assert.equal(find(statementRows(rep(3), rep(2), 'ytd'), '영업활동현금흐름').cur, 75);
  assert.equal(find(statementRows(rep(3), null, 'single'), '영업활동현금흐름').cur, null);
});
test('재무상태: 기준과 무관하게 기말 vs 전기말', () => {
  const a = find(statementRows(rep(3), rep(2), 'single'), '자산총계');
  const b = find(statementRows(rep(3), rep(2), 'ytd'), '자산총계');
  assert.deepEqual([a.cur, a.prior], [1003, 900]); assert.deepEqual([b.cur, b.prior], [1003, 900]);
});
test('표준계정코드 미사용 계정은 계정명으로 매칭, 자본변동표 등은 제외', () => {
  const rows = statementRows(rep(2), rep(1), 'single');
  assert.equal(find(rows, '단기금융상품').cur, 50);
  assert.ok(!rows.some((r) => r.name === '자본변동'));
});
test('증감률 계산 · 0/결측 보호', () => {
  const r = find(statementRows(rep(2), rep(1), 'single'), '매출액');
  assert.equal(r.chg, 20);
  const z = statementRows({ q: 2, rows: [R('IS', 'a', 'A', 10, 20, 0, 0), R('IS', 'b', 'B', '', '', '', '')] }, null, 'single');
  assert.equal(z[0].chg, null); assert.equal(z[1].cur, null);
});
test('빈 보고서 · null 입력 안전', () => {
  assert.deepEqual(statementRows(null, null, 'single'), []);
  assert.deepEqual(statementRows({ q: 1 }, null, 'ytd'), []);
});
test('comparative: XBRL ID 우선 → 계정명, KPI가 표와 같은 값 사용', () => {
  const rows = statementRows(rep(2), rep(1), 'single');
  assert.equal(comparative(rows, 'revenue').cur, 120);
  assert.equal(comparative(rows, 'op').prior, 10);
  assert.equal(comparative(rows, 'nope'), null);
  const byName = statementRows({ q: 2, rows: [R('IS', '-표준계정코드 미사용-', '수익(매출액)', 7, 14, 5, 10)] }, null, 'single');
  assert.equal(comparative(byName, 'revenue').cur, 7);
});
test('quarterRange: 연도 경계 · 단일 · 역순', () => {
  assert.deepEqual(quarterRange(2024, 3, 2025, 2).map(({ y, q }) => `${y}.${q}`), ['2024.3', '2024.4', '2025.1', '2025.2']);
  assert.equal(quarterRange(2025, 2, 2025, 2).length, 1);
  assert.equal(quarterRange(2025, 3, 2025, 2).length, 0);
  assert.equal(quarterRange(2023, 1, 2025, 4).length, 12);
});
test('latestFiledQuarter: 분기말+45일 / 사업보고서 +90일', () => {
  assert.deepEqual(latestFiledQuarter('20261111'), { y: 2026, q: 2 });   // 3Q말+42일 → 아직 2Q
  assert.deepEqual(latestFiledQuarter('20261114'), { y: 2026, q: 3 });   // +45일
  assert.deepEqual(latestFiledQuarter('20260315'), { y: 2025, q: 3 });   // 연간은 3/31(+90일) 이후
  assert.deepEqual(latestFiledQuarter('20260331'), { y: 2025, q: 4 });
  assert.deepEqual(latestFiledQuarter('20260516'), { y: 2026, q: 1 });
});
test('periodText · qsFor', () => {
  assert.equal(periodText(2026, 2, 'single'), '2026 2Q');
  assert.equal(periodText(2026, 2, 'ytd'), '2026 1~2Q 누적');
  assert.equal(periodText(2026, 1, 'ytd'), '2026 1Q');
  assert.equal(periodText(2025, 4, 'ytd'), '2025 연간');
  assert.deepEqual(qsFor(3, 'ytd'), [1, 2, 3]); assert.deepEqual(qsFor(3, 'single'), [3]);
});
test('basisOf ↔ quartersFor 왕복', () => {
  assert.deepEqual(basisOf([1, 2, 3, 4]), { b: 'annual', q: 4 });
  assert.deepEqual(basisOf([1, 2]), { b: 'ytd', q: 2 });
  assert.deepEqual(basisOf([3]), { b: 'single', q: 3 });
  assert.deepEqual(basisOf([2, 4]), { b: 'custom', q: 4 });
  assert.deepEqual(basisOf([]), { b: 'custom', q: 4 });
  for (const b of ['ytd', 'single']) for (const q of [1, 2, 3]) {
    const r = basisOf(quartersFor(b, q));
    assert.equal(r.q, q);
    assert.equal(r.b, q === 1 ? 'single' : b);   // 1분기 누적 = 1분기 단독
  }
  assert.deepEqual(quartersFor('annual', 2), [1, 2, 3, 4]);
});
test('makeCalc 단독 4분기 = 연간 − 3분기 누적, 누적 = 합', () => {
  const store = new Map();
  for (const q of [1, 2, 3, 4]) { const r = rep(q); store.set(`gs|2025|${q}`, { ...r, fs: 'CFS', rcept: 'r' + q, acc: normalize(r.rows, q) }); }
  const calc = makeCalc({ store, prices: new Map(), shares: new Map(), stability: new Map() });
  const c = companyById('gs');
  assert.equal(calc(c, 2025, [4], 'revenue').value, 150);
  assert.equal(calc(c, 2025, [2], 'revenue').value, 120);
  assert.equal(calc(c, 2025, [1, 2, 3], 'revenue').value, 350);
  assert.equal(calc(c, 2025, [1, 2, 3, 4], 'revenue').value, 500);
});
