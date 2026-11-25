/* 주가 탭 계산(순수 함수 · 단위 테스트 대상) */

/** 첫 유효값을 기준(=base)으로 환산. 결측은 null 유지 */
export function rebase(values, base = 100) {
  const first = values.find((v) => Number.isFinite(v) && v !== 0);
  return values.map((v) => (Number.isFinite(v) && first ? (v / first) * base : null));
}

/** 기간 수익률(%) — 첫·마지막 유효값 */
export function periodReturn(values) {
  const v = values.filter(Number.isFinite);
  return v.length > 1 && v[0] !== 0 ? (v.at(-1) / v[0] - 1) * 100 : null;
}

/**
 * 종목 vs 지수 상대성과. 두 시계열이 모두 있는 날짜만 사용해 같은 구간을 비교한다.
 * @returns {{ret:number|null, idxRet:number|null, excess:number|null, from:string|null, to:string|null}}
 */
export function relative(dates, stock, index) {
  const both = dates.map((d, i) => [d, stock[i], index[i]]).filter(([, s, x]) => Number.isFinite(s) && Number.isFinite(x));
  if (both.length < 2) return { ret: null, idxRet: null, excess: null, from: null, to: null };
  const [f, l] = [both[0], both.at(-1)];
  const ret = (l[1] / f[1] - 1) * 100;
  const idxRet = (l[2] / f[2] - 1) * 100;
  return { ret, idxRet, excess: ret - idxRet, from: f[0], to: l[0] };
}

/** 주가배수 대체 계산: 가격 / 주당값 (주당값이 0 이하·결측이면 null) */
export function multiple(price, perShare) {
  return Number.isFinite(price) && Number.isFinite(perShare) && perShare > 0 ? price / perShare : null;
}
