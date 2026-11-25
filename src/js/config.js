/* IDF Web — 기본 설정 (공개 저장소: 비밀값을 넣지 않습니다) */

export const APP = { name: 'IDF', fullName: 'IR Data Factory', version: '2.3.13' };

/**
 * 팀 Firebase 웹 설정은 team-config.js에서 관리합니다(공개 식별자).
 * API 비밀키와 비밀번호는 team-config.js에 넣지 마세요.
 */
export const DEFAULT_FIREBASE = globalThis.IDF_TEAM_CONFIG?.firebase || { apiKey: '', authDomain: '', projectId: '', appId: '' };

/**
 * API Gateway(Cloudflare Worker) 주소. 기본 API 키는 Worker Secret에 저장됩니다.
 * 배포 후 설정 화면에서 바꾸거나, 아래 값을 배포 주소로 바꿔 커밋하세요.
 */
export const DEFAULT_GATEWAY = globalThis.IDF_TEAM_CONFIG?.gateway || '';

/** 10대 건설사 — DART 고유번호(corpCode)·종목코드 (IDF V28 레지스트리 기준) */
export const COMPANIES = [
  { id: 'gs', name: 'GS건설', ticker: '006360', corp: '00120030' },
  { id: 'samsungcnt', name: '삼성물산', ticker: '028260', corp: '00149655' },
  { id: 'hyundai', name: '현대건설', ticker: '000720', corp: '00164478' },
  { id: 'daewoo', name: '대우건설', ticker: '047040', corp: '00124540' },
  { id: 'dl', name: 'DL이앤씨', ticker: '375500', corp: '01524093' },
  { id: 'posco', name: '포스코이앤씨', ticker: null, corp: '00100814' },
  { id: 'lotte', name: '롯데건설', ticker: null, corp: '00120438' },
  { id: 'skeco', name: 'SK에코플랜트', ticker: null, corp: '00131799' },
  { id: 'hdc', name: 'IPARK현대산업개발', ticker: '294870', corp: '01310269' },
  { id: 'samsungea', name: '삼성E&A', ticker: '028050', corp: '00126308' },
];
export const companyById = (id) => COMPANIES.find((c) => c.id === id) || COMPANIES[0];

/** 한국은행 ECOS 지표 (통계표/항목 코드는 IDF V28 금융지표 정의와 동일) */
export const ECOS = {
  base: { name: '기준금리', stat: '722Y001', item: '0101000', unit: '%' },
  call: { name: '콜금리(1일)', stat: '817Y002', item: '010102000', unit: '%' },
  cd91: { name: 'CD 91일', stat: '817Y002', item: '010502000', unit: '%' },
  ktb3: { name: '국고채 3년', stat: '817Y002', item: '010200000', unit: '%' },
  ktb10: { name: '국고채 10년', stat: '817Y002', item: '010210000', unit: '%' },
  aa3: { name: '회사채 AA- 3년', stat: '817Y002', item: '010300000', unit: '%' },
  bbb3: { name: '회사채 BBB- 3년', stat: '817Y002', item: '010320000', unit: '%' },
  usd: { name: '원/달러', stat: '731Y003', item: '0000003', unit: '원' },
  jpy: { name: '원/100엔', stat: '731Y003', item: '0000006', unit: '원' },
  cny: { name: '원/위안', stat: '731Y003', item: '0000010', unit: '원' },
  kospi: { name: 'KOSPI', stat: '802Y001', item: '0001000', unit: 'pt' },
  kosdaq: { name: 'KOSDAQ', stat: '802Y001', item: '0089000', unit: 'pt' },
};

export const NEWS_PRESETS = ['GS건설', 'GS건설 수주', '자이', '건설업 PF', '건설 수주 해외'];
