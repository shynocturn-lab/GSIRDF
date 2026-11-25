import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
const { subtle } = crypto;
const pair = await subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk = {...await subtle.exportKey('jwk',pair.publicKey),kid:'test-key',alg:'RS256',use:'sig'};
let dartCalls = 0;
globalThis.fetch = async (url) => {
  const str = String(url);
  if (str.includes('securetoken@system.gserviceaccount.com')) return Response.json({keys:[jwk]}, {headers:{'cache-control':'max-age=3600'}});
  if (str.includes('opendart.fss.or.kr')) { dartCalls++; return Response.json({status:'000', source:'test'}); }
  throw new Error('unexpected upstream');
};
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
async function token(email, extra={}) {
 const now = Math.floor(Date.now()/1000), h = b64({alg:'RS256',kid:'test-key'}), p = b64({aud:'team-project',iss:'https://securetoken.google.com/team-project',sub:'abc',exp:now+3600,iat:now,email,email_verified:true,firebase:{sign_in_provider:'google.com'}, ...extra});
 const sig=await subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(`${h}.${p}`));
 return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;
}
async function req(env, path='/api/health', t='', headers={}) {
 return worker.fetch(new Request('https://team.example'+path,{headers:{...(t?{Authorization:'Bearer '+t}:{}),...headers}}),env,{waitUntil(){}});
}
const base={FIREBASE_PROJECT_ID:'team-project'};
test('기본 정책은 허용 목록이 비어 있으면 거부', async()=>{assert.equal((await req(base,'/api/health',await token('person@gmail.com'))).status,403)});
test('인증 없는 요청은 AUTH_DISABLED=1로도 우회 불가', async()=>{assert.equal((await req({...base,AUTH_DISABLED:'1'})).status,401)});
test('허용 목록은 지정된 이메일만 통과', async()=>{let e={...base,ALLOWED_EMAILS:'person@gmail.com'};assert.equal((await req(e,'/api/health',await token('person@gmail.com'))).status,200);assert.equal((await req(e,'/api/health',await token('other@gmail.com'))).status,403)});
test('알 수 없는 정책은 모든 계정을 차단',async()=>{let e={...base,ACCESS_MODE:'gmail_test'};assert.equal((await req(e,'/api/health',await token('outsider@gmail.com'))).status,403)});
test('회사 도메인은 정확히 일치하고 Google 로그인이어야 함',async()=>{let e={...base,ACCESS_MODE:'domain',ALLOWED_DOMAIN:'company.com'};assert.equal((await req(e,'/api/health',await token('person@company.com'))).status,200);assert.equal((await req(e,'/api/health',await token('person@evilcompany.com'))).status,403);assert.equal((await req(e,'/api/health',await token('person@company.com',{firebase:{sign_in_provider:'password'}}))).status,403)});
test('Worker 기본 키는 사용하지 않고 개인 키별 캐시 구분',async()=>{const t=await token('person@gmail.com'),e={...base,ALLOWED_EMAILS:'person@gmail.com',DART_KEY:'SHOULD_NOT_BE_USED'}, path='/api/dart/company.json?corp_code=00120030';assert.equal((await req(e,path,t)).status,503);assert.equal((await req(e,path,t,{'X-IDF-DART':'key-one'})).status,200);assert.equal((await req(e,path,t,{'X-IDF-DART':'key-one'})).status,200);assert.equal((await req(e,path,t,{'X-IDF-DART':'key-two'})).status,200);assert.equal(dartCalls,2)});
