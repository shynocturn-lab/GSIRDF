/* 장중 실시간 / 당일 정규장 마감가 병합 로직 (순수 함수 · 단위 테스트 대상)
 * 규칙:
 *  - 적용 시간: 평일 KST 09:00 이후 (주말 및 00:00~08:59 프리마켓 구간 배제)
 *  - 적용 조건: KRX 공식 확정일(basDd)이 오늘보다 과거이고, 네이버 정규장 거래일이 오늘과 일치할 때만 반영
 *  - NXT 프리/애프터마켓(overMarketPriceInfo)은 Worker 단계에서 원천 배제
 *  - 시가총액: KRX 상장주식수(shares) × 실시간 주가로 계산해 KRX 시총과 연속성 유지
 */

function kstParts(now = Date.now()) {
  const d = new Date(now + 9 * 3600e3);
  return {
    day: d.getUTCDay(),
    today: d.toISOString().slice(0, 10).replace(/-/g, ''),
    hhmm: d.getUTCHours() * 100 + d.getUTCMinutes(),
  };
}

/** 평일 09:00 KST 이후이고 KRX 당일 확정치가 아직 없는지 판별 */
export function shouldFetchRealtime(krxSnap, now = Date.now()) {
  if (!krxSnap) return false;
  const { day, today, hhmm } = kstParts(now);
  if (day === 0 || day === 6) return false;
  if (hhmm < 900) return false;
  if (krxSnap.basDd && krxSnap.basDd >= today) return false;
  return true;
}

/** KRX 확정 스냅샷 + 네이버 정규장 실시간/당일 마감가 병합 */
export function mergeRealtime(krxSnap, rt, now = Date.now()) {
  if (!krxSnap) return krxSnap;
  const base = { ...krxSnap, live: false, source: 'krx' };
  if (!rt || !Array.isArray(rt.stocks) || !rt.stocks.length) return base;
  const { day, today, hhmm } = kstParts(now);
  if (day === 0 || day === 6 || hhmm < 900) return base;
  if (!/^\d{8}$/.test(rt.date || '') || rt.date !== today) return base;
  if (krxSnap.basDd && rt.date <= krxSnap.basDd) return base;

  const rtByCode = new Map(
    rt.stocks
      .filter((s) => s && s.code && s.date === today && Number.isFinite(s.close) && s.close > 0)
      .map((s) => [s.code, s]),
  );
  if (!rtByCode.size) return base;

  const stocks = (krxSnap.stocks || []).map((k) => {
    const r = rtByCode.get(k.code);
    if (!r) return k;
    const change = Number.isFinite(r.change) ? r.change : (Number.isFinite(k.close) ? r.close - k.close : null);
    const rate = Number.isFinite(r.rate) ? r.rate : (Number.isFinite(k.close) && k.close > 0 ? ((r.close - k.close) / k.close) * 100 : null);
    const mktcap = Number.isFinite(k.shares) && k.shares > 0 ? Math.round(r.close * k.shares) : (r.mktcap ?? k.mktcap);
    const volume = Number.isFinite(r.volume) ? r.volume : k.volume;
    const value = Number.isFinite(r.value) ? r.value : (Number.isFinite(volume) ? Math.round(r.close * volume) : k.value);
    return {
      ...k,
      date: today,
      close: r.close,
      change,
      rate,
      open: Number.isFinite(r.open) ? r.open : k.open,
      high: Number.isFinite(r.high) ? r.high : k.high,
      low: Number.isFinite(r.low) ? r.low : k.low,
      volume,
      value,
      mktcap,
      live: r.marketStatus === 'OPEN',
      source: 'naver',
    };
  });

  const pickIdx = (rIdx, kIdx) => (rIdx && rIdx.date === today && Number.isFinite(rIdx.close) && rIdx.close > 0
    ? { ...rIdx, date: today, live: rIdx.marketStatus === 'OPEN', source: 'naver' }
    : kIdx || null);
  const index = {
    ...(krxSnap.index || {}),
    kospi: pickIdx(rt.index?.kospi, krxSnap.index?.kospi),
    kosdaq: pickIdx(rt.index?.kosdaq, krxSnap.index?.kosdaq),
  };
  const isOpen = rt.marketStatus === 'OPEN' || stocks.some((s) => s.live);
  return {
    ...krxSnap,
    basDd: today,
    krxBasDd: krxSnap.basDd,
    stocks,
    index,
    live: isOpen,
    source: 'naver',
    tradedAt: rt.time || '',
    marketStatus: isOpen ? 'OPEN' : 'CLOSE',
  };
}

/** 최근 3개월 KRX 종가 시계열 끝에 당일 실시간/정규장 마감가 1포인트 연결(원본 미변경) */
export function appendRealtimePoint(points, ticker, snap) {
  if (!Array.isArray(points) || !points.length || snap?.source !== 'naver') return points;
  const s = (snap.stocks || []).find((x) => x.code === ticker);
  if (!s || !Number.isFinite(s.close)) return points;
  const last = points[points.length - 1];
  if (!last || !snap.basDd || snap.basDd < last.date) return points;
  const kClose = Number.isFinite(snap.index?.kospi?.close) ? snap.index.kospi.close : null;
  const pt = {
    date: snap.basDd,
    kospi: kClose ?? (snap.basDd === last.date ? last.kospi : null),
    con: snap.basDd === last.date ? last.con : null,
    stocks: {
      ...(snap.basDd === last.date ? last.stocks : {}),
      [ticker]: { close: s.close, volume: s.volume, mktcap: s.mktcap },
    },
    live: !!snap.live,
  };
  if (snap.basDd === last.date) return [...points.slice(0, -1), pt];
  return [...points, pt];
}
