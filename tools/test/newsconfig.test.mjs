// 뉴스 구분·키워드·관련도 단위 테스트 — 실행: node --test tools/test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPANIES } from '../../src/js/config.js';
import { COMPANY_NEWS, COMPANY_TOPICS, POLICY_TOPICS, PERIODS, companyQueries, policyQueries, relevance, dedupe, inPeriod, strip, pagesPerQuery, PAGE_BUDGET } from '../../src/js/newsconfig.js';

const co = (company, topic = 'all') => ({ kind: 'company', company, topic });
const pol = (topic) => ({ kind: 'policy', topic });
const it = (title, description = '') => ({ title, description });

test('모든 동종사(10개)에 뉴스 설정 존재 · 검색어 생성', () => {
  for (const c of COMPANIES) {
    assert.ok(COMPANY_NEWS[c.id], c.id);
    for (const t of COMPANY_TOPICS) {
      const qs = companyQueries(c.id, t.id);
      assert.ok(qs.length >= 1 && qs.length <= 6, `${c.id}/${t.id}`);
      assert.ok(qs.every((q) => q.length <= 100 && q.includes(COMPANY_NEWS[c.id].names[0]) || COMPANY_NEWS[c.id].alsoQuery?.includes(q)), `${c.id}/${t.id} ${qs}`);
    }
  }
});
test('요청한 5개 정책 구분 · 구분별 세부와 검색어', () => {
  assert.deepEqual(POLICY_TOPICS.map((t) => t.label), ['상법', '자본시장법', '주주총회', 'ESG', '부동산정책']);
  for (const t of POLICY_TOPICS) {
    assert.ok(t.groups.length >= 4, t.id);
    assert.ok(policyQueries(t.id).length >= 8, t.id);
    t.groups.forEach((g) => assert.ok(policyQueries(t.id, g.id).length >= 2, `${t.id}/${g.id}`));
  }
  assert.ok(policyQueries('agm', 'eagm').includes('전자주주총회'), '전자주주총회 포함');
  assert.equal(policyQueries('nope').length, 0);
});
test('정부 부동산 정책 핵심 분야 누락 없음', () => {
  const all = policyQueries('realestate').join(' ');
  for (const w of ['부동산 대책', '주택공급', 'DSR', '토지거래허가구역', '재건축', 'PF', '청약', '분양가 상한제', '전세사기', '양도세', '3기 신도시']) assert.ok(all.includes(w), w);
});
test('회사 관련도: 회사명 필수, 현대건설기계는 현대건설 기사 아님', () => {
  assert.ok(relevance(it('현대건설, 사우디 플랜트 수주'), co('hyundai')).ok);
  assert.ok(!relevance(it('현대건설기계 굴착기 판매 호조', '현대건설기계 실적'), co('hyundai')).ok);
  assert.ok(relevance(it('현대건설기계·현대건설 동반 상승', ''), co('hyundai')).ok, '둘 다 있으면 통과');
  assert.ok(!relevance(it('연예 소식', '드라마'), co('gs')).ok);
  assert.ok(relevance(it('HDC현산 아이파크 분양'), co('hdc', 'housing')).ok, '구 약칭');
  assert.ok(relevance(it('IPARK현대산업개발, 2026 기술제안 공모전 우수기술 선정'), co('hdc', 'all')).ok, '신 사명');
  assert.ok(companyQueries('hdc', 'all').includes('IPARK현대산업개발'), '신 사명 검색어');
  assert.ok(companyQueries('hdc', 'all').includes('HDC현대산업개발'), '구 사명 병행 검색어');
  assert.ok(relevance(it('삼성엔지니어링(현 삼성E&A) 수주'), co('samsungea', 'order')).ok);
});
test('회사 주제 필터: 주제어 없으면 제외 · 태그 부여', () => {
  assert.ok(!relevance(it('GS건설 사회공헌 봉사활동'), co('gs', 'earnings')).ok);
  const r = relevance(it('GS건설 3분기 영업이익 흑자전환', '신용등급 유지'), co('gs', 'earnings'));
  assert.ok(r.ok && r.tags.includes('실적·재무'));
  assert.ok(relevance(it('자이 신규 단지 청약 마감', 'GS건설 시공'), co('gs', 'housing')).ok, '브랜드');
  assert.ok(relevance(it('GS건설 현장 중대재해 발생'), co('gs', 'safety')).tags.includes('안전·사고'));
  const t = relevance(it('GS건설 수주', ''), co('gs')); const b = relevance(it('업계 동향', 'GS건설 언급'), co('gs'));
  assert.ok(t.score > b.score, '제목에 회사명이 있으면 관련도↑');
});
test('정책 관련도: 핵심어 필수 · 제외어', () => {
  assert.ok(relevance(it('상법 개정안 국회 본회의 통과', '이사 충실의무 주주로 확대'), pol('commercial')).ok);
  assert.ok(relevance(it('상법 개정안 통과', '이사 충실의무 주주'), pol('commercial')).tags.includes('이사 충실의무'));
  assert.ok(!relevance(it('신작 영화 개봉', '흥행'), pol('commercial')).ok);
  assert.ok(relevance(it('금융위, 자본시장법 시행령 개정'), pol('capital')).ok);
  assert.ok(relevance(it('삼성전자 전자주주총회 도입 검토'), pol('agm')).tags.includes('전자주주총회'));
  assert.ok(!relevance(it('아파트 입주자대표 주주총회 방식 논란', '입주자대표회의'), pol('agm')).ok, '입주자대표 제외');
  assert.ok(relevance(it('ESG 공시 의무화 2028년으로 연기', 'KSSB'), pol('esg')).tags.includes('ESG 공시 의무화'));
});
test('부동산정책: 분양 광고성 기사 제외, 정책 기사는 통과', () => {
  assert.ok(!relevance(it('래미안 견본주택 개관', '견본주택 개관 인파 청약 기대 분양'), pol('realestate')).ok, '견본주택 광고');
  assert.ok(!relevance(it('○○ 아파트 1순위 청약 마감', '청약 경쟁률 12대1'), pol('realestate')).ok, '정책 주체 없는 청약 기사');
  assert.ok(relevance(it('정부, 수도권 주택공급 대책 발표', '국토부 3기 신도시 조기 착공'), pol('realestate')).ok);
  assert.ok(relevance(it('스트레스 DSR 3단계 시행', '금융위 가계대출 규제'), pol('realestate')).tags.includes('대출·금융 규제'));
  assert.ok(relevance(it('서울시 토지거래허가구역 확대 지정'), pol('realestate')).tags.includes('규제지역·토허제'));
});
test('직접 검색: 필터 없이 통과', () => { assert.ok(relevance(it('아무 기사'), { kind: 'custom' }).ok); });
test('strip: 태그·엔티티 제거', () => {
  assert.equal(strip('<b>GS건설</b> &amp; &quot;자이&quot; &#39;x&#39;'), 'GS건설 & "자이" \'x\'');
  assert.equal(strip('<script>alert(1)</script>제목'), 'alert(1)제목');
  assert.equal(strip(null), '');
});
test('dedupe: 같은 제목(언론사만 다름) 묶음 · 가장 이른 보도 대표', () => {
  const a = { title: 'GS건설 대형 수주', link: 'l1', pubDate: 'Tue, 10 Nov 2026 09:00:00 +0900' };
  const b = { title: '<b>GS건설</b> 대형  수주', link: 'l2', pubDate: 'Tue, 10 Nov 2026 08:00:00 +0900' };
  const c = { title: 'GS건설 다른 기사', link: 'l3', pubDate: 'Tue, 10 Nov 2026 07:00:00 +0900' };
  const out = dedupe([a, b, c, { ...a }]);
  assert.equal(out.length, 2); const g = out.find((x) => x.dup === 1);
  assert.equal(g.link, 'l2', '이른 보도'); assert.equal(out.find((x) => x.link === 'l3').dup, 0);
});
test('inPeriod: 경계·잘못된 날짜·미래', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');
  assert.ok(inPeriod({ pubDate: new Date(now - 23 * 3600e3).toUTCString() }, 1, now));
  assert.ok(!inPeriod({ pubDate: new Date(now - 25 * 3600e3).toUTCString() }, 1, now));
  assert.ok(!inPeriod({ pubDate: 'garbage' }, 7, now));
  assert.ok(!inPeriod({ pubDate: new Date(now + 5 * 3600e3).toUTCString() }, 7, now));
});
test('기간 선택지 · 요청 상한', () => {
  assert.deepEqual(PERIODS.map((p) => p[1]), ['1일', '1주일', '2주일', '1개월', '3개월']);
  for (const [k] of PERIODS) for (const n of [1, 4, 9, 28, 40]) assert.ok(pagesPerQuery(k, n) * n <= Math.max(PAGE_BUDGET, n), `${k}/${n}`);
  assert.equal(pagesPerQuery('1d', 1), 1); assert.equal(pagesPerQuery('1m', 4), 4); assert.equal(pagesPerQuery('3m', 28), 1);
});
