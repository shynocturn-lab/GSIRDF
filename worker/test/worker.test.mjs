// IDF Gateway Worker 안전성 테스트 — 실행: node --test worker/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SRC = new URL('../src/index.js', import.meta.url).href;
let seq = 0;
const fresh = async () => (await import(`${SRC}?t=${++seq}`)).default; // 모듈 전역(JWKS·메모리캐시) 초기화

/* ---------- 서명 키 / 토큰 ---------- */
const { subtle } = globalThis.crypto;
const kp = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const other = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const JWK = { ...(await subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const PID = 'team-test-project';
const now = () => Math.floor(Date.now() / 1000);
const claims = (p = {}) => ({ aud: PID, iss: `https://securetoken.google.com/${PID}`, sub: 'uid1', iat: now(), exp: now() + 3600, email: 'owner@test.dev', email_verified: true, ...p });
async function sign(payload, { key = kp.privateKey, kid = 'k1', alg = 'RS256' } = {}) {
  const h = b64({ alg, kid }); const b = b64(payload);
  const s = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${b}`));
  return `${h}.${b}.${Buffer.from(s).toString('base64url')}`;
}
const GOOD = await sign(claims());

/* ---------- 가짜 외부망: fetch / Cache API 계수 ---------- */
const SECRETS = { KRX_KEY: 'SECRET-KRX-1234567890', DART_KEY: 'SECRET-DART-1234567890', ECOS_KEY: 'SECRET-ECOS-12345', NAVER_ID: 'SECRET-NID-123', NAVER_SECRET: 'SECRET-NSEC-123' };
function world(opts = {}) {
  const w = { fetches: [], cacheCalls: 0, jwks: [JWK], store: new Map() };
  globalThis.fetch = async (url, init = {}) => {
    url = String(url); w.fetches.push({ url, headers: init.headers || {}, redirect: init.redirect });
    if (url.includes('cdn-cgi/trace')) return new Response('fl=1\nip=203.0.113.9\nloc=US\ncolo=SJC\n');
    if (opts.dartRedirect && url.includes('opendart')) return new Response(null, { status: 302, headers: { location: 'https://opendart.fss.or.kr/error1.html' } });
    if (opts.throwWithUrl && url.includes(opts.throwWithUrl)) throw new TypeError('Too many redirects. ' + url);
    if (opts.fetchThrows) throw new TypeError('network down');
    if (url.includes('securetoken@system')) {
      if (opts.jwksFail) return new Response('x', { status: 500 });
      const keys = typeof w.jwks === 'function' ? w.jwks() : w.jwks;
      return new Response(JSON.stringify({ keys }), { headers: { 'cache-control': 'max-age=60' } });
    }
    if (opts.upstream) { const r = opts.upstream(url, init); if (r) return r; }
    if (url.includes('data-dbg.krx.co.kr')) {
      const d = url.match(/basDd=(\d+)/)[1];
      if (opts.krxAuthError) return new Response(JSON.stringify({ respCode: '401', respMsg: 'Unauthorized Key' }));
      // 실제 승인 상황 재현: 승인 안 된 서비스는 HTTP 401 {"respMsg":"Unauthorized API Call"}
      const svc = url.split('/apis/')[1].split('?')[0];
      if ((opts.krxDenied || []).includes(svc)) return new Response(JSON.stringify({ respMsg: 'Unauthorized API Call', respCode: '401' }), { status: 401 });
      if (url.includes('_dd_trd')) {
        if ((opts.krxEmpty || []).includes(d)) return new Response(JSON.stringify({ OutBlock_1: [] }));
        const rows = url.includes('kosdaq') ? [{ BAS_DD: d, IDX_NM: '코스닥', CLSPRC_IDX: '705.10', FLUC_RT: '0.4' }]
          : [{ BAS_DD: d, IDX_CLSS: 'KOSPI', IDX_NM: '코스피', CLSPRC_IDX: '2,650.10', FLUC_RT: '0.4' }, { BAS_DD: d, IDX_CLSS: 'KOSPI', IDX_NM: opts.conName || '건설', CLSPRC_IDX: '85.20', CMPPREVDD_IDX: '1.1', FLUC_RT: '1.31' }];
        return new Response(JSON.stringify({ OutBlock_1: rows }));
      }
      if ((opts.krxEmpty || []).includes(d) || opts.krxAllEmpty) return new Response(JSON.stringify({ OutBlock_1: [] }));
      return new Response(JSON.stringify({ OutBlock_1: [
        { BAS_DD: d, ISU_CD: '006360', ISU_NM: 'GS건설', TDD_CLSPRC: '19,650', CMPPREVDD_PRC: '-100', FLUC_RT: '-0.51', MKTCAP: '1681674778500', ACC_TRDVOL: '-' },
        { BAS_DD: d, ISU_CD: '005930', ISU_NM: '삼성전자', TDD_CLSPRC: '1' },
      ] }));
    }
    if (url.includes('opendart')) return new Response(JSON.stringify(opts.dart || { status: '000', list: [{ ok: 1 }] }));
    if (url.includes('ecos.bok')) return new Response(JSON.stringify(opts.ecos || { StatisticSearch: { list_total_count: 1, row: [{ TIME: '20261110', DATA_VALUE: '2.50', UNIT_NAME: '%', ITEM_NAME1: '기준금리' }] } }));
    if (url.includes('m.stock.naver.com')) {
      if (opts.naverStock) return opts.naverStock(url, init);
      return new Response(JSON.stringify({ totalInfos: [{ code: 'lastClosePrice', key: '전일', value: '19,650' }, { code: 'foreignRate', key: '외인소진율', value: '13.42%' }, { code: 'per', key: 'PER', value: '8.21배' }, { code: 'eps', key: 'EPS', value: '2,393원' }, { code: 'pbr', key: 'PBR', value: '0.32배' }, { code: 'bps', key: 'BPS', value: '61,234원' }, { code: 'dividendYieldRatio', key: '배당수익률', value: '2.54%' }] }));
    }
    if (url.includes('openapi.naver')) return new Response(JSON.stringify({ total: 1, items: [{ title: '<b>GS</b>건설', originallink: 'https://news.example/a', link: 'https://n.news/a', description: 'd', pubDate: 'Tue, 10 Nov 2026 09:00:00 +0900' }] }));
    return new Response('not found', { status: 404 });
  };
  if (opts.noCaches) { delete globalThis.caches; } else {
    globalThis.caches = { default: {
      match: async (r) => { w.cacheCalls++; if (opts.cacheThrows) throw new Error('cache down'); return w.store.has(r.url) ? new Response(w.store.get(r.url)) : undefined; },
      put: async (r, res) => { w.cacheCalls++; if (opts.cacheThrows) throw new Error('cache down'); w.store.set(r.url, await res.text()); },
    } };
  }
  return w;
}
const ENV = { ALLOWED_EMAILS: 'owner@test.dev', FIREBASE_PROJECT_ID: PID, ...SECRETS };
async function call(worker, path, { token, headers = {}, method = 'GET', env = ENV } = {}) {
  const h = { Origin: 'https://example.github.io', ...headers };
  if (token) h.Authorization = 'Bearer ' + token;
  const res = await worker.fetch(new Request('https://gw.test' + path, { method, headers: h }), env, { waitUntil: (p) => p });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: res.status, body, text, cors: res.headers.get('access-control-allow-origin'), res };
}
const noSecret = (text) => Object.values(SECRETS).every((v) => !text.includes(v));
const sub = (w) => w.fetches.length + w.cacheCalls;

/* ================================================================ 기본/CORS */
test('01 OPTIONS 프리플라이트 → 204 + CORS * + 허용 헤더', async () => {
  world(); const r = await call(await fresh(), '/api/health', { method: 'OPTIONS' });
  assert.equal(r.status, 204); assert.equal(r.cors, '*');
  assert.match(r.res.headers.get('access-control-allow-headers'), /Authorization.*X-IDF-NAVER-SECRET/);
});
test('02 POST → 405 JSON + CORS', async () => { world(); const r = await call(await fresh(), '/api/health', { method: 'POST' }); assert.equal(r.status, 405); assert.equal(r.cors, '*'); assert.equal(r.body.error, 'METHOD_NOT_ALLOWED'); });
test('03 루트 진단: service·version·config, 비밀값 미노출', async () => {
  world(); const r = await call(await fresh(), '/');
  assert.equal(r.status, 200); assert.equal(r.body.service, 'idf-gateway'); assert.ok(r.body.version);
  assert.equal(r.body.config.allowedEmails, 1); assert.equal(r.body.config.defaultKeys.krx, true); assert.ok(noSecret(r.text));
  assert.ok(!r.text.includes('owner@test.dev'), '이메일 미노출');
});
test('04 /api/ping 은 인증 없이 응답', async () => { world(); const r = await call(await fresh(), '/api/ping'); assert.equal(r.status, 200); assert.equal(r.body.service, 'idf-gateway'); });
test('05 다른 Origin 에서도 CORS 허용(Bearer 방식)', async () => { world(); const r = await call(await fresh(), '/', { headers: { Origin: 'https://other.example' } }); assert.equal(r.cors, '*'); });
test('06 알 수 없는 경로 → 404 JSON', async () => { world(); const r = await call(await fresh(), '/api/zzz', { token: GOOD }); assert.equal(r.status, 404); assert.equal(r.cors, '*'); });

/* ===================================================================== 인증 */
test('07 토큰 없음 → 401 AUTH_REQUIRED', async () => { world(); const r = await call(await fresh(), '/api/health'); assert.equal(r.status, 401); assert.equal(r.body.error, 'AUTH_REQUIRED'); });
test('08 Bearer 공백 → 401', async () => { world(); const r = await call(await fresh(), '/api/health', { headers: { Authorization: 'Bearer   ' } }); assert.equal(r.status, 401); });
test('09 형식 깨진 토큰 → 401 TOKEN_INVALID', async () => { world(); const r = await call(await fresh(), '/api/health', { token: 'abc' }); assert.equal(r.body.error, 'TOKEN_INVALID'); });
test('10 base64 쓰레기 3조각 → 401 TOKEN_INVALID', async () => { world(); const r = await call(await fresh(), '/api/health', { token: '###.$$$.%%%' }); assert.equal(r.status, 401); });
test('11 alg:none 토큰 → 401', async () => { world(); const t = `${b64({ alg: 'none', kid: 'k1' })}.${b64(claims())}.`; const r = await call(await fresh(), '/api/health', { token: t }); assert.equal(r.status, 401); });
test('12 다른 프로젝트(aud) → 401 TOKEN_AUDIENCE', async () => { world(); const r = await call(await fresh(), '/api/health', { token: await sign(claims({ aud: 'evil', iss: 'https://securetoken.google.com/evil' })) }); assert.equal(r.body.error, 'TOKEN_AUDIENCE'); });
test('13 만료 토큰 → 401 TOKEN_EXPIRED', async () => { world(); const r = await call(await fresh(), '/api/health', { token: await sign(claims({ exp: now() - 120 })) }); assert.equal(r.body.error, 'TOKEN_EXPIRED'); });
test('14 미래 발급(iat) 토큰 → 401', async () => { world(); const r = await call(await fresh(), '/api/health', { token: await sign(claims({ iat: now() + 3600 })) }); assert.equal(r.status, 401); });
test('15 서명 변조 → 401 TOKEN_SIGNATURE', async () => { world(); const t = GOOD.slice(0, -4) + (GOOD.endsWith('AAAA') ? 'BBBB' : 'AAAA'); const r = await call(await fresh(), '/api/health', { token: t }); assert.equal(r.body.error, 'TOKEN_SIGNATURE'); });
test('16 이메일 위조(서명 재사용) → 401', async () => { world(); const [h, , s] = GOOD.split('.'); const r = await call(await fresh(), '/api/health', { token: `${h}.${b64(claims({ email: 'attacker@x.com' }))}.${s}` }); assert.equal(r.status, 401); });
test('17 다른 키로 서명(같은 kid) → 401', async () => { world(); const r = await call(await fresh(), '/api/health', { token: await sign(claims(), { key: other.privateKey }) }); assert.equal(r.body.error, 'TOKEN_SIGNATURE'); });
test('18 모르는 kid → JWKS 재조회 후 401 TOKEN_KID', async () => { const w = world(); const r = await call(await fresh(), '/api/health', { token: await sign(claims(), { kid: 'zz' }) }); assert.equal(r.body.error, 'TOKEN_KID'); assert.equal(w.fetches.filter((f) => f.url.includes('securetoken')).length, 2); });
test('19 Google 키 교체 직후(kid 새로 추가) → 재조회로 200', async () => {
  const w = world(); let n = 0; w.jwks = () => (n++ === 0 ? [] : [JWK]);
  const r = await call(await fresh(), '/api/health', { token: GOOD }); assert.equal(r.status, 200);
});
test('20 sub 없는 토큰 → 401', async () => { world(); const c = claims(); delete c.sub; const r = await call(await fresh(), '/api/health', { token: await sign(c) }); assert.equal(r.status, 401); });
test('21 email_verified=false → 403', async () => { world(); const r = await call(await fresh(), '/api/health', { token: await sign(claims({ email_verified: false })) }); assert.equal(r.status, 403); });
test('22 허용 목록에 없는 계정 → 403 NOT_APPROVED', async () => { world(); const r = await call(await fresh(), '/api/health', { token: await sign(claims({ email: 'stranger@test.dev' })) }); assert.equal(r.body.error, 'NOT_APPROVED'); });
test('23 이메일 대소문자 무시 + 목록 공백 허용', async () => { world(); const r = await call(await fresh(), '/api/health', { token: await sign(claims({ email: 'Owner@Test.dev' })), env: { ...ENV, ALLOWED_EMAILS: ' a@b.c , OWNER@test.dev ' } }); assert.equal(r.status, 200); });
test('24 ALLOWED_EMAILS 미설정 + 내장값 없음 → 403(모두 차단, fail-closed)', async () => { world(); const r = await call(await fresh(), '/api/health', { token: GOOD, env: { ...ENV, ALLOWED_EMAILS: '' } }); assert.equal(r.status, 403); });
test('25 FIREBASE_PROJECT_ID 미설정 → 내장 기본 프로젝트로 동작', async () => { world(); const e = { ...ENV }; delete e.FIREBASE_PROJECT_ID; const r = await call(await fresh(), '/api/health', { token: GOOD, env: e }); assert.equal(r.status, 200); });
test('26 JWKS 조회 실패 → 503 JSON + CORS', async () => { world({ jwksFail: true }); const r = await call(await fresh(), '/api/health', { token: GOOD }); assert.equal(r.status, 503); assert.equal(r.cors, '*'); assert.equal(r.body.error, 'JWKS_UNAVAILABLE'); });
test('27 네트워크 완전 장애 → 503 JSON(CORS 유지)', async () => { world({ fetchThrows: true }); const r = await call(await fresh(), '/api/health', { token: GOOD }); assert.ok(r.status >= 500); assert.equal(r.cors, '*'); assert.ok(r.body.error); });
test('28 정상 토큰 → 200, 사용자·버전·키 상태', async () => { world(); const r = await call(await fresh(), '/api/health', { token: GOOD }); assert.equal(r.status, 200); assert.equal(r.body.user, 'owner@test.dev'); assert.deepEqual(r.body.keys, { krx: true, dart: true, ecos: true, naver: true }); assert.ok(noSecret(r.text)); });
test('29 키 없는 Worker + 앱 헤더 키 → 키 있음으로 인식', async () => {
  world(); const e = { ALLOWED_EMAILS: 'owner@test.dev' };
  const r = await call(await fresh(), '/api/health', { token: GOOD, env: e, headers: { 'X-IDF-DART': 'DEVICEKEY' } });
  assert.equal(r.body.keys.dart, true); assert.equal(r.body.keys.krx, false);
});

/* ====================================================================== KRX */
test('30 스냅샷: 요청 종목만 필터, 지수 포함, 결측 null 보존', async () => {
  world(); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD });
  assert.equal(r.status, 200); assert.equal(r.body.stocks.length, 1); assert.equal(r.body.stocks[0].close, 19650);
  assert.equal(r.body.stocks[0].volume, null); assert.equal(r.body.index.kospi.close, 2650.1); assert.equal(r.body.index.kosdaq, null); assert.equal(r.body.index.construction.close, 85.2);
});
test('31 스냅샷: 주말·휴장 건너뛰고 직전 거래일', async () => { world({ krxEmpty: ['20261110', '20261109'] }); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD }); assert.equal(r.body.basDd, '20261106'); });
test('32 스냅샷: KRX 인증 오류는 즉시 중단(8일 반복 안 함)', async () => {
  const w = world({ krxAuthError: true }); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD });
  assert.equal(r.body.error, 'KRX_AUTH'); assert.equal(w.fetches.filter((f) => f.url.includes('krx')).length, 1);
});
test('33 스냅샷: 자료 없음 → 404 KRX_NO_DATA', async () => { world({ krxAllEmpty: true }); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD }); assert.equal(r.body.error, 'KRX_NO_DATA'); });
test('34 스냅샷: 키 없음 → 503 KEY_MISSING', async () => { world(); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360', { token: GOOD, env: { ALLOWED_EMAILS: 'owner@test.dev' } }); assert.equal(r.body.error, 'KEY_MISSING'); });
test('35 스냅샷 최악(콜드 캐시, 8일 탐색) subrequest ≤ 45', async () => { const w = world({ krxAllEmpty: true }); await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD }); assert.ok(sub(w) <= 45, 'subrequests=' + sub(w)); });
test('36 시계열 6일(콜드) subrequest ≤ 45, 무료 한도 50 미만', async () => {
  const w = world(); const r = await call(await fresh(), '/api/krx/series?codes=006360,028260&index=1&dates=20261102,20261103,20261104,20261105,20261106,20261109', { token: GOOD });
  assert.equal(r.body.points.length, 6); assert.ok(sub(w) <= 45, 'subrequests=' + sub(w));
});
test('37 시계열: 6개 초과 날짜는 최근 6개로 제한', async () => { world(); const ds = ['20261026', '20261027', '20261028', '20261029', '20261030', '20261102', '20261103', '20261104'].join(','); const r = await call(await fresh(), `/api/krx/series?codes=006360&dates=${ds}`, { token: GOOD }); assert.equal(r.body.points.length, 6); assert.equal(r.body.points[0].date, '20261028'); });
test('38 종목코드 이상값 → 400', async () => { world(); const r = await call(await fresh(), '/api/krx/snapshot?codes=<script>', { token: GOOD }); assert.equal(r.status, 400); });
test('39 KRX 인증키는 AUTH_KEY 헤더로만 전송(URL 미포함)', async () => { const w = world(); await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD }); const f = w.fetches.find((x) => x.url.includes('krx')); assert.equal(f.headers.AUTH_KEY, SECRETS.KRX_KEY); assert.ok(!f.url.includes(SECRETS.KRX_KEY)); });
test('40 메모리 캐시: 같은 요청 반복 시 외부 호출 없음', async () => {
  const w = world(); const wk = await fresh();
  await call(wk, '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD }); const before = w.fetches.length;
  await call(wk, '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD }); assert.equal(w.fetches.length, before);
});

/* ===================================================================== DART */
test('41 DART: 키 서버 추가, 앱이 보낸 crtfc_key 무시', async () => { const w = world(); await call(await fresh(), '/api/dart/list.json?corp_code=00120030&crtfc_key=EVIL', { token: GOOD }); const f = w.fetches.find((x) => x.url.includes('opendart')); assert.ok(f.url.includes(SECRETS.DART_KEY)); assert.ok(!f.url.includes('EVIL')); });
test('42 DART 013(데이터 없음) → 200 그대로', async () => { world({ dart: { status: '013', message: '조회된 데이타가 없습니다.' } }); const r = await call(await fresh(), '/api/dart/list.json?corp_code=1', { token: GOOD }); assert.equal(r.status, 200); assert.equal(r.body.status, '013'); });
test('43 DART 010(키 오류) → 401 DART_010', async () => { world({ dart: { status: '010', message: '등록되지 않은 키' } }); const r = await call(await fresh(), '/api/dart/list.json?corp_code=1', { token: GOOD }); assert.equal(r.body.error, 'DART_010'); });
test('44 DART 경로 조작(../, 확장자) → 차단', async () => { world(); for (const p of ['/api/dart/../x', '/api/dart/list.xml', '/api/dart/a%2Fb.json']) { const r = await call(await fresh(), p, { token: GOOD }); assert.ok(r.status === 400 || r.status === 404, p + ' → ' + r.status); } });
test('45 DART 응답에 인증키 미노출', async () => { world(); const r = await call(await fresh(), '/api/dart/company.json?corp_code=1', { token: GOOD }); assert.ok(noSecret(r.text)); });
test('46 쿼리 과다 길이 → 400', async () => { world(); const r = await call(await fresh(), '/api/dart/list.json?x=' + 'a'.repeat(2000), { token: GOOD }); assert.equal(r.status, 400); });

/* ===================================================================== ECOS */
test('47 ECOS 정상 → 숫자 변환', async () => { world(); const r = await call(await fresh(), '/api/ecos/StatisticSearch/722Y001/D/20261101/20261111/0101000', { token: GOOD }); assert.equal(r.body.rows[0].value, 2.5); });
test('48 ECOS INFO-200(자료 없음) → 빈 배열', async () => { world({ ecos: { RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } } }); const r = await call(await fresh(), '/api/ecos/StatisticSearch/722Y001/D/20261101/20261111/0101000', { token: GOOD }); assert.equal(r.status, 200); assert.deepEqual(r.body.rows, []); });
test('49 ECOS INFO-100(키 오류) → 401', async () => { world({ ecos: { RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } } }); const r = await call(await fresh(), '/api/ecos/StatisticSearch/722Y001/D/20261101/20261111/0101000', { token: GOOD }); assert.equal(r.status, 401); });
test('50 ECOS 경로 주입 차단', async () => { world(); const r = await call(await fresh(), '/api/ecos/StatisticSearch/722Y001/D/2026/x%2F..%2Fy/0101000', { token: GOOD }); assert.equal(r.status, 400); });

/* ==================================================================== Naver */
test('51 네이버: 앱 헤더 키가 기본 키보다 우선', async () => { const w = world(); await call(await fresh(), '/api/naver/news?query=GS건설', { token: GOOD, headers: { 'X-IDF-NAVER-ID': 'DEVICE-ID' } }); const f = w.fetches.find((x) => x.url.includes('naver')); assert.equal(f.headers['X-Naver-Client-Id'], 'DEVICE-ID'); assert.equal(f.headers['X-Naver-Client-Secret'], SECRETS.NAVER_SECRET); });
test('52 네이버 검색어 없음/과다 → 400', async () => { world(); assert.equal((await call(await fresh(), '/api/naver/news?query=', { token: GOOD })).status, 400); assert.equal((await call(await fresh(), '/api/naver/news?query=' + 'a'.repeat(200), { token: GOOD })).status, 400); });

/* ============================================================== 장애 내성 */
test('53 외부 API 500 → 502 JSON(CORS)', async () => { world({ upstream: (u) => (u.includes('opendart') ? new Response('err', { status: 500 }) : null) }); const r = await call(await fresh(), '/api/dart/list.json?corp_code=1', { token: GOOD }); assert.equal(r.status, 502); assert.equal(r.cors, '*'); });
test('54 외부 API가 HTML 반환 → 502 UPSTREAM_NOT_JSON', async () => { world({ upstream: (u) => (u.includes('ecos') ? new Response('<html>maint</html>') : null) }); const r = await call(await fresh(), '/api/ecos/StatisticSearch/722Y001/D/20261101/20261111/0101000', { token: GOOD }); assert.equal(r.body.error, 'UPSTREAM_NOT_JSON'); });
test('55 외부 API 타임아웃 → 504', async () => { world({ upstream: (u) => { if (u.includes('naver')) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } return null; } }); const r = await call(await fresh(), '/api/naver/news?query=a', { token: GOOD }); assert.equal(r.status, 504); });
test('56 Cache API 없음 → 정상 동작', async () => { world({ noCaches: true }); const r = await call(await fresh(), '/api/dart/list.json?corp_code=1', { token: GOOD }); assert.equal(r.status, 200); });
test('57 Cache API 예외 → 무시하고 정상 동작', async () => { world({ cacheThrows: true }); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD }); assert.equal(r.status, 200); });
test('58 env 자체가 없어도 루트는 응답(크래시 없음)', async () => { world(); const wk = await fresh(); const res = await wk.fetch(new Request('https://gw.test/'), undefined, undefined); assert.equal(res.status, 200); });
test('59 어떤 응답에도 인증키 문자열이 없음', async () => {
  world(); const wk = await fresh(); const paths = ['/', '/api/health', '/api/krx/snapshot?codes=006360&date=20261110', '/api/dart/list.json?corp_code=1', '/api/ecos/StatisticSearch/722Y001/D/20261101/20261111/0101000', '/api/naver/news?query=a', '/api/zzz'];
  for (const p of paths) { const r = await call(wk, p, { token: GOOD }); assert.ok(noSecret(r.text), p); }
});
test('60 모든 오류 응답은 JSON + CORS', async () => {
  world(); const wk = await fresh();
  for (const [p, o] of [['/api/health', {}], ['/api/health', { token: 'x' }], ['/api/krx/snapshot?codes=', { token: GOOD }], ['/api/zzz', { token: GOOD }]]) {
    const r = await call(wk, p, o); assert.ok(r.body && r.body.error, p); assert.equal(r.cors, '*');
  }
});

/* ============================================= v1.5: 차단 감지·키 노출 방지·진단 */
test('61 DART가 오류 페이지로 리다이렉트 → 502 UPSTREAM_BLOCKED (1회만 호출)', async () => {
  const w = world({ dartRedirect: true }); const r = await call(await fresh(), '/api/dart/fnlttSinglAcnt.json?corp_code=00120030&bsns_year=2026&reprt_code=11014', { token: GOOD });
  assert.equal(r.status, 502); assert.equal(r.body.error, 'UPSTREAM_BLOCKED'); assert.match(r.body.message, /error1\.html/);
  assert.equal(w.fetches.filter((f) => f.url.includes('opendart')).length, 1); assert.ok(noSecret(r.text));
});
test('62 외부 요청이 URL 포함 예외를 던져도 응답에 키 없음', async () => { world({ throwWithUrl: 'opendart' }); const r = await call(await fresh(), '/api/dart/list.json?corp_code=1', { token: GOOD }); assert.ok(r.status >= 500); assert.ok(noSecret(r.text), r.text); assert.ok(!/crtfc_key=[^*]/.test(r.text)); });
test('63 ECOS(키가 경로에 포함) 예외에도 키 없음', async () => { world({ throwWithUrl: 'ecos' }); const r = await call(await fresh(), '/api/ecos/StatisticSearch/722Y001/D/20261101/20261111/0101000', { token: GOOD }); assert.ok(noSecret(r.text), r.text); });
test('64 앱이 보낸 기기 키도 오류 응답에서 가림', async () => { world({ throwWithUrl: 'opendart' }); const r = await call(await fresh(), '/api/dart/list.json?corp_code=1', { token: GOOD, headers: { 'X-IDF-DART': 'DEVICE-KEY-ABCDEFG' } }); assert.ok(!r.text.includes('DEVICE-KEY-ABCDEFG'), r.text); });
test('65 외부 요청에 브라우저 User-Agent + redirect:manual', async () => { const w = world(); await call(await fresh(), '/api/dart/list.json?corp_code=1', { token: GOOD }); const f = w.fetches.find((x) => x.url.includes('opendart')); assert.match(f.headers['User-Agent'], /Mozilla/); assert.equal(f.redirect, 'manual'); });
test('66 KRX 리다이렉트 차단 → 즉시 중단(날짜 반복 없음)', async () => {
  const w = world({ upstream: (u) => (u.includes('krx') ? new Response(null, { status: 302, headers: { location: '/error.html' } }) : null) });
  const r = await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD });
  assert.equal(r.body.error, 'UPSTREAM_BLOCKED'); assert.equal(w.fetches.filter((f) => f.url.includes('krx')).length, 1);
});
test('67 /api/diag 는 로그인 필요', async () => { world(); const r = await call(await fresh(), '/api/diag'); assert.equal(r.status, 401); });
test('68 /api/diag: 출구 위치 + 4개 API 결과, 비밀값 없음', async () => {
  world(); const r = await call(await fresh(), '/api/diag', { token: GOOD });
  assert.equal(r.status, 200); assert.equal(r.body.egress.loc, 'US'); assert.equal(r.body.checks.length, 6);
  assert.ok(r.body.checks.every((c) => c.ok), JSON.stringify(r.body.checks)); assert.ok(noSecret(r.text));
});
test('69 /api/diag: DART 차단을 정확히 표시', async () => {
  world({ dartRedirect: true }); const r = await call(await fresh(), '/api/diag', { token: GOOD });
  const d = r.body.checks.filter((c) => c.name.startsWith('OpenDART')); assert.ok(d.length === 1 && d.every((c) => !c.ok && /차단/.test(c.note)));
  assert.ok(r.body.checks.find((c) => c.name === '한국은행 ECOS').ok);
});
test('70 루트 버전 1.8.0', async () => { world(); const r = await call(await fresh(), '/'); assert.equal(r.body.version, '1.8.0'); });

/* ---------- v1.6: Open KRX 서비스별 승인 · 건설지수 · 투자지표 · 진단 ---------- */
const DENY = ['sto/ksq_bydd_trd', 'idx/kosdaq_dd_trd'];   // 사용자 키: 유가증권·KOSPI지수·종목기본정보만 승인
test('71 [실제 상황] 코스닥 서비스 미승인이어도 IR NOW 스냅샷 정상', async () => {
  const w = world({ krxDenied: DENY }); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360,028260&date=20261110', { token: GOOD });
  assert.equal(r.status, 200, r.text); assert.equal(r.body.stocks[0].close, 19650); assert.equal(r.body.index.kospi.close, 2650.1);
  assert.ok(!w.fetches.some((f) => f.url.includes('kosdaq')), '미승인 코스닥 서비스는 호출하지 않음');
});
test('72 스냅샷: KOSPI 지수 서비스가 미승인이어도 종목 시세는 반환', async () => {
  world({ krxDenied: ['idx/kospi_dd_trd'] }); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD });
  assert.equal(r.status, 200); assert.equal(r.body.stocks.length, 1); assert.equal(r.body.index.kospi, null); assert.equal(r.body.index.construction, null);
});
test('73 유가증권 매매정보 미승인 → KRX_AUTH, 서비스명·조치 안내, 원문 JSON 노출 없음', async () => {
  const w = world({ krxDenied: ['sto/stk_bydd_trd'] }); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD });
  assert.equal(r.body.error, 'KRX_AUTH'); assert.match(r.body.message, /stk_bydd_trd/); assert.match(r.body.message, /이용신청/);
  assert.ok(!/respMsg/.test(r.body.message)); assert.equal(w.fetches.filter((f) => f.url.includes('krx')).length, 1, '반복 시도 안 함');
});
test('74 건설지수: 이름 개편(건설업) 대응', async () => {
  world({ conName: '건설업' }); const r = await call(await fresh(), '/api/krx/snapshot?codes=006360&date=20261110', { token: GOOD });
  assert.equal(r.body.index.construction.name, '건설업'); assert.equal(r.body.index.construction.rate, 1.31);
});
test('75 시계열: KOSPI·건설지수를 같은 호출에서 함께 반환(추가 subrequest 없음)', async () => {
  const w = world({ krxDenied: DENY });
  const r = await call(await fresh(), '/api/krx/series?codes=006360&index=1&dates=20261102,20261103,20261104,20261105,20261106,20261109', { token: GOOD });
  assert.equal(r.body.points.length, 6); assert.ok(r.body.points.every((p) => p.kospi === 2650.1 && p.con === 85.2));
  assert.equal(w.fetches.filter((f) => f.url.includes('kospi_dd_trd')).length, 6); assert.ok(sub(w) <= 45);
});
test('76 시계열: 지수 실패해도 종목 값 유지', async () => {
  world({ krxDenied: ['idx/kospi_dd_trd'] }); const r = await call(await fresh(), '/api/krx/series?codes=006360&index=1&dates=20261106', { token: GOOD });
  assert.equal(r.body.points[0].stocks['006360'].close, 19650); assert.equal(r.body.points[0].con, null);
});
test('77 투자지표: 외국인·PER·PBR·EPS·BPS 파싱', async () => {
  const w = world(); const r = await call(await fresh(), '/api/stock/info?code=006360', { token: GOOD });
  assert.equal(r.status, 200); assert.deepEqual([r.body.foreignRate, r.body.per, r.body.pbr, r.body.eps, r.body.bps, r.body.dividendYield], [13.42, 8.21, 0.32, 2393, 61234, 2.54]);
  assert.ok(w.fetches.find((f) => f.url.includes('m.stock.naver.com/api/stock/006360/integration')));
});
test('78 투자지표: 코드 대신 이름(key)만 있어도 파싱, 음수 PER', async () => {
  world({ naverStock: () => new Response(JSON.stringify({ totalInfos: [{ key: '외인소진율', value: '9.1%' }, { key: 'PER', value: '-3.20배' }, { key: 'PBR', value: 'N/A' }] })) });
  const r = await call(await fresh(), '/api/stock/info?code=006360', { token: GOOD });
  assert.equal(r.body.foreignRate, 9.1); assert.equal(r.body.per, -3.2); assert.equal(r.body.pbr, null);
});
test('79 투자지표: 형식 변경·장애 → 오류 코드(앱은 DART 로직값으로 대체)', async () => {
  world({ naverStock: () => new Response(JSON.stringify({ something: 1 })) });
  assert.equal((await call(await fresh(), '/api/stock/info?code=006360', { token: GOOD })).body.error, 'STOCKINFO_EMPTY');
  world({ naverStock: () => new Response('err', { status: 500 }) });
  assert.equal((await call(await fresh(), '/api/stock/info?code=006360', { token: GOOD })).body.error, 'UPSTREAM_500');
});
test('80 투자지표: 잘못된 코드·무토큰 차단', async () => {
  world(); assert.equal((await call(await fresh(), '/api/stock/info?code=../x', { token: GOOD })).body.error, 'BAD_CODES');
  assert.equal((await call(await fresh(), '/api/stock/info?code=006360')).status, 401);
});
test('81 진단: DART는 앱의 실제 요청 방식 1건으로 판정 — 인증키 유효 표시', async () => {
  world({ dart: { status: '000', corp_name: 'GS건설' } }); const r = await call(await fresh(), '/api/diag', { token: GOOD });
  const d = r.body.checks.filter((c) => c.name.startsWith('OpenDART')); assert.equal(d.length, 1); assert.ok(d[0].ok); assert.match(d[0].note, /인증키 유효/);
});
test('82 진단: DART 키 오류(010)는 차단과 구분해 표시, 키 노출 없음', async () => {
  world({ dart: { status: '010', message: '등록되지 않은 키입니다.' } }); const r = await call(await fresh(), '/api/diag', { token: GOOD });
  const d = r.body.checks.find((c) => c.name.startsWith('OpenDART')); assert.ok(!d.ok); assert.match(d.note, /인증키 오류/); assert.ok(!/차단/.test(d.note)); assert.ok(noSecret(r.text));
});
test('83 진단: KRX 서비스별 승인 여부 표시', async () => {
  world({ krxDenied: ['sto/stk_bydd_trd'] }); const r = await call(await fresh(), '/api/diag', { token: GOOD });
  const k = r.body.checks.filter((c) => c.name.startsWith('Open KRX')); assert.equal(k.length, 2);
  assert.ok(!k[0].ok && /이용 권한 없음/.test(k[0].note)); assert.ok(k[1].ok);
});
test('84 DART 키 오류 응답 → 401 DART_010', async () => {
  world({ dart: { status: '010', message: '등록되지 않은 키입니다.' } }); const r = await call(await fresh(), '/api/dart/company.json?corp_code=00120030', { token: GOOD });
  assert.equal(r.status, 401); assert.equal(r.body.error, 'DART_010'); assert.ok(noSecret(r.text));
});

/* ---------- v1.7: 뉴스 페이지 이동(start) ---------- */
test('85 뉴스 start 전달 · 범위 보정(1~1000)', async () => {
  const w = world(); const t = { token: GOOD };
  await call(await fresh(), '/api/naver/news?query=%EC%83%81%EB%B2%95&display=100&start=101', t);
  await call(await fresh(), '/api/naver/news?query=%EC%83%81%EB%B2%95&display=100&start=99999', t);
  await call(await fresh(), '/api/naver/news?query=%EC%83%81%EB%B2%95&display=100&start=-5', t);
  const urls = w.fetches.filter((f) => f.url.includes('openapi.naver')).map((f) => f.url);
  assert.ok(urls[0].includes('start=101')); assert.ok(urls[1].includes('start=1000')); assert.ok(!urls[2].includes('start='), '1이면 생략');
  assert.ok(urls.every((u) => u.includes('display=100')));
});
test('86 뉴스: 페이지별 캐시 분리(1페이지 캐시가 2페이지 응답이 되지 않음)', async () => {
  const w = world(); const wk = await fresh(); const t = { token: GOOD };
  await call(wk, '/api/naver/news?query=ESG&display=100', t); await call(wk, '/api/naver/news?query=ESG&display=100&start=101', t);
  assert.equal(w.fetches.filter((f) => f.url.includes('openapi.naver')).length, 2);
});

/* ---------- v1.8: XBRL 원본(fnlttXbrl.xml) 바이너리 전달 ---------- */
const ZIP = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]); // 빈 ZIP(EOCD만)
const xbrlWorld = (resp) => world({ upstream: (url) => (url.includes('fnlttXbrl.xml') ? resp(url) : null) });
const XQ = '/api/dart/fnlttXbrl.xml?rcept_no=20260814000111&reprt_code=11012';
test('87 XBRL: ZIP 그대로 전달(content-type zip, 바이트 동일)', async () => {
  const w = xbrlWorld(() => new Response(ZIP, { headers: { 'content-type': 'application/x-msdownload' } }));
  const r = await call(await fresh(), XQ, { token: GOOD });
  assert.equal(r.status, 200); assert.equal(r.res.headers.get('content-type'), 'application/zip');
  const u = w.fetches.find((f) => f.url.includes('fnlttXbrl.xml')).url;
  assert.ok(u.includes('rcept_no=20260814000111') && u.includes('reprt_code=11012') && u.includes('crtfc_key='));
  assert.equal(w.fetches.find((f) => f.url.includes('fnlttXbrl.xml')).redirect, 'manual');
});
test('88 XBRL: 자료 없음(XML 013) → JSON status 013', async () => {
  xbrlWorld(() => new Response('<?xml version="1.0"?><result><status>013</status><message>조회된 데이타가 없습니다.</message></result>', { headers: { 'content-type': 'application/xml' } }));
  const r = await call(await fresh(), XQ, { token: GOOD });
  assert.equal(r.status, 200); assert.equal(r.body.status, '013');
});
test('89 XBRL: 키 오류(010) → 401 DART_010, 키 노출 없음', async () => {
  xbrlWorld(() => new Response('<result><status>010</status><message>등록되지 않은 키입니다.</message></result>', { headers: { 'content-type': 'text/xml' } }));
  const r = await call(await fresh(), XQ, { token: GOOD });
  assert.equal(r.status, 401); assert.equal(r.body.error, 'DART_010'); assert.ok(noSecret(r.text));
});
test('90 XBRL: 잘못된 접수번호·보고서코드 거부(외부 호출 없음)', async () => {
  const w = xbrlWorld(() => new Response(ZIP));
  for (const q of ['rcept_no=123&reprt_code=11012', 'rcept_no=20260814000111&reprt_code=99999', 'rcept_no=../../x&reprt_code=11012', 'reprt_code=11012']) {
    const r = await call(await fresh(), '/api/dart/fnlttXbrl.xml?' + q, { token: GOOD });
    assert.equal(r.status, 400, q);
  }
  assert.equal(w.fetches.filter((f) => f.url.includes('fnlttXbrl')).length, 0);
});
test('91 XBRL: 리다이렉트 차단 감지 · 무토큰 401 · 공시원문(document.xml)은 경로 없음', async () => {
  xbrlWorld(() => new Response(null, { status: 302, headers: { location: 'https://opendart.fss.or.kr/error1.html' } }));
  assert.equal((await call(await fresh(), XQ, { token: GOOD })).body.error, 'UPSTREAM_BLOCKED');
  assert.equal((await call(await fresh(), XQ)).status, 401);
  assert.equal((await call(await fresh(), '/api/dart/document.xml?rcept_no=20260814000111', { token: GOOD })).status, 400);
});
test('92 XBRL: subrequest 1회(무료 한도 영향 최소)', async () => {
  const w = xbrlWorld(() => new Response(ZIP, { headers: { 'content-type': 'application/zip' } }));
  await call(await fresh(), XQ, { token: GOOD });
  assert.ok(sub(w) <= 3, 'subrequests=' + sub(w));
});
test('93 정기보고서 주요정보(DS002) 9종 경로 통과', async () => {
  const w = world();
  for (const ep of ['cprndNrdmpBlce', 'srtpdPsndbtNrdmpBlce', 'entrprsBilScritsNrdmpBlce', 'newCaplScritsNrdmpBlce', 'cndlCaplScritsNrdmpBlce', 'detScritsIsuAcmslt', 'alotMatter', 'tesstkAcqsDspsSttus', 'accnutAdtorNmNdAdtOpinion']) {
    const r = await call(await fresh(), `/api/dart/${ep}.json?corp_code=00120030&bsns_year=2026&reprt_code=11012`, { token: GOOD });
    assert.equal(r.status, 200, ep);
  }
  assert.equal(w.fetches.filter((f) => f.url.includes('opendart')).length, 9);
});

/* ---------- v1.9: 네이버 증권 KRX 정규장 실시간/당일 마감가(/api/stock/realtime) ---------- */
test('94 realtime: 종목·지수 배치 파싱 + 하락 부호 보정 + overMarketPriceInfo 배제', async () => {
  const stockBody = {
    datas: [{
      itemCode: '006360', stockName: 'GS건설', closePrice: '28,650',
      compareToPreviousClosePrice: '1,500', fluctuationsRatio: '4.98',
      compareToPreviousPrice: { code: '5', name: 'FALLING' },
      openPrice: '29,750', highPrice: '29,750', lowPrice: '28,250',
      accumulatedTradingVolume: '801,414', accumulatedTradingValue: '23,300백만',
      marketStatus: 'OPEN', localTradedAt: '2026-11-23T10:15:00+09:00',
      overMarketPriceInfo: { closePrice: '31,000', overMarketStatus: 'OPEN' },
    }],
  };
  const idxBody = {
    datas: [{
      itemCode: 'KOSPI', stockName: '코스피', closePrice: '4,869.96',
      compareToPreviousClosePrice: '-267.50', fluctuationsRatio: '-5.21',
      compareToPreviousPrice: { code: '5', name: 'FALLING' },
      marketStatus: 'OPEN', localTradedAt: '2026-11-23T10:15:00+09:00',
    }],
  };
  world({
    upstream: (url) => {
      if (url.includes('polling.finance.naver.com/api/realtime/domestic/stock/')) return new Response(JSON.stringify(stockBody), { headers: { 'content-type': 'application/json' } });
      if (url.includes('polling.finance.naver.com/api/realtime/domestic/index/')) return new Response(JSON.stringify(idxBody), { headers: { 'content-type': 'application/json' } });
      return null;
    },
  });
  const r = await call(await fresh(), '/api/stock/realtime?codes=006360&index=1', { token: GOOD });
  assert.equal(r.status, 200);
  assert.equal(r.body.marketStatus, 'OPEN');
  assert.equal(r.body.date, '20261123');
  assert.equal(r.body.time, '10:15');
  assert.equal(r.body.stocks[0].close, 28650);
  assert.equal(r.body.stocks[0].change, -1500);
  assert.equal(r.body.stocks[0].rate, -4.98);
  assert.equal(r.body.stocks[0].value, 23300000000);
  assert.equal(r.body.index.kospi.close, 4869.96);
});
