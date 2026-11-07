import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationHandoff,validateRegistrationCorrespondence,registrationCli} from './ops/registration-handoff.mjs';
import {PIXEL_CALLBACK} from './server/pixel-oidc.mjs';

test('fixed registration handoff is disabled, exact canonical and contains no credentials or account mutation',()=>{
  const p=registrationHandoff();assert.equal(p.applied,false);assert.equal(p.providerDescriptor.disabled,true);
  assert.deepEqual(p.providerDescriptor.redirectUris,[PIXEL_CALLBACK]);assert.equal(p.credentialsIncluded,false);
  assert.equal(p.centralAdmission.signInEnabled,false);assert.equal(p.centralAdmission.linkConfirmationEnabled,false);
  assert.equal(p.proof.flowFields.length,9);assert.equal(p.proof.intent,'link');assert.equal(p.proof.nativeLink,false);
  assert.equal(p.sessions.refresh,false);assert.equal(p.sessions.maxSeconds,300);assert.equal(Object.isFrozen(p.providerDescriptor.redirectUris),true);
  assert.equal(validateRegistrationCorrespondence(structuredClone(p.providerDescriptor)).valid,true);
});
for(const patch of [{disabled:false},{redirectUris:['https://foreign.invalid/callback']},{redirectUris:[PIXEL_CALLBACK,'http://localhost:3000/callback']},
  {clientId:'skyway'},{tokenEndpointAuthMethod:'client_secret_post'},{clientSecret:'forbidden'},{requirePKCE:false},
  {grantTypes:['authorization_code','refresh_token']},{scopes:['openid','profile','email','offline_access']},
  {accountUrl:'https://unreviewed.invalid'},{linkConfirmationEnabled:true}])test('registration handoff rejects expanded or mismatched descriptor '+Object.keys(patch).join(','),()=>{
  assert.throws(()=>validateRegistrationCorrespondence({...structuredClone(registrationHandoff().providerDescriptor),...patch}),/refused/);
});
test('registration CLI has no apply, environment, live transport or implicit setup route',async()=>{
  assert.equal((await registrationCli([])).applied,false);
  await assert.rejects(registrationCli(['--apply']));await assert.rejects(registrationCli(['--plan','--apply']));
});
