// 회사 정보 파서 · 주가 계산 단위 테스트 — 실행: node --test tools/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCompany, parseMajor, parseMinority, parseEmployees, parseExecutives, parseShares, num } from '../../src/js/corpinfo.js';
import { rebase, periodReturn, relative, multiple } from '../../src/js/stockcalc.js';
import { ttlFor } from '../../src/js/cachepolicy.js';

test('num: 쉼표·하이픈·공백·문자', () => {
  assert.equal(num('1,234'), 1234); assert.equal(num('-'), null); assert.equal(num(''), null); assert.equal(num(' 12.5 '), 12.5);
  assert.equal(num('abc'), null); assert.equal(num(undefined), null); assert.equal(num('-3,000'), -3000);
});
test('기업개황: 시장구분·설립일·홈페이지 정규화', () => {
  const c = parseCompany({ status: '000', corp_name: '지에스건설', corp_cls: 'Y', est_dt: '19691219', acc_mt: '12', hm_url: 'www.gsenc.com', ir_url: 'javascript:alert(1)', ceo_nm: '허윤홍' });
  assert.equal(c.market, '유가증권시장'); assert.equal(c.established, '1969.12.19'); assert.equal(c.fiscalMonth, '12월');
  assert.equal(c.homepage, 'https://www.gsenc.com/'); assert.equal(c.ir, '', '위험 스킴 차단');
  assert.equal(parseCompany({ status: '013' }), null); assert.equal(parseCompany(null), null);
  assert.equal(parseCompany({ status: '000', corp_cls: 'E' }).market, '기타(비상장)');
});
test('최대주주: 계 행 분리 · 지분율 내림차순 · 합계', () => {
  const m = parseMajor({ status: '000', list: [
    { nm: '특수1', relate: '특수관계인', stock_knd: '보통주', trmend_posesn_stock_co: '100', trmend_posesn_stock_qota_rt: '1.20' },
    { nm: '본인', relate: '최대주주 본인', stock_knd: '보통주', trmend_posesn_stock_co: '1,000', trmend_posesn_stock_qota_rt: '10.50' },
    { nm: '계', relate: '-', stock_knd: '보통주', trmend_posesn_stock_qota_rt: '11.70' },
  ] });
  assert.equal(m.holders.length, 2); assert.equal(m.largest.name, '본인'); assert.equal(m.totalRate, 11.7);
  const noTotal = parseMajor({ status: '000', list: [{ nm: 'A', stock_knd: '보통주', trmend_posesn_stock_qota_rt: '3' }, { nm: 'B', stock_knd: '보통주', trmend_posesn_stock_qota_rt: '2' }] });
  assert.equal(noTotal.totalRate, 5, '계 행 없으면 보통주 합산');
  assert.equal(parseMajor({ status: '013' }), null);
});
test('소액주주: % 기호 처리', () => {
  const m = parseMinority({ status: '000', list: [{ se: '소액주주', shrholdr_co: '98,765', shrholdr_rate: '99.86%', hold_stock_co: '55,000,000', hold_stock_rate: '64.27%' }] });
  assert.deepEqual([m.holders, m.holderRate, m.shares, m.shareRate], [98765, 99.86, 55000000, 64.27]);
  assert.equal(parseMinority({ status: '000', list: [] }), null);
});
test('직원: 합계 행 제외 후 부문·성별 합산, 인원 가중 평균', () => {
  const e = parseEmployees({ status: '000', list: [
    { fo_bbm: '건축', sexdstn: '남', rgllbr_co: '2,000', cnttk_co: '800', sm: '2,800', avrg_cnwk_sdytrn: '14.2', jan_salary_am: '100,000,000', fyer_salary_totamt: '280,000,000,000' },
    { fo_bbm: '건축', sexdstn: '여', rgllbr_co: '300', cnttk_co: '100', sm: '400', avrg_cnwk_sdytrn: '9.0', jan_salary_am: '75,000,000', fyer_salary_totamt: '30,000,000,000' },
    { fo_bbm: '합계', sexdstn: '', rgllbr_co: '2,300', cnttk_co: '900', sm: '3,200' },
  ] });
  assert.deepEqual([e.total, e.regular, e.contract, e.male, e.female], [3200, 2300, 900, 2800, 400]);
  assert.ok(Math.abs(e.tenure - (14.2 * 2800 + 9 * 400) / 3200) < 1e-9);
  assert.equal(Math.round(e.avgSalary), Math.round((1e8 * 2800 + 7.5e7 * 400) / 3200));
  assert.equal(e.salaryTotal, 310e9); assert.deepEqual(e.segments, ['건축']);
});
test('직원: 합계(sm) 없으면 정규+계약, 합계 행만 있으면 그것 사용', () => {
  assert.equal(parseEmployees({ status: '000', list: [{ fo_bbm: 'A', sexdstn: '남', rgllbr_co: '10', cnttk_co: '5', sm: '-' }] }).total, 15);
  assert.equal(parseEmployees({ status: '000', list: [{ fo_bbm: '합계', sexdstn: '', rgllbr_co: '10', cnttk_co: '5', sm: '15' }] }).total, 15);
});
test('임원: 등기·미등기 구분', () => {
  const x = parseExecutives({ status: '000', list: [{ nm: 'A', rgist_exctv_at: '사내이사' }, { nm: 'B', rgist_exctv_at: '사외이사' }, { nm: 'C', rgist_exctv_at: '미등기' }] });
  assert.deepEqual([x.total, x.registered, x.unregistered], [3, 2, 1]); assert.deepEqual(x.board.map((b) => b.name), ['A', 'B']);
});
test('주식총수: 합계·보통·우선·자기주식', () => {
  const s = parseShares({ status: '000', list: [{ se: '보통주', istc_totqy: '80', tesstk_co: '2' }, { se: '우선주', istc_totqy: '5' }, { se: '합계', istc_totqy: '85', tesstk_co: '2', distb_stock_co: '83' }] });
  assert.deepEqual([s.issued, s.common, s.preferred, s.treasury, s.floating], [85, 80, 5, 2, 83]);
});
test('rebase · periodReturn: 결측·0 보호', () => {
  assert.deepEqual(rebase([null, 50, 75, null]), [null, 100, 150, null]);
  assert.deepEqual(rebase([0, 0]), [null, null]);
  assert.equal(periodReturn([100, null, 110]).toFixed(4), '10.0000'); assert.equal(periodReturn([5]), null);
});
test('relative: 두 시계열 공통 날짜만으로 비교', () => {
  const r = relative(['d1', 'd2', 'd3', 'd4'], [100, 110, 120, null], [null, 50, 55, 60]);
  assert.equal(r.from, 'd2'); assert.equal(r.to, 'd3');
  assert.ok(Math.abs(r.ret - 9.0909) < 1e-3); assert.ok(Math.abs(r.idxRet - 10) < 1e-9); assert.ok(Math.abs(r.excess - (r.ret - 10)) < 1e-9);
  assert.equal(relative(['a'], [1], [1]).excess, null);
});
test('multiple: 적자·결측이면 null', () => {
  assert.equal(multiple(20000, 2000), 10); assert.equal(multiple(20000, -500), null); assert.equal(multiple(null, 100), null); assert.equal(multiple(100, 0), null);
});
test('TTL: 투자지표 30분, 회사정보 과거 보고서 장기·미공시 짧게', () => {
  assert.equal(ttlFor('/api/stock/info', { code: '006360' }), 30 * 60e3);
  const old = ttlFor('/api/dart/hyslrSttus.json', { bsns_year: 2023, reprt_code: '11011' }, { status: '000' });
  assert.ok(old >= 30 * 86400e3);
  assert.ok(ttlFor('/api/dart/empSttus.json', { bsns_year: 2026, reprt_code: '11014' }, { status: '013' }) <= 6 * 3600e3);
});
