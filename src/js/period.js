/* 조회 기준(분기 단독 / 누적 / 연간) 순수 함수 — DOM 의존 없음(단위 테스트 대상) */

/** 재무 화면 기간 표기 */
export function periodText(y, q, basis) {
  if (basis === 'ytd') return q === 1 ? `${y} 1Q` : q === 4 ? `${y} 연간` : `${y} 1~${q}Q 누적`;
  return `${y} ${q}Q`;
}
/** 재무 화면: 기준 분기 + 기준 → 합산할 분기 목록 */
export const qsFor = (q, basis) => (basis === 'ytd' ? Array.from({ length: q }, (_, i) => i + 1) : [q]);

/** 동종사: 선택 분기 조합 → 조회 기준(연간/누적/단독/사용자 조합) */
export function basisOf(qs) {
  if (qs.length === 4) return { b: 'annual', q: 4 };
  if (qs.length === 1) return { b: 'single', q: qs[0] };
  if (qs.length && qs.every((q, i) => q === i + 1)) return { b: 'ytd', q: qs.at(-1) };
  return { b: 'custom', q: qs.at(-1) || 4 };
}
/** 동종사: 기준 + 기준 분기 → 분기 목록 */
export function quartersFor(b, q) {
  if (b === 'annual') return [1, 2, 3, 4];
  if (b === 'single') return [q];
  return Array.from({ length: q }, (_, i) => i + 1);
}
