/* 뉴스 구분·키워드 설정 + 관련도 필터(순수 함수 · 단위 테스트 대상)
 *
 * 원리: 네이버 뉴스 검색은 단어가 '어디든' 포함되면 결과로 돌려준다. 그래서
 *  ① 구분마다 여러 개의 구체적 검색어로 나눠 조회(각 100건 · 기간만큼 페이지 이동)하고
 *  ② 제목+요약에 구분의 '핵심어(must)'가 실제로 있는 기사만 남기며(exclude는 제외)
 *  ③ 같은 기사(제목 동일)는 하나로 묶어 "같은 기사 n건"으로 표시한다. */

export const PERIODS = [['1d', '1일', 1], ['1w', '1주일', 7], ['2w', '2주일', 14], ['1m', '1개월', 31], ['3m', '3개월', 92]];
/** 기간별 검색어당 최대 페이지(100건/페이지) — 최신순일 때 기간 끝에 닿으면 더 일찍 멈춘다 */
export const MAX_PAGES = { '1d': 1, '1w': 2, '2w': 3, '1m': 4, '3m': 5 };
/** 한 화면 조회 상한(요청 수). 검색어가 많으면 검색어당 페이지를 줄인다 */
export const PAGE_BUDGET = 32;
export function pagesPerQuery(period, nQueries) {
  return Math.max(1, Math.min(MAX_PAGES[period] || 1, Math.floor(PAGE_BUDGET / Math.max(1, nQueries))));
}

/* ------------------------------------------------------------ 회사별 */
/** names: 회사를 가리키는 표기(하나라도 있어야 관련 기사) · exclude: 다른 회사로 오인되는 표기 · brands: 주택 브랜드 */
export const COMPANY_NEWS = {
  gs: { names: ['GS건설', '지에스건설'], brands: ['자이', 'Xi'] },
  samsungcnt: { names: ['삼성물산'], brands: ['래미안'], focus: '건설부문' },
  hyundai: { names: ['현대건설'], exclude: ['현대건설기계'], brands: ['힐스테이트', '디에이치'] },
  daewoo: { names: ['대우건설'], brands: ['푸르지오', '써밋'] },
  dl: { names: ['DL이앤씨', 'DL E&C', '디엘이앤씨'], brands: ['아크로', 'e편한세상'] },
  posco: { names: ['포스코이앤씨', '포스코E&C'], brands: ['더샵', '오티에르'] },
  lotte: { names: ['롯데건설'], brands: ['롯데캐슬', '르엘'] },
  skeco: { names: ['SK에코플랜트'], brands: ['SK뷰', 'SK VIEW'] },
  hdc: { names: ['IPARK현대산업개발', 'IPARK현산', '아이파크현대산업개발', 'HDC현대산업개발', 'HDC현산'], alsoQuery: ['HDC현대산업개발', 'HDC현산'], brands: ['아이파크'] },
  samsungea: { names: ['삼성E&A', '삼성이앤에이', '삼성엔지니어링'], brands: [] },
};

/** 회사 뉴스 세부 주제: 검색어 = 회사명 + 주제어(주제어마다 1개 검색), hit = 기사에 하나라도 있어야 하는 주제 단어 */
export const COMPANY_TOPICS = [
  { id: 'all', label: '전체', kws: [''], hit: [] },
  { id: 'order', label: '수주·사업', kws: ['수주', '계약', '해외 수주', '정비사업'], hit: ['수주', '계약', '시공사', '선정', '정비사업', '재건축', '재개발', '플랜트', '해외'] },
  { id: 'earnings', label: '실적·재무', kws: ['실적', '영업이익', '신용등급', '차입'], hit: ['실적', '매출', '영업이익', '순이익', '적자', '흑자', '신용등급', '차입', '회사채', '유동성', '재무', '부채'] },
  { id: 'housing', label: '주택·분양', kws: ['분양', '{brand}'], hit: ['분양', '청약', '입주', '단지', '아파트', '{brand}'] },
  { id: 'safety', label: '안전·사고', kws: ['사고', '중대재해', '영업정지', '부실시공'], hit: ['사고', '중대재해', '사망', '붕괴', '영업정지', '부실', '하자', '안전', '처분'] },
  { id: 'ir', label: '주가·IR', kws: ['주가', '목표주가', '배당', '자사주'], hit: ['주가', '목표주가', '증권', '투자의견', '배당', '자사주', '밸류업', 'IR', '주주'] },
];

/* ------------------------------------------------------------ 제도·정책 */
/** groups: 세부 구분(검색어 묶음) · must: 기사 제목/요약에 하나라도 있어야 함 · exclude: 있으면 제외 */
export const POLICY_TOPICS = [
  {
    id: 'commercial', label: '상법', desc: '상법 개정 · 이사의 충실의무 · 지배구조',
    must: ['상법', '충실의무', '집중투표', '분리선출', '감사위원', '독립이사', '사외이사', '자사주', '자기주식', '소액주주', '3%룰', '지배구조'],
    exclude: ['상법상 회사 아닌'],
    groups: [
      { id: 'amend', label: '상법 개정', kws: ['상법 개정', '상법 개정안 국회', '개정 상법 시행'] },
      { id: 'duty', label: '이사 충실의무', kws: ['이사 충실의무 주주', '주주 충실의무'] },
      { id: 'board', label: '집중투표·감사위원', kws: ['집중투표제 의무화', '감사위원 분리선출', '독립이사'] },
      { id: 'treasury', label: '자사주 소각', kws: ['자사주 소각 의무화', '자기주식 소각 상법'] },
    ],
  },
  {
    id: 'capital', label: '자본시장법', desc: '자본시장법 개정 · 공시 · 밸류업 · 불공정거래',
    must: ['자본시장법', '자본시장', '금융위', '금감원', '금융감독원', '공시', '밸류업', '기업가치 제고', '공개매수', '물적분할', '불공정거래', '공매도', '배당', '거래소'],
    exclude: [],
    groups: [
      { id: 'amend', label: '자본시장법 개정', kws: ['자본시장법 개정', '자본시장법 개정안', '자본시장법 시행령'] },
      { id: 'valueup', label: '밸류업·기업가치', kws: ['기업 밸류업 프로그램', '기업가치 제고 계획 공시'] },
      { id: 'disclosure', label: '공시 제도', kws: ['공시 제도 개선 금융위', '의무공개매수', '물적분할 주주 보호'] },
      { id: 'fair', label: '불공정거래·공매도', kws: ['불공정거래 제재 금융위', '공매도 제도'] },
      { id: 'dividend', label: '배당 절차', kws: ['배당 절차 개선', '배당기준일'] },
    ],
  },
  {
    id: 'agm', label: '주주총회', desc: '정기·임시 주총 · 전자주주총회 · 의결권 · 행동주의',
    must: ['주주총회', '주총', '전자주주총회', '전자투표', '의결권', '주주제안', '행동주의', '스튜어드십', '소액주주', '주주연대'],
    exclude: ['입주자대표', '조합원 총회'],
    groups: [
      { id: 'agm', label: '주주총회 일반', kws: ['정기 주주총회', '임시 주주총회', '주총 안건'] },
      { id: 'eagm', label: '전자주주총회', kws: ['전자주주총회', '온라인 주주총회', '전자투표 의무화'] },
      { id: 'vote', label: '의결권·자문사', kws: ['의결권 자문사', '국민연금 의결권', '스튜어드십 코드'] },
      { id: 'activist', label: '행동주의·주주제안', kws: ['행동주의 펀드 주주제안', '소액주주 연대'] },
    ],
  },
  {
    id: 'esg', label: 'ESG', desc: 'ESG 공시 의무화 · 지속가능성 공시 기준 · 평가 · 안전·탄소',
    must: ['ESG', '지속가능', 'KSSB', '탄소', '온실가스', '중대재해', '공급망 실사', '택소노미', '기후'],
    exclude: [],
    groups: [
      { id: 'disclosure', label: 'ESG 공시 의무화', kws: ['ESG 공시 의무화', '지속가능성 공시 기준', 'KSSB 공시'] },
      { id: 'rating', label: 'ESG 평가', kws: ['ESG 평가 등급 건설', 'ESG 경영 건설사'] },
      { id: 'carbon', label: '탄소·기후', kws: ['탄소중립 건설', '온실가스 감축 건설', '배출권 거래제'] },
      { id: 'safety', label: '안전·공급망(S)', kws: ['중대재해처벌법 개정', '공급망 실사 의무화'] },
    ],
  },
  {
    id: 'realestate', label: '부동산정책', desc: '정부 대책 · 공급 · 대출 · 세제 · 정비사업 · PF',
    must: ['정부', '국토부', '국토교통부', '기재부', '금융위', '대책', '정책', '규제', '법안', '개정', '시행', '발표', '추진', '완화', '강화', '공급', '대출', 'DSR', '세제', '토지거래', '분양가', '청약', '재건축', '재개발', '정비사업', 'PF', '공공주택', 'LH', '신도시', '전세'],
    // 분양 광고성 기사를 거르기 위해 '정책 주체·정책 용어'가 함께 있어야 한다
    need: ['정부', '국토부', '국토교통부', '기재부', '기획재정부', '금융위', '금융당국', '국회', '대통령', '당정', '여당', '야당', '법안', '시행령', '대책', '정책', '규제', '제도', '개편', '완화', '강화', '세제', '서울시', 'LH', '공공'],
    exclude: ['분양 홍보', '모델하우스 오픈', '견본주택 개관', '견본주택 오픈'],
    groups: [
      { id: 'measure', label: '정부 부동산 대책', kws: ['부동산 대책 발표', '국토교통부 부동산 정책', '부동산 정책 정부'] },
      { id: 'supply', label: '주택 공급', kws: ['주택공급 대책', '공공주택 공급', '3기 신도시', '수도권 주택 공급'] },
      { id: 'loan', label: '대출·금융 규제', kws: ['주택담보대출 규제', '스트레스 DSR', '가계대출 규제 부동산'] },
      { id: 'tax', label: '부동산 세제', kws: ['부동산 세제 개편', '양도세 종부세 개편', '취득세 중과'] },
      { id: 'zone', label: '규제지역·토허제', kws: ['토지거래허가구역', '조정대상지역', '투기과열지구'] },
      { id: 'redev', label: '재건축·재개발', kws: ['재건축 규제 완화', '재초환', '정비사업 활성화', '안전진단 폐지'] },
      { id: 'pf', label: 'PF·건설경기', kws: ['부동산 PF 대책', '건설경기 활성화 대책', 'SOC 예산'] },
      { id: 'subscription', label: '청약·분양가', kws: ['청약 제도 개편', '분양가 상한제', '공사비 분양가'] },
      { id: 'lease', label: '전세·임대차', kws: ['전세사기 대책', '임대차 제도 개편'] },
    ],
  },
];

/* ------------------------------------------------------------ 순수 함수 */
const ENT = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' };
/** 네이버 결과의 <b> 태그·HTML 엔티티 제거 (DOM 없이) */
export function strip(s) {
  return String(s ?? '').replace(/<[^>]+>/g, '').replace(/&(quot|amp|lt|gt|apos|nbsp|#39);/g, (m) => ENT[m] || m)
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/\s+/g, ' ').trim();
}
const norm = (s) => strip(s).toLowerCase().replace(/\s+/g, '');
const hasAny = (text, words) => words.some((w) => w && text.includes(norm(w)));

export function companyNames(id) { return COMPANY_NEWS[id]?.names || []; }

/** 회사·주제 → 검색어 목록 */
export function companyQueries(id, topicId = 'all') {
  const c = COMPANY_NEWS[id];
  if (!c) return [];
  const t = COMPANY_TOPICS.find((x) => x.id === topicId) || COMPANY_TOPICS[0];
  const out = [];
  for (const kw of t.kws) {
    // 브랜드는 한글 표기만 검색어로(영문 브랜드는 관련도 판정에만 사용)
    if (kw === '{brand}') { c.brands.filter((b) => /[가-힣]/.test(b)).forEach((b) => out.push(`${c.names[0]} ${b}`)); continue; }
    out.push(kw ? `${c.names[0]} ${kw}` : c.names[0]);
  }
  if (topicId === 'all') (c.alsoQuery || []).forEach((q) => out.push(q));
  else if (c.alsoQuery?.length && t.kws[0] && t.kws[0] !== '{brand}') out.push(`${c.alsoQuery[0]} ${t.kws[0]}`);
  return [...new Set(out)].slice(0, 6);
}

/** 정책 구분·세부 → 검색어 목록 (세부 'all' = 모든 세부의 검색어) */
export function policyQueries(topicId, groupId = 'all') {
  const t = POLICY_TOPICS.find((x) => x.id === topicId);
  if (!t) return [];
  const groups = groupId === 'all' ? t.groups : t.groups.filter((g) => g.id === groupId);
  return [...new Set(groups.flatMap((g) => g.kws))];
}

/**
 * 관련도 판정 — 회사: 회사 표기(제외 표기만 있으면 탈락) + 주제어 / 정책: must 하나 이상, exclude 없음
 * @returns {{ok:boolean, score:number, tags:string[]}}
 */
export function relevance(item, ctx) {
  const text = norm(`${item.title} ${item.description}`);
  const title = norm(item.title);
  if (ctx.kind === 'company') {
    const c = COMPANY_NEWS[ctx.company];
    if (!c) return { ok: false, score: 0, tags: [] };
    // 제외 표기(예: 현대건설기계)를 지운 뒤에도 회사 표기가 남아야 한다
    let t = text;
    (c.exclude || []).forEach((x) => { t = t.split(norm(x)).join(' '); });
    if (!hasAny(t, c.names)) return { ok: false, score: 0, tags: [] };
    const topic = COMPANY_TOPICS.find((x) => x.id === ctx.topic) || COMPANY_TOPICS[0];
    const hits = topic.hit.flatMap((h) => (h === '{brand}' ? c.brands : [h]));
    if (hits.length && !hasAny(t, hits)) return { ok: false, score: 0, tags: [] };
    const tags = COMPANY_TOPICS.filter((x) => x.id !== 'all' && hasAny(t, x.hit.flatMap((h) => (h === '{brand}' ? c.brands : [h])))).map((x) => x.label);
    const score = (hasAny(title, c.names) ? 3 : 1) + tags.length;
    return { ok: true, score, tags };
  }
  if (ctx.kind === 'policy') {
    const tp = POLICY_TOPICS.find((x) => x.id === ctx.topic);
    if (!tp) return { ok: false, score: 0, tags: [] };
    if (hasAny(text, tp.exclude)) return { ok: false, score: 0, tags: [] };
    if (!hasAny(text, tp.must)) return { ok: false, score: 0, tags: [] };
    if (tp.need && !hasAny(text, tp.need)) return { ok: false, score: 0, tags: [] };
    // 세부 구분 태그: 그 구분의 검색어를 이루는 단어가 2개 이상(또는 1단어 검색어 전체)이 있으면 해당
    const tags = tp.groups.filter((g) => g.kws.some((k) => { const ws = k.split(/\s+/); const n = ws.filter((w) => text.includes(norm(w))).length; return n >= Math.min(2, ws.length); })).map((g) => g.label);
    const score = tp.must.filter((m) => title.includes(norm(m))).length * 2 + tp.must.filter((m) => text.includes(norm(m))).length + tags.length;
    return { ok: true, score, tags };
  }
  return { ok: true, score: 1, tags: [] }; // 직접 검색: 필터 없음
}

/** 같은 기사(제목 정규화 동일) 묶기 — 가장 이른 보도를 대표로, 나머지 수를 dup에 */
export function dedupe(items) {
  const map = new Map();
  for (const it of items) {
    const k = norm(it.title).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 40) || it.link;
    const prev = map.get(k);
    if (!prev) { map.set(k, { ...it, dup: 0, links: new Set([it.link]) }); continue; }
    if (prev.links.has(it.link)) continue;
    prev.links.add(it.link);
    prev.dup += 1;
    if (Date.parse(it.pubDate) < Date.parse(prev.pubDate)) { const { dup, links } = prev; map.set(k, { ...it, dup, links }); }
  }
  return [...map.values()].map(({ links, ...x }) => x);
}

/** 기간 필터: now 기준 days일 이내 */
export function inPeriod(item, days, now = Date.now()) {
  const t = Date.parse(item.pubDate);
  return Number.isFinite(t) && t >= now - days * 86400e3 && t <= now + 3600e3;
}
