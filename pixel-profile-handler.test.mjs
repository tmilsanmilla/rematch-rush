import test from 'node:test';
import assert from 'node:assert/strict';
import { createPixelHandler, SITE_ORIGIN, ATTEMPT_COOKIE, SESSION_COOKIE, hash } from './server/pixel-handler.mjs';
import { createOidcClient, PIXEL_ISSUER, PIXEL_CALLBACK } from './server/pixel-oidc.mjs';
import { freshFlowDigest } from './server/pixel-proof.mjs';
import { createRuntime, readFirstProfileAdmission } from './server/pixel-runtime.mjs';
import { createAcceptedIdentityMarker, readAcceptedIdentityFact } from './server/pixel-accepted-identity.mjs';

// Routing and lifecycle model only. Cryptography has separate injected-fetch
// tests; neither this memory store nor its transactions prove native SQL.
const path = '/api/auth/pixel-pulse';
const when = 1_800_000_000_000;
const cookieOf = (r, name) => r.headers.getSetCookie().find(v => v.startsWith(name + '='))?.split(';')[0];
function fixture({ enabled = true, failure, expiry = 240_000, exchangeDelay = 0, observeDelay = 0, proofDelay = 0, epoch = 3, known = false } = {}) {
  let now = when, release, proofEntered;
  const calls = [], attempts = new Map(), profiles = new Map(), sessions = new Map();
  const deviceSave = Object.freeze({ nickname: 'My guest', spins: 100, character: 'ice', wins: 12 });
  const initialSave = JSON.stringify(deviceSave);
  const identity = { issuer: PIXEL_ISSUER, subject: 'synthetic-first-profile', credentialVersion: epoch,
    identityExpiresAt: new Date(when + expiry).toISOString(), displayName: 'new pixel player' };
  const mark = createAcceptedIdentityMarker();
  const security = known ? { floor: 1, oldRevoked: false, preserved: 'original-owner-profile' } : null;
  const store = {
    async observeKnownBindingSecurity(handle) {
      calls.push('observe'); const fact = readAcceptedIdentityFact(handle); assert.ok(fact);
      if (failure === 'persistence') throw new Error('Synthetic security persistence failure');
      if (security && fact.issuer === identity.issuer && fact.subject === identity.subject && fact.credentialVersion > security.floor) {
        security.floor = fact.credentialVersion; security.oldRevoked = true;
      }
      now += observeDelay;
    },
    async checkReady() {}, async checkProfileReady() {},
    async createAttempt(a) { attempts.set(a.stateHash, { ...a }); },
    async createProfileAttempt(a) { calls.push('createAttempt'); attempts.set(a.stateHash, { ...a, profile: true }); },
    async consumeAttempt({ stateHash, browserHash }) {
      const a = attempts.get(stateHash);
      if (!a || a.browserHash !== browserHash || a.consumed || a.cancelled || Date.parse(a.expiresAt) <= now) return null;
      a.consumed = true; return a;
    },
    async getProfileAttempt({ stateHash, browserHash }) {
      const a = attempts.get(stateHash); return a?.profile && a.browserHash === browserHash ? { targetAccountId: a.targetAccountId, expectedSubject: a.expectedSubject, admissionExpiresAt: a.admissionExpiresAt } : null;
    },
    async createStandaloneProfile(a) {
      calls.push('createProfile');
      if (failure === 'unknown') throw new Error('COMMIT acknowledgment missing; synthetic secret');
      const attempt = attempts.get(a.stateHash);
      if (!attempt || !attempt.profile || !attempt.consumed || attempt.cancelled || attempt.completed ||
          a.browserHash !== attempt.browserHash || a.targetAccountId !== attempt.targetAccountId ||
          a.subject !== attempt.expectedSubject || Date.parse(a.admissionExpiresAt) <= now || Date.parse(a.admissionExpiresAt) > Date.parse(attempt.admissionExpiresAt) ||
          a.proof.flowHash !== a.expectedFlowHash || Date.parse(a.identityExpiresAt) <= now || Date.parse(a.proof.expiresAt) <= now ||
          profiles.has(a.subject)) return null;
      const profile = { accountId: a.targetAccountId, displayName: a.displayName, expiresAt: new Date(Math.min(now + 300_000, Date.parse(a.identityExpiresAt))).toISOString() };
      profiles.set(a.subject, profile); sessions.set(a.tokenHash, profile); attempt.completed = true;
      if (failure === 'late-response') now += 300_001;
      return profile;
    },
    async issueBoundSession(a) { calls.push('return'); return profiles.get(a.subject) || null; },
    async cancelAttempt({ stateHash, browserHash }) { const a = attempts.get(stateHash); if (a?.browserHash === browserHash) a.cancelled = true; },
    async revokeBrowser({ browserHash }) { for (const a of attempts.values()) if (a.browserHash === browserHash) a.cancelled = true; },
    async getSession({ tokenHash }) { return sessions.get(tokenHash) || null; },
    async revokeSession() {},
  };
  const authorization = createOidcClient({ fetchImpl: () => { throw new Error('External network forbidden'); } });
  const oidc = {
    authorizationUrl: a => authorization.authorizationUrl(a),
    async exchangeForProfile(options) {
      calls.push('exchangeProfile'); now += exchangeDelay;
      const acceptedIdentity = mark(identity);
      await options.onAcceptedIdentity?.(acceptedIdentity);
      if (failure === 'optional-profile') throw new Error('Invalid optional profile');
      return { identity, idToken: 'synthetic.id.token', acceptedIdentity };
    },
    async exchangeAndVerify() { calls.push('exchangeReturn'); return identity; },
  };
  const proofClient = {
    async redeem(a) {
      calls.push('proof'); now += proofDelay; assert.equal(a.subject, identity.subject); assert.equal(a.flow.pixel_intent, 'link');
      if (failure === 'proof') throw new Error('Invalid synthetic proof');
      if (failure === 'pause') { proofEntered?.(); await new Promise(resolve => { release = resolve; }); }
      return { issuer: identity.issuer, subject: identity.subject, credentialVersion: identity.credentialVersion,
        jti: '10000000-0000-4000-8000-000000000001', expiresAt: new Date(when + 30_000).toISOString(),
        flowHash: freshFlowDigest(a.flow), authTime: when / 1000, issuedAt: when / 1000 };
    },
  };
  const admission = { subject: identity.subject, notBeforeMs: when, expiresAt: new Date(when + 300_000).toISOString() };
  const handle = createPixelHandler({ clock: () => now, getDependencies: () => ({ store, oidc, proofClient, firstProfilesEnabled: enabled, firstProfileAdmission: admission }) });
  const request = (route, { method = 'GET', body, cookie, headers = {} } = {}) => new Request(SITE_ORIGIN + route, { method,
    headers: { ...(body === undefined ? {} : { origin: SITE_ORIGIN, 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const post = (name, body, cookie) => handle(request(path + '/' + name, { method: 'POST', body, cookie }));
  async function begin() {
    const response = await post('create', { intent: 'create', acknowledgeSeparateProfile: true });
    assert.equal(response.status, 200); const url = new URL((await response.json()).url);
    return { url, state: url.searchParams.get('state'), cookie: cookieOf(response, ATTEMPT_COOKIE) };
  }
  const finish = (a, ticket = 't'.repeat(43), extra = '') => handle(request(`/api/auth/callback/pixel-pulse?state=${a.state}&code=synthetic-code&iss=${PIXEL_ISSUER}${ticket === null ? '' : '&pixel_link_ticket=' + ticket}${extra}`, { cookie: a.cookie }));
  return { handle, request, post, begin, finish, calls, attempts, profiles, sessions, identity, admission, deviceSave, initialSave, security, store, oidc, proofClient,
    pause: () => new Promise(resolve => { proofEntered = resolve; }), release: () => release(), advance: ms => { now += ms; }, setEnabled: value => { enabled = value; } };
}

test('first profiles stay default OFF even when returning sign-in is available', async () => {
  const f = fixture({ enabled: false });
  const r = await f.post('create', { intent: 'create', acknowledgeSeparateProfile: true });
  assert.equal(r.status, 503); assert.equal(f.attempts.size, 0); assert.deepEqual(f.calls, []);
  assert.equal((await (await f.handle(f.request(path + '/session'))).json()).firstConnections, false);
});
test('creation requires an explicit separate-profile acknowledgment and rejects browser identity/progress fields', async () => {
  const f = fixture();
  for (const body of [{}, { intent: 'create' }, { intent: 'link', acknowledgeSeparateProfile: true },
    { intent: 'create', acknowledgeSeparateProfile: false }, { intent: 'create', acknowledgeSeparateProfile: true, email: 'guest@example.invalid' },
    { intent: 'create', acknowledgeSeparateProfile: true, progress: { wins: 99 } }]) {
    assert.equal((await f.post('create', body)).status, 400);
  }
  assert.equal(f.attempts.size, 0);
});
test('explicit creation seals a server UUID and exact fixed fresh-password authorization flow', async () => {
  const f = fixture(), a = await f.begin();
  assert.equal(a.url.searchParams.get('pixel_intent'), 'link');
  assert.equal(a.url.searchParams.get('client_id'), 'rematch-rush');
  assert.equal(a.url.searchParams.get('redirect_uri'), PIXEL_CALLBACK);
  assert.equal(a.url.searchParams.size, 9);
  const saved = f.attempts.get(hash(a.state)); assert.match(saved.targetAccountId, /^[a-f0-9-]{36}$/);
  assert.equal(JSON.stringify(f.deviceSave), f.initialSave);
});
test('fresh proof creates one standalone profile and a bounded cookie; replay never exchanges or creates again', async () => {
  const f = fixture(), a = await f.begin(), r = await f.finish(a);
  assert.equal(r.headers.get('location'), SITE_ORIGIN + '/?pixel=created');
  const c = r.headers.getSetCookie().find(v => v.startsWith(SESSION_COOKIE + '='));
  assert.match(c, /Secure; HttpOnly; SameSite=Lax; Max-Age=240/);
  assert.equal(f.profiles.size, 1); assert.equal(f.sessions.size, 1);
  assert.equal(JSON.stringify(f.deviceSave), f.initialSave);
  const count = f.calls.length; await f.finish(a); assert.equal(f.calls.length, count);
});
for (const ticket of [null, '', 'bad', 't'.repeat(44)]) test('missing or malformed fresh proof ticket cannot create: ' + String(ticket), async () => {
  const f = fixture(), a = await f.begin(), r = await f.finish(a, ticket);
  assert.equal(r.headers.get('location'), SITE_ORIGIN + '/?pixel=refused');
  assert.equal(f.profiles.size, 0); assert.equal(f.calls.includes('exchangeProfile'), false);
});
test('unverified proof never reaches profile storage and response discloses no provider detail', async () => {
  const f = fixture({ failure: 'proof' }), a = await f.begin(), r = await f.finish(a);
  assert.equal(f.calls.includes('createProfile'), false); assert.equal(r.headers.get('location'), SITE_ORIGIN + '/?pixel=refused');
  assert.equal(r.headers.get('set-cookie').includes('synthetic secret'), false);
});
test('persisted creation purpose cannot fall back to ordinary return after gate closure or child-row loss', async () => {
  for (const missing of ['gate', 'child']) {
    const f = fixture(), a = await f.begin();
    f.profiles.set('synthetic-first-profile', { accountId: '10000000-0000-4000-8000-000000000002', displayName: 'Existing' });
    if (missing === 'gate') f.setEnabled(false);
    else f.attempts.get(hash(a.state)).profile = false;
    const r = await f.finish(a, null);
    assert.equal(r.headers.get('location'), SITE_ORIGIN + '/?pixel=refused');
    assert.equal(f.calls.includes('exchangeReturn'), false); assert.equal(f.calls.includes('exchangeProfile'), false);
    assert.equal(cookieOf(r, SESSION_COOKIE), undefined);
  }
});
test('unknown COMMIT acknowledgment and expired response do not promise unchanged data or invite creation replay', async () => {
  for (const failure of ['unknown', 'late-response']) {
    const f = fixture({ failure }), a = await f.begin(), r = await f.finish(a);
    assert.equal(r.headers.get('location'), SITE_ORIGIN + '/?pixel=uncertain');
    assert.equal(cookieOf(r, SESSION_COOKIE), undefined);
  }
});
test('cancellation during proof redemption prevents the pending profile and session', async () => {
  const f = fixture({ failure: 'pause' }), a = await f.begin(), entered = f.pause(), pending = f.finish(a);
  await entered; await f.post('cancel', { state: a.state }, a.cookie); f.release(); const r = await pending;
  assert.equal(f.profiles.size, 0); assert.equal(f.sessions.size, 0); assert.equal(cookieOf(r, SESSION_COOKIE), undefined);
});
test('ordinary unknown sign-in never silently creates, and a fresh ticket cannot enter its return branch', async () => {
  const f = fixture();
  const r = await f.post('start', {}), url = new URL((await r.json()).url);
  assert.equal(url.searchParams.has('pixel_intent'), false);
  const a = { state: url.searchParams.get('state'), cookie: cookieOf(r, ATTEMPT_COOKIE) };
  const denied = await f.finish(a);
  assert.equal(denied.headers.get('location'), SITE_ORIGIN + '/?pixel=refused'); assert.equal(f.profiles.size, 0);
});
test('runtime does not construct fresh proof or storage without all explicit approvals and first history', async () => {
  let made = 0; const forbidden = () => { made++; throw new Error('No resource'); };
  for (const env of [{}, { REMATCH_PIXEL_FIRST_PROFILE_ENABLED: 'true', REMATCH_PIXEL_FRESH_PROOF_APPROVED: 'true' }]) {
    const runtime = createRuntime(env, { makeStore: forbidden, makeOidc: forbidden, makeProof: forbidden });
    assert.equal((await runtime.handle(new Request(SITE_ORIGIN + path + '/session'))).status, 200);
  }
  assert.equal(made, 0);
});
test('first-profile admission requires one exact server actor and a finite non-extendable five-minute descriptor', () => {
  const env = { REMATCH_PIXEL_FIRST_PROFILE_SUBJECT: 'synthetic-only', REMATCH_PIXEL_FIRST_PROFILE_STARTS_AT: new Date(when).toISOString(), REMATCH_PIXEL_FIRST_PROFILE_ENDS_AT: new Date(when + 300_000).toISOString() };
  assert.equal(Object.isFrozen(readFirstProfileAdmission(env)), true);
  for (const patch of [{ REMATCH_PIXEL_FIRST_PROFILE_SUBJECT: '' }, { REMATCH_PIXEL_FIRST_PROFILE_ENDS_AT: new Date(when + 300_001).toISOString() },
    { REMATCH_PIXEL_FIRST_PROFILE_STARTS_AT: 'tomorrow' }, { REMATCH_PIXEL_FIRST_PROFILE_ENDS_AT: new Date(when).toISOString() }]) assert.throws(() => readFirstProfileAdmission({ ...env, ...patch }));
});
test('wrong admitted subject refuses before proof redemption, and a closed window refuses new starts', async () => {
  const f = fixture(), a = await f.begin(); f.identity.subject = 'different-identity';
  const r = await f.finish(a); assert.equal(r.headers.get('location'), SITE_ORIGIN + '/?pixel=refused');
  assert.equal(f.calls.includes('proof'), false); assert.equal(f.profiles.size, 0);
  f.advance(300_000); assert.equal((await f.post('create', { intent: 'create', acknowledgeSeparateProfile: true })).status, 503);
});

for (const failure of ['proof', 'optional-profile']) test('trusted higher epoch retirement precedes optional Create refusal: ' + failure, async () => {
  const f = fixture({ known: true, epoch: 2, failure }), a = await f.begin();
  const original = { accountId: '10000000-0000-4000-8000-000000000002', displayName: 'Original profile', spins: 77 };
  f.profiles.set(f.identity.subject, original);
  const r = await f.finish(a);
  assert.equal(f.security.floor, 2); assert.equal(f.security.oldRevoked, true);
  assert.equal(f.security.preserved, 'original-owner-profile');
  assert.equal(f.profiles.get(f.identity.subject), original); assert.equal(f.sessions.size, 0);
  assert.equal(f.calls.includes('createProfile'), false); assert.equal(cookieOf(r, SESSION_COOKIE), undefined);
  assert.equal(r.headers.get('location'), SITE_ORIGIN + '/?pixel=refused');
});
test('security persistence failure refuses before proof or Create and never emits a session cookie', async () => {
  const f = fixture({ known: true, epoch: 2, failure: 'persistence' }), a = await f.begin(), r = await f.finish(a);
  assert.equal(f.security.floor, 1); assert.equal(f.security.oldRevoked, false);
  assert.equal(f.calls.includes('proof'), false); assert.equal(f.calls.includes('createProfile'), false);
  assert.equal(f.sessions.size, 0); assert.equal(cookieOf(r, SESSION_COOKIE), undefined);
});
test('original stored admission cutoff denies late exchange despite a newer same-subject window', async () => {
  const f = fixture({ expiry: 600_000, exchangeDelay: 2_000, epoch: 2, known: true }), a = await f.begin();
  f.advance(299_000); f.admission.notBeforeMs = when + 100_000; f.admission.expiresAt = new Date(when + 400_000).toISOString();
  const r = await f.finish(a);
  assert.equal(f.calls.includes('exchangeProfile'), true); assert.equal(f.calls.includes('proof'), false);
  assert.equal(f.security.floor, 2); assert.equal(f.security.oldRevoked, true);
  assert.equal(f.profiles.size, 0); assert.equal(f.sessions.size, 0); assert.equal(cookieOf(r, SESSION_COOKIE), undefined);
});
test('deadline reached during independent retirement cannot start a late proof request', async () => {
  const f = fixture({ expiry: 600_000, observeDelay: 2_000, epoch: 2, known: true }), a = await f.begin();
  f.advance(299_000);
  const r = await f.finish(a);
  assert.equal(f.security.floor, 2); assert.equal(f.security.oldRevoked, true);
  assert.equal(f.calls.includes('proof'), false); assert.equal(f.calls.includes('createProfile'), false);
  assert.equal(cookieOf(r, SESSION_COOKIE), undefined);
});
test('deadline reached in proof redemption refuses before storage and cannot extend original flow', async () => {
  const f = fixture({ expiry: 600_000, proofDelay: 2_000 }), a = await f.begin();
  f.advance(299_000); f.admission.notBeforeMs = when + 100_000; f.admission.expiresAt = new Date(when + 400_000).toISOString();
  const r = await f.finish(a);
  assert.equal(f.calls.includes('proof'), true); assert.equal(f.calls.includes('createProfile'), false);
  assert.equal(f.profiles.size, 0); assert.equal(f.sessions.size, 0); assert.equal(cookieOf(r, SESSION_COOKIE), undefined);
});

test('a shortened current admission after proof clamps the actual storage input', async () => {
  const f = fixture(), a = await f.begin(); f.advance(20_000);
  const redeem = f.proofClient.redeem, createProfile = f.store.createStandaloneProfile; let storedEnd;
  f.proofClient.redeem = async input => { const proof = await redeem(input); f.admission.expiresAt = new Date(when + 25_000).toISOString(); return proof; };
  f.store.createStandaloneProfile = async input => { storedEnd = input.admissionExpiresAt; return createProfile(input); };
  const r = await f.finish(a);
  assert.equal(storedEnd, new Date(when + 25_000).toISOString());
  assert.equal(r.headers.get('location'), SITE_ORIGIN + '/?pixel=created');
});
test('an injected profile response with raw JSON instead of the accepted private handle cannot request proof or mint', async () => {
  const f = fixture(), a = await f.begin();
  f.oidc.exchangeForProfile = async () => ({ identity: f.identity, idToken: 'synthetic.id.token', acceptedIdentity: { issuer: PIXEL_ISSUER, subject: f.identity.subject, credentialVersion: 3 } });
  const r = await f.finish(a);
  assert.equal(f.calls.includes('proof'), false); assert.equal(f.calls.includes('createProfile'), false);
  assert.equal(f.profiles.size, 0); assert.equal(f.sessions.size, 0); assert.equal(cookieOf(r, SESSION_COOKIE), undefined);
});
