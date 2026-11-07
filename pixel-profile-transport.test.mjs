import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticProfileTransport} from './test/support/pixel-profile-transport.mjs';
import {readAcceptedIdentityFact} from './server/pixel-accepted-identity.mjs';

// This model tests the actual handler+JOSE+proof transport, not SQL behavior.
function memoryStore(){
  const attempts=new Map(),profiles=new Map(),sessions=new Map(),observed=[];
  let creations=0;
  return {observed,profiles,sessions,get creations(){return creations;},
    async checkReady(){return true;},async checkProfileReady(){return true;},
    async createAttempt(a){attempts.set(a.stateHash,{...a});},
    async createProfileAttempt(a){attempts.set(a.stateHash,{...a,profile:true});},
    async consumeAttempt(a){const v=attempts.get(a.stateHash);if(!v||v.browserHash!==a.browserHash||v.used||v.cancelled)return null;v.used=true;return {...v};},
    async getProfileAttempt(a){const v=attempts.get(a.stateHash);return v?.profile?{...v}:null;},
    async observeKnownBindingSecurity(handle){const fact=readAcceptedIdentityFact(handle);assert.ok(fact);observed.push(fact);},
    async createStandaloneProfile(a){
      creations++;assert.deepEqual(readAcceptedIdentityFact(a.acceptedIdentity),{issuer:a.issuer,subject:a.subject,credentialVersion:a.credentialVersion});
      assert.equal(a.proof.subject,a.subject);assert.equal(a.proof.flowHash,a.expectedFlowHash);
      assert.ok(!profiles.has(a.subject));const v={accountId:a.targetAccountId,displayName:a.displayName,expiresAt:a.identityExpiresAt,subject:a.subject,epoch:a.credentialVersion};
      profiles.set(a.subject,v);sessions.set(a.tokenHash,v);return v;
    },
    async issueBoundSession(a){const p=profiles.get(a.subject);if(!p)return null;const v={...p,expiresAt:a.identityExpiresAt};sessions.set(a.tokenHash,v);return v;},
    async getSession(a){return sessions.get(a.tokenHash)||null;},
    async revokeBrowser(a){if(a.tokenHash)sessions.delete(a.tokenHash);for(const v of attempts.values())if(v.browserHash===a.browserHash)v.cancelled=true;},
    async revokeSession(a){sessions.delete(a.tokenHash);}
  };
}

test('in-process transport runs actual Create, signature/proof validation, reload, signout and bound return',async()=>{
  const store=memoryStore(),transport=await createSyntheticProfileTransport({store});
  const first=await transport.beginCreate(),created=await transport.complete(first);
  assert.equal(created.status,303);assert.equal(new URL(created.headers.get('location')).searchParams.get('pixel'),'created');
  assert.equal(store.creations,1);assert.equal(store.profiles.size,1);assert.ok(store.observed.length);
  assert.equal((await (await transport.session()).json()).authenticated,true);
  await transport.signOut();assert.equal((await (await transport.session()).json()).authenticated,false);
  const returning=await transport.beginReturn(),response=await transport.complete(returning);
  assert.equal(new URL(response.headers.get('location')).searchParams.get('pixel'),'returned');
  assert.equal((await (await transport.session()).json()).authenticated,true);assert.equal(store.creations,1);
  const before=transport.stats(),replay=await transport.replay(first);
  assert.equal(new URL(replay.headers.get('location')).searchParams.get('pixel'),'refused');
  assert.equal(transport.stats().exchange,before.exchange);assert.equal(transport.stats().proof,1);
});
for(const fault of ['signature','profile','proof-flow'])test('real verifiers reject synthetic transport fault without profile/session: '+fault,async()=>{
  const store=memoryStore(),transport=await createSyntheticProfileTransport({store});transport.setFault(fault);
  const a=await transport.beginCreate(),r=await transport.complete(a);
  assert.equal(new URL(r.headers.get('location')).searchParams.get('pixel'),'refused');
  assert.equal(store.creations,0);assert.equal(store.profiles.size,0);assert.equal(store.sessions.size,0);
  assert.equal(transport.stats().sessionCookiePresent,false);
  assert.equal(store.observed.length,fault==='signature'?0:1);
});
test('synthetic transport accepts no live subject or forged browser authorization handle',async()=>{
  await assert.rejects(createSyntheticProfileTransport({store:memoryStore(),subject:'real-person'}));
  const transport=await createSyntheticProfileTransport({store:memoryStore()});
  await assert.rejects(transport.complete({}));
  assert.deepEqual(transport.stats(),{authorize:0,exchange:0,proof:0,userInfo:0,sessionCookiePresent:false});
});
