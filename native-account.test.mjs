import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {readNativeConfig,createNativeVerifier,createNativeHandler,NATIVE_COOKIE,BROWSER_COOKIE} from './server/native-account.mjs';
import {createRematchAccount} from './native-account.js';
import {createNativeStore} from './server/native-store.mjs';import {readTargetConfig} from './server/pixel-target.mjs';
const origin='https://rematch-rush.vercel.app',base='https://ep-native.neonauth.us-east-1.aws.neon.tech/rematch_pixel/auth';
const env={REMATCH_NATIVE_AUTH_APPROVED:'true',REMATCH_NATIVE_AUTH_URL:base,REMATCH_NATIVE_JWKS_URL:base+'/.well-known/jwks.json',REMATCH_NATIVE_ISSUER:base,REMATCH_NATIVE_AUDIENCE:base,REMATCH_NATIVE_SCHEMA_HISTORY:'a'.repeat(64)};
test('Rematch native authority is default-OFF and rejects foreign/incomplete configuration',()=>{
 assert.equal(readNativeConfig({}),null);assert.equal(readNativeConfig(env).baseUrl,base);
 for(const change of [{REMATCH_NATIVE_AUTH_URL:'https://attacker.invalid/auth'},{REMATCH_NATIVE_JWKS_URL:'https://other.neon.tech/keys'},{REMATCH_NATIVE_ISSUER:'https://pixel-pulse-websites.vercel.app/api/sso'},{REMATCH_NATIVE_SCHEMA_HISTORY:''},{REMATCH_NATIVE_AUDIENCE:''}])assert.throws(()=>readNativeConfig({...env,...change}));
});
test('actual JOSE verifier requires the approved native issuer/audience, verified email, finite original token and EdDSA signature',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('EdDSA'),jwk=await exportJWK(publicKey);jwk.kid='local';let now=Date.now(),sec=Math.floor(now/1000);const verify=createNativeVerifier(readNativeConfig(env),{keySet:createLocalJWKSet({keys:[jwk]}),clock:()=>now});
 const token=async(claims={},key=privateKey)=>new SignJWT({sub:'original-native-subject',emailVerified:true,name:'Player',iat:sec,exp:sec+600,iss:base,aud:base,...claims}).setProtectedHeader({alg:'EdDSA',kid:'local'}).sign(key);
 assert.equal((await verify(await token())).subject,'original-native-subject');
 for(const claims of [{emailVerified:false},{iss:'https://pixel-pulse-websites.vercel.app/api/sso'},{aud:'another-game'},{exp:sec-1},{iat:sec+1},{exp:sec+901},{sub:''}])await assert.rejects(verify(await token(claims)));
});
const request=(action,body={},cookie='')=>new Request(origin+'/api/account/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
test('native handler refuses foreign origins, account/role injection and missing original proof before any store write',async()=>{
 let calls=0;const h=createNativeHandler({getDependencies:()=>({config:{},verify:async()=>{calls++;return {issuer:base,subject:'x',expiresAt:Date.now()+300000};},store:{}})});
 const foreign=request('create');foreign.headers.set('Origin','https://other.test');assert.equal((await h(foreign)).status,403);
 assert.equal((await h(request('create',{token:'fake',flow:'a'.repeat(43),accountId:'original',role:'admin'},BROWSER_COOKIE+'='+'b'.repeat(43)))).status,400);assert.equal(calls,0);
 assert.equal((await h(request('claim',{token:'fake',flow:'a'.repeat(43)},BROWSER_COOKIE+'='+'b'.repeat(43)))).status,401);
});
test('native sign-in never creates an unknown profile automatically, while explicit claim carries only original session proof',async()=>{
 const inputs=[],now=Date.now(),h=createNativeHandler({getDependencies:()=>({config:{},verify:async()=>({issuer:base,subject:'native-subject',expiresAt:now+240000}),store:{exchange:async x=>{inputs.push(x);return x.mode==='login'?{setupRequired:true}:{expiresAt:now+230000};}}}),clock:()=>now});
 const cookies=BROWSER_COOKIE+'='+'b'.repeat(43),body={token:'signed-token',flow:'f'.repeat(43)};
 assert.deepEqual(await (await h(request('login',body,cookies))).json(),{setupRequired:true});
 const claim=await h(request('claim',body,cookies+'; __Host-rematch-pixel-session='+'p'.repeat(43)));assert.equal(claim.status,200);assert.match(claim.headers.get('set-cookie'),new RegExp(NATIVE_COOKIE));assert.equal(inputs[1].legacyHash.length,64);assert.equal(inputs[1].identity.subject,'native-subject');assert.equal(inputs[1].mode,'claim');assert.equal('accountId' in inputs[1],false);
});
test('expired native identity or late completion cannot emit an admission cookie',async()=>{
 let now=Date.now();const h=createNativeHandler({getDependencies:()=>({config:{},verify:async()=>({expiresAt:now+1000}),store:{exchange:async()=>{now+=1001;return{expiresAt:now-1};}}}),clock:()=>now});
 const r=await h(request('login',{token:'signed',flow:'f'.repeat(43)},BROWSER_COOKIE+'='+'b'.repeat(43)));assert.equal(r.status,503);assert.equal(r.headers.has('set-cookie'),false);
});
test('browser uses the maintained email/password SDK; passwords never enter game exchange requests or device storage',async t=>{
 const sent=[],sdkCalls=[];const sdk={getSession:async()=>({data:{}}),signIn:{email:async x=>{sdkCalls.push(x);return{data:{}};}},token:async()=>({data:{token:'signed-native-jwt'}})};
 const api=createRematchAccount({clientFactory:()=>sdk,onChange:()=>{},fetcher:async(url,options)=>{if(url.endsWith('/config'))return{ok:true,json:async()=>({enabled:true,authUrl:base})};const body=JSON.parse(options.body);sent.push({url,body});return{ok:true,json:async()=>url.endsWith('/start')?{flow:'f'.repeat(43)}:{authenticated:true,expiresAt:Date.now()+240000}};}});t.after(()=>api.dispose());
 await api.refresh();await api.signIn('player@example.invalid','a local synthetic password');assert.equal(sdkCalls.length,1);assert.equal(sent.some(x=>JSON.stringify(x.body).includes('synthetic password')),false);assert.deepEqual(Object.keys(sent.at(-1).body).sort(),['flow','token']);
});
test('published account shell uses Rematch email/password and explicit preservation, while legacy Pixel composition remains separate',async()=>{
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8');assert.match(html,/id="rematch-email" type="email"/);assert.match(html,/id="rematch-password" type="password"/);assert.match(html,/Keep existing Rematch progress/);assert.doesNotMatch(html,/Continue with Pixel Pulse|id="pixel-account"/);
 const sql=await readFile(new URL('./ops/sql/native-accounts.sql',import.meta.url),'utf8');assert.match(sql,/RAISE EXCEPTION 'REMATCH_NATIVE_TARGET_AND_PRIVILEGE_REVIEW_REQUIRED'/);assert.doesNotMatch(sql,/DELETE FROM|DROP TABLE|UPDATE rematch_game|UPDATE rematch_pixel/);assert.match(sql,/FOREIGN KEY\(issuer,subject,account_id\)/);
});

function sqlRecorder({late=false,lostAck=false}={}){
 const history='a'.repeat(64),baseHistory='b'.repeat(64),account='10000000-0000-4000-8000-000000000001',start=Date.now();let now=start,saved,flushes=0;const calls=[];
 const target=readTargetConfig({NODE_ENV:'test',REMATCH_PIXEL_LOCAL_TEST_MODE:'true',REMATCH_PIXEL_TARGET_APPROVED:'true',REMATCH_PIXEL_DATABASE_URL:'postgresql://rematch_test@127.0.0.1:5432/rematch_pixel_test_abcdef',REMATCH_PIXEL_APPROVED_HOST:'127.0.0.1',REMATCH_PIXEL_APPROVED_PORT:'5432',REMATCH_PIXEL_APPROVED_DATABASE:'rematch_pixel_test_abcdef',REMATCH_PIXEL_APPROVED_ROLE:'rematch_test',REMATCH_PIXEL_APPROVED_HISTORY:baseHistory});
 class Pool{on(){}async connect(){return{release(){},async query(sql,args){calls.push({sql,args});let rows=[];
  if(sql.startsWith('SELECT current_database'))rows=[{db:'rematch_pixel_test_abcdef',role:'rematch_test',port:5432}];
  else if(sql.startsWith('SELECT rolsuper'))rows=[{rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false,rolinherit:false}];
  else if(sql.includes('FROM pg_class'))rows=['schema_meta','bindings','sessions','browsers'].map(relname=>({relname,relkind:'r',owner:'owner',public_acl:false,triggers:false,rules:false}));
  else if(sql.includes('SELECT migration_hash FROM rematch_pixel'))rows=[{migration_hash:baseHistory}];
  else if(sql.includes('SELECT migration_hash FROM rematch_native'))rows=[{migration_hash:history}];
  else if(sql.includes('SELECT mode,generation'))rows=[{mode:'claim',generation:7,expires_at:new Date(start+300000),revoked_at:null,consumed_at:null}];
  else if(sql.includes('SELECT account_id FROM rematch_native.bindings'))rows=[];
  else if(sql.includes('FROM rematch_pixel.sessions'))rows=[{account_id:account,expires_at:new Date(start+1000)}];
  else if(sql.startsWith('INSERT INTO rematch_native.sessions'))saved={account_id:args[3],expires_at:args[4]};
  else if(sql.includes('FROM rematch_native.sessions s'))rows=saved?[saved]:[];
  else if(sql.startsWith('SET CONSTRAINTS')){flushes++;if(late&&flushes===2)now=start+2000;}
  else if(sql.startsWith('SELECT clock_timestamp'))rows=[{now:new Date(now)}];
  else if(sql==='COMMIT'&&lostAck)throw Error('Injected lost COMMIT acknowledgment');
  return {rows,rowCount:rows.length};}};}async end(){}}
 const store=createNativeStore(target,{history,PoolClass:Pool});
 return{store,calls,input:{identity:{issuer:base,subject:'owned-native',expiresAt:start+240000,name:'Player'},mode:'claim',browserHash:'b'.repeat(64),flowHash:'f'.repeat(64),legacyHash:'l'.repeat(64),tokenHash:'t'.repeat(64),sessionEnd:start+200000,newAccountId:'20000000-0000-4000-8000-000000000002'},account};
}
test('actual native SQL wrapper binds to the proven original UUID without updating any original profile, balance, role or credential',async()=>{
 const{store,calls,input,account}=sqlRecorder();await store.exchange(input);const binding=calls.find(c=>c.sql.startsWith('INSERT INTO rematch_native.bindings'));assert.equal(binding.args[2],account);assert.equal(calls.some(c=>/INSERT INTO rematch_pixel.accounts|UPDATE rematch_game|UPDATE rematch_pixel.accounts|DELETE FROM/.test(c.sql)),false);assert.equal(calls.at(-1).sql,'COMMIT');assert.ok(calls.some(c=>c.sql.includes('consumed_at=clock_timestamp()')));
});
test('actual native wrapper retains the earlier original-account expiry through its final deferred-work fence',async()=>{
 const{store,calls,input}=sqlRecorder({late:true});await assert.rejects(store.exchange(input),/Sign in again/);assert.equal(calls.at(-1).sql,'ROLLBACK');assert.equal(calls.some(c=>c.sql==='COMMIT'),false);
});
test('actual native wrapper treats lost COMMIT acknowledgment as uncertain instead of promising no change or retrying setup',async()=>{
 const{store,input,calls}=sqlRecorder({lostAck:true});await assert.rejects(store.exchange(input),e=>e.uncertain===true&&/original account again/.test(e.message));assert.equal(calls.filter(c=>c.sql==='COMMIT').length,1);
});

test('explicit Rematch sign-out revokes the presented original recovery session as well as native access, with no old-cookie fallback',async()=>{
 let args;const h=createNativeHandler({getDependencies:()=>({config:{},store:{revoke:async(...values)=>{args=values;}}})});
 const r=await h(request('sign-out',{},NATIVE_COOKIE+'='+'n'.repeat(43)+'; '+BROWSER_COOKIE+'='+'b'.repeat(43)+'; __Host-rematch-pixel-session='+'p'.repeat(43)));
 assert.equal(r.status,200);assert.equal(args.length,3);assert.ok(args.every(x=>/^[a-f0-9]{64}$/.test(x)));assert.match(r.headers.get('set-cookie'),/__Host-rematch-pixel-session=;/);assert.match(r.headers.get('set-cookie'),/__Host-rematch-account-session=;/);
});
