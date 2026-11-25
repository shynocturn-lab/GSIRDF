import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldFetchRealtime, mergeRealtime, appendRealtimePoint } from '../../src/js/realtime.js';

const KRX = {
  basDd: '20261120',
  stocks: [
    { date: '20261120', code: '006360', name: 'GS건설', close: 28650, change: -1500, rate: -4.98, open: 29750, high: 29750, low: 28250, volume: 801414, value: 23300000000, mktcap: 2451867000000, shares: 85580000 },
  ],
  index: { kospi: { date: '20261120', name: '코스피', close: 4869.96, change: -267.5, rate: -5.21 }, kosdaq: null, construction: null },
};
const RT_OPEN = {
  source: '네이버 증권', date: '20261123', time: '10:15', marketStatus: 'OPEN',
  stocks: [{ code: '006360', name: 'GS건설', date: '20261123', time: '10:15', marketStatus: 'OPEN', close: 29500, change: 850, rate: 2.97, open: 28900, high: 29600, low: 28800, volume: 320000, value: 9400000000, mktcap: null }],
  index: { kospi: { code: 'KOSPI', name: '코스피', date: '20261123', time: '10:15', marketStatus: 'OPEN', close: 4920.12, change: 50.16, rate: 1.03 }, kosdaq: null },
};
const kst = (iso) => Date.parse(iso + '+09:00');

test('shouldFetchRealtime: 주말·09:00 전·KRX 확정 완료 시 false, 평일 09:00 이후 미확정 시 true', () => {
  assert.equal(shouldFetchRealtime(KRX, kst('2026-11-21T15:00:00')), false); // 토요일
  assert.equal(shouldFetchRealtime(KRX, kst('2026-11-22T10:00:00')), false); // 일요일
  assert.equal(shouldFetchRealtime(KRX, kst('2026-11-23T08:50:00')), false); // 월요일 NXT 프리마켓 차단
  assert.equal(shouldFetchRealtime(KRX, kst('2026-11-23T09:00:00')), true);  // 월요일 정규장 개장
  assert.equal(shouldFetchRealtime(KRX, kst('2026-11-23T16:10:00')), true);  // 마감 후 KRX 확정 전
  assert.equal(shouldFetchRealtime({ ...KRX, basDd: '20261123' }, kst('2026-11-23T19:00:00')), false); // KRX 확정 후
});

test('mergeRealtime: 장중 실시간 병합 + KRX 상장주식수 기준 시가총액 산출', () => {
  const m = mergeRealtime(KRX, RT_OPEN, kst('2026-11-23T10:15:00'));
  assert.equal(m.live, true);
  assert.equal(m.source, 'naver');
  assert.equal(m.basDd, '20261123');
  assert.equal(m.stocks[0].close, 29500);
  assert.equal(m.stocks[0].mktcap, 29500 * 85580000);
  assert.equal(m.index.kospi.close, 4920.12);
});

test('mergeRealtime: 공휴일(네이버 거래일이 직전 영업일)에는 병합 거부 → KRX 유지', () => {
  const holidayRt = { ...RT_OPEN, date: '20261120', marketStatus: 'CLOSE', stocks: [{ ...RT_OPEN.stocks[0], date: '20261120', marketStatus: 'CLOSE' }] };
  const m = mergeRealtime(KRX, holidayRt, kst('2026-11-23T11:00:00'));
  assert.equal(m.source, 'krx');
  assert.equal(m.basDd, '20261120');
  assert.equal(m.stocks[0].close, 28650);
});

test('appendRealtimePoint: 최근 3개월 차트 끝에 당일 1포인트 연결', () => {
  const pts = [{ date: '20261120', kospi: 4869.96, con: 100, stocks: { '006360': { close: 28650 } } }];
  const m = mergeRealtime(KRX, RT_OPEN, kst('2026-11-23T10:15:00'));
  const out = appendRealtimePoint(pts, '006360', m);
  assert.equal(out.length, 2);
  assert.equal(pts.length, 1); // 원본 미변경
  assert.equal(out[1].date, '20261123');
  assert.equal(out[1].stocks['006360'].close, 29500);
  assert.equal(out[1].kospi, 4920.12);
});
