import test from 'node:test';
import assert from 'node:assert/strict';
import {readEnrollmentState,captureEnrollmentWindow,assertEnrollmentWindow} from './server/pixel-enrollment.mjs';
import {enrollmentModel,generation} from './test/support/pixel-enrollment-model.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {createSyntheticProfileTransport} from './test/support/pixel-profile-transport.mjs';
const actorA='11111111-1111-4111-8111-111111111111',actorB='22222222-2222-4222-8222-222222222222';
const notice=r=>new URL(r.headers.get('location')).searchParams.get('pixel');
async function setup(t,options={}){const x=enrollmentModel(options);t.mock.method(Date,'now',()=>x.f.now);const transport=await createSyntheticProfileTransport({store:x.store,subject:actorA,clock:()=>x.f.now,enrollmentPolicy:()=>x.policy,onFetch:options.onFetch});return {...x,transport};}
async function discover(x){const flow=await x.transport.beginDiscovery();assert.equal(notice(await x.transport.complete(flow)),'discovered');return flow;}
async function create(x){const flow=await x.transport.beginCreate();return {flow,response:await x.transport.complete(flow)};}

test('ongoing discovery uses real JOSE ordinary identity without creating an account or session; explicit new fresh Create works',async t=>{
 const x=await setup(t);await discover(x);assert.equal(x.f.state.accounts.length,0);assert.equal(x.f.state.bindings.length,0);assert.equal(x.f.state.sessions.length,0);assert.equal(x.transport.stats().proof,0);assert.equal(x.transport.stats().sessionCookiePresent,false);
 const session=await(await x.transport.session()).json();assert.equal(session.discoveryReady,true);assert.equal(session.authenticated,false);
 const {response}=await create(x);assert.equal(notice(response),'created');assert.equal(x.f.state.accounts.length,1);assert.equal(x.f.state.bindings.length,1);assert.equal(x.f.state.receipts.length,1);assert.equal(x.f.state.sessions.length,1);assert.equal(x.transport.stats().proof,1);assert.equal(x.transport.stats().exchange,2);
 assert.equal((await(await x.transport.session()).json()).authenticated,true);
});
test('closing first enrollment preserves immutable already-bound ordinary return',async t=>{
 const x=await setup(t);await discover(x);assert.equal(notice((await create(x)).response),'created');const original=x.f.state.accounts[0];
 await x.transport.signOut();x.policy.enabled=false;x.f.change(s=>{s.enrollmentPolicy.enabled=false;});
 const returning=await x.transport.beginReturn();assert.equal(notice(await x.transport.complete(returning)),'returned');assert.equal((await(await x.transport.session()).json()).authenticated,true);assert.deepEqual(x.f.state.accounts,[original]);
});
test('unknown ordinary sign-in never provisions or silently becomes Create',async t=>{const x=await setup(t),a=await x.transport.beginReturn();assert.equal(notice(await x.transport.complete(a)),'refused');assert.equal(x.f.state.accounts.length,0);assert.equal(x.f.state.discoveries.length,0);assert.equal(x.transport.stats().proof,0);});
test('same configured generation can discover separate verified actors without any ambient SUBJECT rewrite',async t=>{
 const x=await setup(t);await discover(x);assert.equal(notice((await create(x)).response),'created');
 const other=await createSyntheticProfileTransport({store:x.store,subject:actorB,clock:()=>x.f.now,enrollmentPolicy:()=>x.policy});const y={...x,transport:other};await discover(y);assert.equal(notice((await create(y)).response),'created');assert.equal(x.f.state.accounts.length,2);assert.deepEqual(new Set(x.f.state.bindings.map(b=>b.subject)),new Set([actorA,actorB]));
});
test('new receiver keys are explicit default-OFF and malformed/false never fall back to finite enrollment',()=>{
 assert.equal(readEnrollmentState({}),null);
 for(const env of [{REMATCH_PIXEL_ENROLLMENT_ENABLED:'true'},{REMATCH_PIXEL_ENROLLMENT_GENERATION:generation},{REMATCH_PIXEL_ENROLLMENT_ENABLED:'TRUE',REMATCH_PIXEL_ENROLLMENT_GENERATION:generation}])assert.equal(readEnrollmentState(env).valid,false);
 const closed=readEnrollmentState({REMATCH_PIXEL_ENROLLMENT_ENABLED:'false',REMATCH_PIXEL_ENROLLMENT_GENERATION:generation});assert.equal(closed.valid,true);assert.equal(closed.enabled,false);assert.throws(()=>captureEnrollmentWindow(closed,1800000000000));
});
test('local original aligned window/generation cannot be renewed by later receipt or policy',()=>{
 const current={valid:true,enabled:true,generation},s=captureEnrollmentWindow(current,1800000000001);assert.equal(s.notBeforeMs,1800000000000);assert.equal(s.expiresAt,'2027-01-15T08:05:00.000Z');assert.throws(()=>assertEnrollmentWindow(()=>current,s,1800000300000));assert.throws(()=>assertEnrollmentWindow(()=>({...current,generation:actorA}),s,1800000000001));
});

const hash=v=>createHash('sha256').update(v).digest('hex');
test('Create requires a browser-bound discovery, rejects request-selected identity/target and cannot reuse a consumed receipt',async t=>{
 const x=await setup(t);assert.equal((await x.transport.post('create',{intent:'create',acknowledgeSeparateProfile:true})).status,409);
 assert.equal((await x.transport.post('create',{intent:'create',acknowledgeSeparateProfile:true,subject:actorA})).status,400);
 await discover(x);const flow=await x.transport.beginCreate();assert.equal((await x.transport.post('create',{intent:'create',acknowledgeSeparateProfile:true})).status,409);
 assert.equal(notice(await x.transport.complete(flow)),'created');assert.equal(x.f.state.accounts.length,1);
});
test('discovery replay cannot repeat identity exchange or create any profile',async t=>{
 const x=await setup(t),d=await discover(x),before=x.transport.stats();assert.equal(notice(await x.transport.replay(d)),'refused');assert.equal(x.transport.stats().exchange,before.exchange);assert.equal(x.f.state.discoveries.length,1);assert.equal(x.f.state.accounts.length,0);
});
for(const fault of ['signature'])test('discovery with invalid real signature cannot store authority or create a profile: '+fault,async t=>{
 const x=await setup(t);x.transport.setFault(fault);const d=await x.transport.beginDiscovery();assert.equal(notice(await x.transport.complete(d)),'refused');assert.equal(x.f.state.discoveries.length,0);assert.equal(x.f.state.accounts.length,0);
});
for(const changed of ['actor','epoch'])test('fresh Create cannot switch the discovery '+changed,async t=>{
 const x=await setup(t);await discover(x);x.transport.setSyntheticActor({subject:changed==='actor'?actorB:actorA,credentialVersion:changed==='epoch'?2:1});
 assert.equal(notice((await create(x)).response),'refused');assert.equal(x.transport.stats().proof,0);assert.equal(x.f.state.accounts.length,0);
});
for(const phase of ['discovery','create'])for(const reason of ['closed','generation','window'])test(phase+' callback refuses changed '+reason+' without renewing old receipt',async t=>{
 const x=await setup(t);if(phase==='create')await discover(x);const flow=phase==='create'?await x.transport.beginCreate():await x.transport.beginDiscovery();
 if(reason==='closed')x.policy.enabled=false;if(reason==='generation')x.policy.generation=actorB;if(reason==='window')x.f.setNow(x.f.initialTime+300000);
 const before=x.transport.stats();assert.equal(notice(await x.transport.complete(flow)),'refused');assert.equal(x.transport.stats().exchange,before.exchange);assert.equal(x.transport.stats().proof,0);assert.equal(x.f.state.accounts.length,0);
});
for(const path of ['/oauth2/userinfo','/pixel-pulse/redeem-link'])test('closure during awaited '+path+' prevents optional profile/session mint',async t=>{
 let active=false,x;const onFetch=url=>{if(active&&url.endsWith(path))x.policy.enabled=false;};x=await setup(t,{onFetch});await discover(x);const flow=await x.transport.beginCreate();active=true;
 assert.equal(notice(await x.transport.complete(flow)),'refused');assert.equal(x.f.state.accounts.length,0);assert.equal(x.f.state.sessions.length,0);assert.equal(x.transport.stats().sessionCookiePresent,false);
});
test('original discovery/identity cutoff is enforced before requesting a late one-use fresh proof',async t=>{
 let active=false,x;const onFetch=url=>{if(active&&url.endsWith('/oauth2/userinfo'))x.f.setNow(x.f.initialTime+240000);};x=await setup(t,{onFetch});await discover(x);const flow=await x.transport.beginCreate();active=true;
 assert.equal(notice(await x.transport.complete(flow)),'refused');assert.equal(x.transport.stats().proof,0);assert.equal(x.f.state.accounts.length,0);
});
test('an already accepted higher trusted epoch survives optional fresh-profile validation failure',async t=>{
 const x=await setup(t),account=randomUUID(),other=randomUUID(),oldTime=new Date(x.f.initialTime-1000).toISOString();
 // Another receiving client binds after this browser's unbound discovery.
 await discover(x);
 x.f.change(s=>{s.accounts.push({id:account,display_name:'Original owner',created_at:oldTime,spins:42});s.bindings.push({issuer:'https://pixel-pulse-websites.vercel.app/api/sso',subject:actorA,account_id:account,floor_epoch:1,created_at:oldTime});s.sessions.push({token_hash:hash('old'),issuer:'https://pixel-pulse-websites.vercel.app/api/sso',subject:actorA,account_id:account,signed_epoch:1,expires_at:new Date(x.f.now+120000).toISOString(),attempt_state_hash:hash('old attempt'),revoked_at:null});});
 const original=x.f.state.accounts[0];x.transport.setSyntheticActor({subject:actorA,credentialVersion:2});x.transport.setFault('profile');
 assert.equal(notice((await create(x)).response),'refused');assert.equal(x.f.state.bindings[0].floor_epoch,2);assert.notEqual(x.f.state.sessions[0].revoked_at,null);assert.deepEqual(x.f.state.accounts,[original]);assert.equal(x.transport.stats().sessionCookiePresent,false);
});
for(const mutation of ['policy','flow-generation','flow-target','flow-subject','flow-epoch','flow-end','discovery-subject','discovery-epoch','discovery-end'])test('final SQL transaction fence rolls back deferred modeled '+mutation+' corruption',async t=>{
 const options={};const x=await setup(t,options);await discover(x);const flow=await x.transport.beginCreate();const before=x.f.state;
 let mutated=false;options.onFlush=s=>{if(!s.accounts.length)return;mutated=true;const f=s.enrollmentFlows.find(f=>f.purpose==='create'),d=s.discoveries[0];if(mutation==='policy')s.enrollmentPolicy.generation=actorB;if(mutation==='flow-generation')f.generation=actorB;if(mutation==='flow-target')f.target_account_id=randomUUID();if(mutation==='flow-subject')f.subject=actorB;if(mutation==='flow-epoch')f.signed_epoch++;if(mutation==='flow-end')f.expires_at=new Date(x.f.now+600000).toISOString();if(mutation==='discovery-subject')d.subject=actorB;if(mutation==='discovery-epoch')d.signed_epoch++;if(mutation==='discovery-end')d.expires_at=new Date(x.f.now+600000).toISOString();};
 const response=await x.transport.complete(flow);assert.equal(mutated,true);assert.equal(notice(response),'uncertain');assert.equal(x.transport.stats().sessionCookiePresent,false);assert.equal(x.f.state.accounts.length,0);assert.equal(x.f.state.bindings.length,0);assert.equal(x.f.state.receipts.length,0);assert.equal(x.f.state.sessions.length,0);
 // One-use callback admission may be consumed, but no profile/ownership data changes.
 assert.deepEqual(x.f.state.accounts,before.accounts);
});
test('last enrollment clock fence after final reads and policy wait refuses an expired SQL result',async t=>{
 let active=false;const options={beforeQuery:c=>{if(active&&c.sql.startsWith('SELECT (clock_timestamp()>=')&&c.draft.accounts.length)c.advance(c.initialTime+300000);}};const x=await setup(t,options);await discover(x);const flow=await x.transport.beginCreate();active=true;
 assert.equal(notice(await x.transport.complete(flow)),'uncertain');assert.equal(x.f.state.accounts.length,0);assert.equal(x.transport.stats().sessionCookiePresent,false);
});
for(const problem of ['wrongEnrollmentHistory','badEnrollmentColumns','badEnrollmentConstraints'])test('unapproved/incomplete ongoing storage refuses before discovery writes: '+problem,async t=>{
 const x=await setup(t,{[problem]:true});await assert.rejects(x.transport.beginDiscovery());assert.equal(x.f.state.discoveries.length,0);assert.equal(x.f.state.enrollmentFlows.length,0);assert.equal(x.f.state.accounts.length,0);
});

test('first-click discovery of a known immutable owner returns its existing account without another Continue or Create',async t=>{
 const x=await setup(t);await discover(x);assert.equal(notice((await create(x)).response),'created');const original=structuredClone(x.f.state.accounts);const proofs=x.transport.stats().proof;await x.transport.signOut();
 const firstClick=await x.transport.beginDiscovery();assert.equal(notice(await x.transport.complete(firstClick)),'returned');assert.equal((await(await x.transport.session()).json()).authenticated,true);assert.deepEqual(x.f.state.accounts,original);assert.equal(x.transport.stats().proof,proofs);assert.equal(x.f.state.bindings.length,1);
});

test('an existing binding whose session mint refuses never falls through to a new discovery/Create choice',async t=>{const x=await setup(t);await discover(x);assert.equal(notice((await create(x)).response),'created');await x.transport.signOut();const before=structuredClone(x.f.state.accounts),discoveryCount=x.f.state.discoveries.length;t.mock.method(x.store,'issueBoundSession',async()=>null);const first=await x.transport.beginDiscovery();assert.equal(notice(await x.transport.complete(first)),'refused');assert.deepEqual(x.f.state.accounts,before);assert.equal(x.f.state.discoveries.length,discoveryCount);assert.equal(x.transport.stats().sessionCookiePresent,false);});
