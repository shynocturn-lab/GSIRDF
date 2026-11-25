// 저장 정책·증분 조회 계산 테스트 — 실행: node --test tools/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ttlFor, cacheKey, isImmutable, isSettledDay, kstYmd, ecosMissing, ecosMerge, ecosSlice, MIN, HOUR, DAY } from '../../src/js/cachepolicy.js';

const NOW = Date.UTC(2026, 10, 11, 3, 0); // 2026-11-11 12:00 KST
const t = (path, params, data) => ttlFor(path, params, data, NOW);

test('01 상태·진단 응답은 저장하지 않음', () => { assert.equal(t('/api/health'), 0); assert.equal(t('/api/diag'), 0); });
test('02 KST 날짜·확정 거래일 판단(오늘·어제 제외)', () => {
  assert.equal(kstYmd(NOW), '20261111');
  assert.equal(isSettledDay('20261109', NOW), true); assert.equal(isSettledDay('20261110', NOW), false); assert.equal(isSettledDay('20261111', NOW), false);
});
test('03 최신 시세 20분, 과거 지정일 스냅샷(분기말 주가) 1년', () => {
  assert.equal(t('/api/krx/snapshot', { codes: '006360' }), 20 * MIN);
  assert.equal(t('/api/krx/snapshot', { codes: '006360', date: '20250930' }), 365 * DAY);
  assert.equal(t('/api/krx/snapshot', { codes: '006360', date: '20261110' }), 20 * MIN);
});
test('04 시계열: 모두 확정일이면 1년, 오늘 포함이면 20분', () => {
  assert.equal(t('/api/krx/series', { dates: '20261104,20261105' }), 365 * DAY);
  assert.equal(t('/api/krx/series', { dates: '20261105,20261111' }), 20 * MIN);
});
test('05 공시목록 10분 · 회사개요 7일 · 뉴스 5분', () => {
  assert.equal(t('/api/dart/list.json'), 10 * MIN); assert.equal(t('/api/dart/company.json'), 7 * DAY); assert.equal(t('/api/naver/news'), 5 * MIN);
});
test('06 재무보고서 미공시(013) 6시간 → 공시되면 곧 반영', () => {
  assert.equal(t('/api/dart/fnlttSinglAcntAll.json', { bsns_year: 2026, reprt_code: '11014' }, { status: '013' }), 6 * HOUR);
});
test('07 재무보고서 오류 응답은 저장하지 않음', () => {
  assert.equal(t('/api/dart/fnlttSinglAcntAll.json', { bsns_year: 2026, reprt_code: '11012' }, { status: '020' }), 0);
});
test('08 오래된 보고서(기간 종료 15개월 경과) 180일, 최근 보고서 1일(정정 가능성)', () => {
  assert.equal(t('/api/dart/fnlttSinglAcntAll.json', { bsns_year: 2024, reprt_code: '11011' }, { status: '000' }), 180 * DAY);
  assert.equal(t('/api/dart/fnlttSinglAcntAll.json', { bsns_year: 2025, reprt_code: '11011' }, { status: '000' }), DAY);
  assert.equal(t('/api/dart/stockTotqySttus.json', { bsns_year: 2026, reprt_code: '11012' }, { status: '000' }), DAY);
});
test('09 확정 데이터 판별(새로고침해도 다시 받지 않음)', () => { assert.equal(isImmutable(365 * DAY), true); assert.equal(isImmutable(DAY), false); });
test('10 캐시 키: 파라미터 정렬·빈 값 제외 → 같은 요청은 같은 키', () => {
  assert.equal(cacheKey('/api/x', { b: 2, a: 1, c: '' }), cacheKey('/api/x', { a: 1, b: 2 }));
  assert.equal(cacheKey('/api/x', { a: 1 }), '/api/x?a=1');
});
/* ---- ECOS 증분 */
const H = (n) => NOW - n * HOUR;
const entry = { from: '20251101', to: '20261111', fetchedAt: H(1), rows: [{ time: '20251103', value: 1 }, { time: '20261110', value: 2 }] };
test('11 저장본 없음 → 전체 구간 조회', () => { assert.deepEqual(ecosMissing(null, '20251101', '20261111', NOW), [['20251101', '20261111']]); });
test('12 저장 구간 안 + 최신(3시간 이내) → 추가 조회 없음', () => { assert.deepEqual(ecosMissing(entry, '20260101', '20261111', NOW), []); });
test('13 3년으로 확대 → 앞쪽 부족분만 조회', () => { assert.deepEqual(ecosMissing(entry, '20231111', '20261111', NOW), [['20231111', '20251031']]); });
test('14 저장본 오래됨 → 최근 10일만 재조회(수정치 반영)', () => { assert.deepEqual(ecosMissing({ ...entry, fetchedAt: H(5) }, '20260101', '20261111', NOW), [['20261101', '20261111']]); });
test('15 다음날 조회(끝 날짜 이동) → 뒤쪽만 조회', () => { assert.deepEqual(ecosMissing(entry, '20260101', '20261112', NOW), [['20261101', '20261112']]); });
test('16 앞·뒤 모두 부족 → 두 구간', () => { assert.equal(ecosMissing({ ...entry, fetchedAt: H(9) }, '20240101', '20261111', NOW).length, 2); });
test('17 병합: 새 값 우선(수정치), 구간 확장, 날짜순', () => {
  const m = ecosMerge(entry, [[{ time: '20261110', value: 9 }, { time: '20261111', value: 3 }], [{ time: '20241231', value: 0 }]], '20241201', '20261111', NOW);
  assert.equal(m.from, '20241201'); assert.equal(m.to, '20261111');
  assert.deepEqual(m.rows.map((r) => r.time), ['20241231', '20251103', '20261110', '20261111']);
  assert.equal(m.rows.find((r) => r.time === '20261110').value, 9);
});
test('18 요청 구간만 잘라 반환', () => { assert.deepEqual(ecosSlice(entry, '20260101', '20261111').map((r) => r.time), ['20261110']); });
