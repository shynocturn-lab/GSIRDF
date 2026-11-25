import {test} from 'node:test';
import assert from 'node:assert/strict';
const mem=new Map();
globalThis.localStorage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)};
globalThis.IDF_TEAM_CONFIG={gateway:'https://worker.example',firebase:{projectId:'test-project',apiKey:'public'}};
const {settings}=await import('../src/js/store.js');
test('서로 다른 로그인 사용자의 개인 키 분리',()=>{
 settings.activateUser('user-a');settings.set({keys:{dart:'DART_A'}});assert.equal(settings.get().keys.dart,'DART_A');
 settings.activateUser('user-b');assert.equal(settings.get().keys.dart,'');settings.set({keys:{dart:'DART_B'}});
 settings.activateUser('user-a');assert.equal(settings.get().keys.dart,'DART_A');settings.activateUser(null);assert.equal(settings.get().keys.dart,'');
 const shared=JSON.parse(mem.get('idf_team_shared_v2'));assert.equal(shared.keys,undefined);
});
