import assert from 'node:assert/strict';
import {getUserKeys} from './byok.ts';
const a='a'.repeat(24),b='b'.repeat(24);const original=globalThis.fetch;
globalThis.fetch=async url=>{const uid=new URL(url).searchParams.get('user_id');return{ok:true,json:async()=>({userId:uid,keys:{openai:{apiKey:'fake-'+uid}}})}};
try{const [ka,kb]=await Promise.all([getUserKeys({apiBaseUrl:'https://isolated.test',serviceSecret:'test',userId:a}),getUserKeys({apiBaseUrl:'https://isolated.test',serviceSecret:'test',userId:b})]);assert.equal(ka.openai.apiKey,'fake-'+a);assert.equal(kb.openai.apiKey,'fake-'+b);globalThis.fetch=async()=>({ok:true,json:async()=>({userId:b,keys:{openai:{apiKey:'foreign'}}})});await assert.rejects(()=>getUserKeys({apiBaseUrl:'https://isolated.test',serviceSecret:'test',userId:a,fresh:true}),/owner mismatch/);console.log('OpenClaw BYOK: two concurrent owners isolated; mismatched owner rejected');}finally{globalThis.fetch=original}
