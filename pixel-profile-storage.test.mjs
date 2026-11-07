import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {model,history,firstHistory,hash,issuer,markAccepted} from './test/support/pixel-profile-model.mjs';

test('first-profile work requires child history while accepted security observation uses only base contract',async()=>{
  const f=model({omitHistory:true});
  assert.throws(()=>f.store.checkProfileReady(),/storage is not ready/);
  assert.throws(()=>f.store.createProfileAttempt(f.context),/storage is not ready/);
  assert.equal(f.connections,0);
  await assert.rejects(f.store.createStandaloneProfile(f.input),/storage is not ready/);
  assert.equal(f.connections,1,'security-only observation still checks the independently approved base target');
  assert.equal(f.statements.some(s=>s.sql.includes('FROM rematch_pixel_first.schema_meta')),false);
});
for(const failure of ['wrongHistory','badColumns','badConstraints'])test('first child contract refuses '+failure+' without creating an attempt',async()=>{
  const f=model({[failure]:true});await assert.rejects(f.store.checkProfileReady());await assert.rejects(f.store.createProfileAttempt(f.context));
  assert.deepEqual(f.state,{accounts:[],bindings:[],attempts:[],firstAttempts:[],receipts:[],sessions:[]});
});
test('standalone profile creates exactly one explicit new UUID/binding/receipt/session and consumes only its attempt',async()=>{
  const f=model();assert.equal(await f.store.checkProfileReady(),true);assert.equal(await f.store.getProfileAttempt(f.context),null);
  assert.deepEqual(await f.prepare(),{targetAccountId:f.context.targetAccountId,expectedSubject:'new_actor',admissionExpiresAt:f.context.admissionExpiresAt.toISOString()});
  const session=await f.store.createStandaloneProfile(f.input);
  assert.equal(session.accountId,f.context.targetAccountId);assert.equal(session.displayName,'New player');assert.equal(session.expiresAt,f.input.identityExpiresAt.toISOString());
  const saved=f.state;for(const table of ['accounts','bindings','receipts','sessions'])assert.equal(saved[table].length,1);
  assert.equal(saved.bindings[0].floor_epoch,2);assert.equal(saved.receipts[0].proof_hash,hash(f.input.proof.jti));
  assert.equal(saved.attempts[0].completed_at!==null,true);assert.equal(await f.store.getProfileAttempt(f.context),null);
  assert.equal(await f.store.createStandaloneProfile(f.input),null);assert.deepEqual(f.state,saved);
  const final=f.statements.findLastIndex(q=>q.sql.startsWith('WITH first_fence AS MATERIALIZED'));
  assert.equal(f.statements[final+1].sql,'COMMIT','no mutation or query follows final locked-state clock fence');
});
test('base attempt and child purpose insert are atomic when the child write fails',async()=>{
  const f=model({failAfter:'child'});await assert.rejects(f.store.createProfileAttempt(f.context));
  assert.equal(f.state.attempts.length,0);assert.equal(f.state.firstAttempts.length,0);assert.ok(f.events.includes('rollback'));
});
test('new attempt retains a fixed original five-minute ceiling even when the caller asks longer',async()=>{
  const f=model();f.context.expiresAt=new Date(f.initialTime+900000);f.context.admissionExpiresAt=new Date(f.initialTime+300000);await f.store.createProfileAttempt(f.context);
  assert.equal(new Date(f.state.attempts[0].expires_at).getTime(),f.initialTime+300000);
});
test('new attempt rejects a trigger-modeled extension of its original expiry',async()=>{
  const f=model({extendCreatedAttempt:true});await assert.rejects(f.store.createProfileAttempt(f.context));assert.equal(f.state.attempts.length,0);
});
for(const cap of ['attemptCap','browserCap'])test('new first attempt refuses '+cap+' with no partial insert',async()=>{
  const f=model({[cap]:true});await assert.rejects(f.store.createProfileAttempt(f.context));assert.equal(f.state.attempts.length,0);
});
test('at most six first-profile attempts are retained for one browser within the finite window',async()=>{
  const f=model();for(let i=0;i<6;i++)await f.store.createProfileAttempt({...f.context,stateHash:hash('state '+i),targetAccountId:randomUUID()});
  await assert.rejects(f.store.createProfileAttempt({...f.context,stateHash:hash('seventh'),targetAccountId:randomUUID()}));assert.equal(f.state.attempts.length,6);
});
for(const cap of ['profileCap','sessionCap','receiptCap'])test('profile completion refuses '+cap+' without any new profile/binding/receipt/session',async()=>{
  const f=model({[cap]:true});await f.prepare();const before=f.state;assert.equal(await f.store.createStandaloneProfile(f.input),null);assert.deepEqual(f.state,before);
});
for(const mismatch of ['stateHash','browserHash','nonce','codeVerifier','targetAccountId'])test('completion seals the original '+mismatch+' under the admission lock',async()=>{
  const f=model();await f.prepare();const before=f.state;
  const value=mismatch==='targetAccountId'?randomUUID():mismatch.endsWith('Hash')?hash('changed'):'x'.repeat(mismatch==='codeVerifier'?43:32);
  assert.equal(await f.store.createStandaloneProfile({...f.input,[mismatch]:value}),null);assert.deepEqual(f.state,before);
});
for(const problem of ['unconsumed','cancelled','expired','purpose'])test('profile completion rejects '+problem+' admission without mutating account data',async()=>{
  const f=model();await f.prepare();f.change(state=>{if(problem==='unconsumed')state.attempts[0].consumed_at=null;if(problem==='cancelled')state.attempts[0].cancelled_at=new Date(f.initialTime).toISOString();if(problem==='expired')state.attempts[0].expires_at=new Date(f.initialTime).toISOString();if(problem==='purpose')state.firstAttempts[0].purpose='return';});
  const before=f.state;assert.equal(await f.store.createStandaloneProfile(f.input),null);assert.deepEqual(f.state,before);
});
test('known subject and chosen existing UUID are refused rather than adopted, merged, renamed or rebound',async()=>{
  for(const problem of ['subject','uuid']){
    const f=model();await f.prepare();f.change(state=>{const id=problem==='uuid'?f.context.targetAccountId:randomUUID();state.accounts.push({id,display_name:'Existing',created_at:new Date(f.initialTime-1000).toISOString()});state.bindings.push({issuer,subject:problem==='subject'?f.input.subject:'other',account_id:id,floor_epoch:7,created_at:new Date(f.initialTime-1000).toISOString()});});
    const before=f.state;assert.equal(await f.store.createStandaloneProfile(f.input),null);assert.deepEqual(f.state,before);
  }
});
test('proof replay under a fresh attempt rolls back every later account/binding write',async()=>{
  const f=model();await f.prepare();await f.store.createStandaloneProfile(f.input);const next={...f.context,stateHash:hash('next'),targetAccountId:randomUUID(),expectedSubject:'other_new'};
  await f.store.createProfileAttempt(next);await f.store.consumeAttempt(next);const before=f.state;
  await assert.rejects(f.store.createStandaloneProfile({...f.input,...next,subject:'other_new',acceptedIdentity:markAccepted({issuer,subject:'other_new',credentialVersion:2}),proof:{...f.input.proof,subject:'other_new'},tokenHash:hash('another session')}));
  assert.deepEqual(f.state,before);
});
for(const point of ['account','binding','receipt','session','completion','flush','lastRead','clock'])test('transaction rollback preserves all data after modeled '+point+' failure',async()=>{
  const f=model();await f.prepare();const before=f.state;
  // Switch only after creating/consuming the attempt, so the failure targets completion.
  // Each model instance owns this synthetic mutable option object.
  const g=model({failAfter:point});g.change(state=>Object.assign(state,structuredClone(before)));
  await assert.rejects(g.store.createStandaloneProfile({...g.input,...f.context,targetAccountId:f.context.targetAccountId,proof:{...g.input.proof},stateHash:f.context.stateHash,browserHash:f.context.browserHash}));
  assert.deepEqual(g.state,before);
});
for(const mutation of ['account','binding','receipt','session','child','attempt','cancel','policy','actor'])test('post-write/deferred modeled '+mutation+' corruption rolls back all first-profile mutations',async()=>{
  const f=model();await f.prepare();const before=f.state,g=model({mutateAfterFlush:mutation});g.change(state=>Object.assign(state,structuredClone(before)));
  const input={...g.input,...f.context,targetAccountId:f.context.targetAccountId};assert.equal(await g.store.createStandaloneProfile(input),null);assert.deepEqual(g.state,before);
});
for(const phase of ['advanceAfterSession','advanceAfterCompletion','advanceAfterFlush','advanceAfterLastRead'])for(const delta of [20000,20001])test('original proof expiry is strict after '+phase+' at '+delta+'ms',async()=>{
  const f=model();await f.prepare();const before=f.state,g=model({[phase]:delta});g.change(state=>Object.assign(state,structuredClone(before)));
  assert.equal(await g.store.createStandaloneProfile({...g.input,...f.context,targetAccountId:f.context.targetAccountId}),null);assert.deepEqual(g.state,before);
});
for(const malformed of [
  {issuer:'https://foreign.invalid'}, {subject:''}, {credentialVersion:-1}, {expectedFlowHash:hash('wrong')}, {redirectUri:'https://other.invalid/callback'},
  {proof:{issuer,subject:'other'}}, {proof:{issuer,subject:'new_actor',credentialVersion:2,flowHash:hash('exact-nine-field-flow'),issuedAt:1,authTime:2}},
])test('malformed optional Create input refuses after trusted observation without profile writes '+Object.keys(malformed).join(','),async()=>{
  const f=model();await assert.rejects(f.store.createStandaloneProfile({...f.input,...malformed}));assert.equal(f.state.accounts.length,0);assert.equal(f.state.bindings.length,0);assert.equal(f.state.sessions.length,0);
});
test('future issued-at and stale password proof are refused before a profile is written',async()=>{
  for(const change of [{issuedAt:1_800_000_001,authTime:1_800_000_000,expiresAt:new Date(1_800_000_020_000).toISOString()},
    {issuedAt:1_800_000_000,authTime:1_799_999_910,expiresAt:new Date(1_800_000_020_000).toISOString()}]){
    const f=model();await f.prepare();const before=f.state;if(change.authTime===1_799_999_910)f.setNow(f.initialTime+1);
    assert.equal(await f.store.createStandaloneProfile({...f.input,proof:{...f.input.proof,...change}}),null);assert.deepEqual(f.state,before);
  }
});
test('first admission subject is immutable even for a different otherwise matching verified identity/proof',async()=>{
  const f=model();await f.prepare();const before=f.state;
  assert.equal(await f.store.createStandaloneProfile({...f.input,subject:'different_actor',acceptedIdentity:markAccepted({issuer,subject:'different_actor',credentialVersion:2}),proof:{...f.input.proof,subject:'different_actor'}}),null);assert.deepEqual(f.state,before);
});
test('completion may shorten the original pinned policy end but cannot extend it',async()=>{
  const f=model();await f.prepare();const before=f.state;
  assert.equal(await f.store.createStandaloneProfile({...f.input,admissionExpiresAt:new Date(f.initialTime+50001)}),null);assert.deepEqual(f.state,before);
  assert.ok(await f.store.createStandaloneProfile({...f.input,admissionExpiresAt:new Date(f.initialTime+10000)}));
});
for(const delta of [10000,10001])test('shortened policy remains strict at final write boundary '+delta+'ms',async()=>{
  const f=model();await f.prepare();const before=f.state,g=model({advanceAfterCompletion:delta});g.change(state=>Object.assign(state,structuredClone(before)));
  assert.equal(await g.store.createStandaloneProfile({...g.input,...f.context,admissionExpiresAt:new Date(f.initialTime+10000)}),null);assert.deepEqual(g.state,before);
});
for(const delta of [-1,0,300001])test('expired or overlong pinned first policy refuses atomic attempt '+delta+'ms',async()=>{
  const f=model();await assert.rejects(f.store.createProfileAttempt({...f.context,admissionExpiresAt:new Date(f.initialTime+delta)}));assert.equal(f.state.attempts.length,0);assert.equal(f.state.firstAttempts.length,0);
});
test('local first-profile fixture is separately guarded and contains no production/account adoption instructions',async()=>{
  const source=await readFile(new URL('./test/fixtures/pixel-first-profile-local.sql',import.meta.url),'utf8');
  assert.match(source,/DISPOSABLE LOCAL TEST FIXTURE ONLY/);assert.match(source,/current_database\(\).*rematch_pixel_test_/s);assert.match(source,/inet_server_addr\(\) IS NULL/);
  assert.match(source,new RegExp(firstHistory));assert.doesNotMatch(source,/CREATE ROLE|CREATE DATABASE|ALTER ROLE|ON CONFLICT|UPDATE rematch_pixel\./i);
});

test('authorized disposable native first-profile transport, concurrency and deadline suite', {
  skip: !(process.env.REMATCH_PIXEL_NATIVE_FIRST_PROFILE_CONTEXT && process.env.REMATCH_PIXEL_NATIVE_FIRST_PROFILE_PERMIT),
  timeout: 120_000,
}, async t => {
  // A real runnable suite replaces the old unimplemented placeholder. The
  // native module/driver are not imported in a default credential-free run;
  // the old REMATCH_PIXEL_TEST_CONTEXT flag cannot enable this new scope.
  let context;
  try { context = JSON.parse(await readFile(process.env.REMATCH_PIXEL_NATIVE_FIRST_PROFILE_CONTEXT, 'utf8')); }
  catch { throw new Error('Native fixture context could not be read as non-secret JSON.'); }
  const { runNativeFirstProfileSuite } = await import('./test/native-first-profile.mjs');
  await runNativeFirstProfileSuite(t, { context, permit: process.env.REMATCH_PIXEL_NATIVE_FIRST_PROFILE_PERMIT });
});

function seedKnownOwner(f,{floor=1}={}){
  const accountId=randomUUID(),otherId=randomUUID(),created_at=new Date(f.initialTime-1000).toISOString();
  f.change(state=>{
    state.accounts.push({id:accountId,display_name:'Original',progress:{wins:8},role:'player',created_at},
      {id:otherId,display_name:'Unrelated',progress:{wins:4},role:'player',created_at});
    state.bindings.push({issuer,subject:'new_actor',account_id:accountId,floor_epoch:floor,created_at},
      {issuer,subject:'unrelated',account_id:otherId,floor_epoch:4,created_at});
    for(const [label,subject,owner,signed_epoch]of [['old','new_actor',accountId,1],['same','new_actor',accountId,2],['newer','new_actor',accountId,3],['unrelated','unrelated',otherId,4]])
      state.sessions.push({token_hash:hash(label),issuer,subject,account_id:owner,signed_epoch,expires_at:new Date(f.initialTime+120000).toISOString(),revoked_at:null});
  });
  return {accountId,otherId};
}
function assertLearnedOnly(f,before){
  const after=f.state;
  assert.deepEqual(after.accounts,before.accounts,'original profiles/progress/roles preserved');
  assert.deepEqual(after.attempts,before.attempts,'no admission mutation');
  assert.deepEqual(after.firstAttempts,before.firstAttempts,'no first-profile mutation');
  assert.deepEqual(after.receipts,before.receipts,'no proof receipt or first binding');
  assert.equal(after.bindings.find(b=>b.subject==='new_actor').floor_epoch,2);
  assert.deepEqual(after.bindings.find(b=>b.subject==='unrelated'),before.bindings.find(b=>b.subject==='unrelated'));
  assert.equal(after.sessions.length,before.sessions.length,'no minted session');
  assert.notEqual(after.sessions.find(s=>s.token_hash===hash('old')).revoked_at,null);
  for(const label of ['same','newer','unrelated'])assert.deepEqual(after.sessions.find(s=>s.token_hash===hash(label)),before.sessions.find(s=>s.token_hash===hash(label)));
}

test('known floor1 observed epoch2 commits retirement before Create refuses its existing immutable owner',async()=>{
  const f=model();await f.prepare();seedKnownOwner(f);const before=f.state;
  assert.equal(await f.store.createStandaloneProfile(f.input),null);
  assertLearnedOnly(f,before);
  assert.equal(await f.store.getSession({tokenHash:hash('old')}),null,'old session cannot return');
  assert.ok(await f.store.getSession({tokenHash:hash('same')}),'same epoch is not revoked');
});
for(const refusal of ['name','proof','history','context','tuple'])test('trusted known epoch retirement survives optional '+refusal+' refusal with no profile or mint',async()=>{
  const f=model({omitHistory:refusal==='history'});if(refusal!=='history')await f.prepare();seedKnownOwner(f);const before=f.state;
  const changes={name:{displayName:''},proof:{proof:{}},history:{},context:{redirectUri:'https://foreign.invalid'},tuple:{subject:'optional-projection-mismatch'}};
  await assert.rejects(f.store.createStandaloneProfile({...f.input,...changes[refusal]}));
  assertLearnedOnly(f,before);
});
for(const failure of ['securityFloor','securityRetirement','flush'])test('failed security '+failure+' persistence refuses optional Create and rolls back the attempted retirement',async()=>{
  const f=model({failAfter:failure});seedKnownOwner(f);const before=f.state;
  await assert.rejects(f.store.createStandaloneProfile(f.input));
  assert.deepEqual(f.state,before,'no partial security write/profile/mint survives failed persistence');
  assert.ok(f.events.includes('rollback'));assert.equal(f.events.filter(e=>e==='commit').length,0);
});
for(const floor of [2,3])test('equal or stale trusted epoch2 does not retire or change known floor'+floor,async()=>{
  const f=model();seedKnownOwner(f,{floor});const before=f.state;
  assert.equal(await f.store.observeKnownBindingSecurity(f.input.acceptedIdentity),null);assert.deepEqual(f.state,before);
});
test('unknown trusted subject is noncreating and cannot retire a different binding',async()=>{
  const f=model();seedKnownOwner(f);const before=f.state;
  const unknown=markAccepted({issuer,subject:'unknown',credentialVersion:100});
  assert.equal(await f.store.observeKnownBindingSecurity(unknown),null);assert.deepEqual(f.state,before);
});
for(const fake of [{issuer,subject:'new_actor',credentialVersion:2},{},null,undefined])test('unmarked request-shaped input cannot advance or mint '+String(fake&&Object.keys(fake).length),async()=>{
  const f=model();seedKnownOwner(f);const before=f.state;
  assert.throws(()=>f.store.observeKnownBindingSecurity(fake));
  await assert.rejects(f.store.createStandaloneProfile({...f.input,acceptedIdentity:fake}));
  assert.equal(f.connections,0);assert.deepEqual(f.state,before);
});
