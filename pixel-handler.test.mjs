import test from 'node:test';
import assert from 'node:assert/strict';
import { createPixelHandler, SITE_ORIGIN, SESSION_COOKIE, ATTEMPT_COOKIE, hash } from './server/pixel-handler.mjs';
import { createRuntime, servePixelRequest } from './server/pixel-runtime.mjs';
import { createOidcClient, PIXEL_ISSUER, PIXEL_CALLBACK } from './server/pixel-oidc.mjs';

// SYNTHETIC OFFLINE ROUTING PROOF ONLY. This in-memory store is deliberately not
// evidence of a real identity, PostgreSQL preservation/atomicity, registration or login.
// No fetch, socket, mailbox, browser account, remote database or provider is used.
const baseTime = 1_800_000_000_000;
const prefix = '/api/auth/pixel-pulse';
const callbackPath = '/api/auth/callback/pixel-pulse';
const tokenValue = 't'.repeat(43);
const browserValue = 'b'.repeat(43);
const secretError = 'password=synthetic-secret authorization_code=synthetic-code SQL email=synthetic@example.invalid';

function request(path, { method = 'GET', body, headers = {}, cookie } = {}) {
  return new Request(`${SITE_ORIGIN}${path}`, {
    method, headers: { ...(body === undefined ? {} : { origin: SITE_ORIGIN, 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
const post = (path, options = {}) => request(`${prefix}/${path}`, { method: 'POST', body: {}, ...options });
const cookies = response => response.headers.getSetCookie();
const cookieValue = (response, name) => {
  const value = cookies(response).find(part => part.startsWith(`${name}=`));
  return value?.slice(name.length + 1).split(';')[0];
};
const cookieHeader = (name, value) => `${name}=${value}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness({ identityPatch = {}, unknown = false, savedPatch, attemptPatch, failures = {} } = {}) {
  let now = baseTime;
  const calls = [];
  const attempts = new Map(), sessions = new Map();
  const native = { id: '10000000-0000-4000-8000-000000000001', displayName: 'Original player', progress: { wins: 7, item: 'ice' }, role: 'player' };
  const originalNative = structuredClone(native);
  const binding = { issuer: PIXEL_ISSUER, subject: 'synthetic-bound-subject', accountId: native.id, epoch: 3 };
  const originalBinding = structuredClone(binding);
  const identity = { issuer: PIXEL_ISSUER, subject: unknown ? 'synthetic-unknown-subject' : binding.subject,
    credentialVersion: 3, identityExpiresAt: new Date(baseTime + 240_000).toISOString(), ...identityPatch };
  const record = (name, args) => {
    calls.push({ name, args });
    if (failures[name]) throw new Error(secretError);
  };
  const store = {
    async checkReady() { record('checkReady'); },
    async createAttempt(args) { record('createAttempt', structuredClone(args)); attempts.set(args.stateHash, { ...args, consumed: false }); },
    async consumeAttempt(args) {
      record('consumeAttempt', args);
      const attempt = attempts.get(args.stateHash);
      if (!attempt || attempt.consumed || attempt.cancelled || attempt.completed || attempt.browserHash !== args.browserHash || Date.parse(attempt.expiresAt) <= now) return null;
      attempt.consumed = true;
      return { ...attempt, ...attemptPatch };
    },
    async cancelAttempt(args) {
      record('cancelAttempt', args);
      const attempt = attempts.get(args.stateHash);
      if (attempt?.browserHash === args.browserHash) {
        attempt.cancelled = true;
        for (const saved of sessions.values()) if (saved.stateHash === args.stateHash && saved.browserHash === args.browserHash) saved.revoked = true;
      }
    },
    async issueBoundSession(args) {
      record('issueBoundSession', args);
      // Synthetic model of the separately committed security observation. It
      // does not establish PostgreSQL transaction/locking behavior.
      if (args.issuer !== binding.issuer || args.subject !== binding.subject || args.credentialVersion < binding.epoch) return null;
      if (args.credentialVersion > binding.epoch) {
        binding.epoch = args.credentialVersion;
        for (const saved of sessions.values()) if (saved.epoch < binding.epoch) saved.revoked = true;
      }
      const attempt = attempts.get(args.stateHash);
      if (!attempt || attempt.browserHash !== args.browserHash || !attempt.consumed || attempt.cancelled || attempt.completed || Date.parse(attempt.expiresAt) <= now || Date.parse(args.identityExpiresAt) <= now) return null;
      const saved = { accountId: native.id, displayName: native.displayName, epoch: binding.epoch, stateHash: args.stateHash, browserHash: args.browserHash,
        expiresAt: new Date(Math.min(now + 300_000, Date.parse(args.identityExpiresAt))).toISOString(), ...savedPatch };
      attempt.completed = true;
      sessions.set(args.tokenHash, saved);
      return saved;
    },
    async getSession(args) { record('getSession', args); const saved = sessions.get(args.tokenHash); return saved && !saved.revoked && saved.epoch === binding.epoch && Date.parse(saved.expiresAt) > now ? saved : null; },
    async revokeSession(args) { record('revokeSession', args); const saved = sessions.get(args.tokenHash); if (saved) saved.revoked = true; },
    async revokeBrowser(args) {
      record('revokeBrowser', args);
      const browserHashes = new Set(args.browserHash ? [args.browserHash] : []);
      const saved = sessions.get(args.tokenHash);
      if (saved) { saved.revoked = true; if (saved.browserHash) browserHashes.add(saved.browserHash); }
      for (const attempt of attempts.values()) if (browserHashes.has(attempt.browserHash)) attempt.cancelled = true;
      for (const session of sessions.values()) if (browserHashes.has(session.browserHash)) session.revoked = true;
    },
    async close() { record('close'); },
  };
  const authorize = createOidcClient({ fetchImpl: () => { throw new Error('Provider network forbidden.'); } });
  const oidc = {
    authorizationUrl(args) { record('authorizationUrl', args); return authorize.authorizationUrl(args); },
    async exchangeAndVerify(args) { record('exchangeAndVerify', args); return Object.freeze({ ...identity }); },
  };
  const handle = createPixelHandler({ getDependencies: () => ({ store, oidc }), clock: () => now });
  async function begin({ cookie } = {}) {
    const response = await handle(post('start', { cookie }));
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).url);
    const state = url.searchParams.get('state');
    const browser = cookieValue(response, ATTEMPT_COOKIE);
    return { response, url, state, browser, cookie: cookieHeader(ATTEMPT_COOKIE, browser) };
  }
  async function finish(start, search = '') {
    return handle(request(`${callbackPath}?code=synthetic-code&state=${start.state}${search}`, { cookie: start.cookie }));
  }
  return { handle, store, oidc, begin, finish, calls, attempts, sessions, identity, native, originalNative, binding, originalBinding,
    setNow(value) { now = value; } };
}

function assertCommonHeaders(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('vary'), 'Cookie');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
}
function assertRefused(response) {
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `${SITE_ORIGIN}/?pixel=refused`);
  assert.equal(cookies(response).some(value => value.startsWith(`${SESSION_COOKIE}=`) && !value.includes('Max-Age=0')), false);
  assertCommonHeaders(response);
}

test('default-OFF runtime returns unavailable without constructing storage/OIDC or doing network', async () => {
  let constructed = 0;
  const forbidden = () => { constructed++; throw new Error('No resource is allowed.'); };
  const runtime = createRuntime({}, { makeStore: forbidden, makeOidc: forbidden });
  const response = await runtime.handle(request(`${prefix}/session`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: false, authenticated: false, firstConnections: false });
  for (const req of [post('start'), post('sign-out'), post('cancel', { body: { state: 's'.repeat(43) } }), request(`${callbackPath}?state=${'s'.repeat(43)}&code=code`)]) {
    const result = await runtime.handle(req);
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: 'unavailable' });
    assertCommonHeaders(result);
  }
  await runtime.close();
  assert.equal(constructed, 0);
});

test('enabled without both registration/target approvals and exact target pins stays closed before constructors', async (t) => {
  const flags = { REMATCH_PIXEL_SIGNIN_ENABLED: 'true', REMATCH_PIXEL_CLIENT_REGISTRATION_APPROVED: 'true' };
  for (const [name, env] of Object.entries({
    'missing registration': { REMATCH_PIXEL_SIGNIN_ENABLED: 'true' },
    'missing target approval': flags,
    'missing URL and pins': { ...flags, REMATCH_PIXEL_TARGET_APPROVED: 'true' },
    'ambient DATABASE_URL is not authority': { ...flags, DATABASE_URL: 'postgres://unrelated.invalid/another_game' },
    'truthy strings are not approval': { REMATCH_PIXEL_SIGNIN_ENABLED: '1', REMATCH_PIXEL_CLIENT_REGISTRATION_APPROVED: 'true' },
  })) await t.test(name, async () => {
    let constructed = 0;
    const runtime = createRuntime(env, { makeStore: () => { constructed++; throw new Error('forbidden'); }, makeOidc: () => { constructed++; throw new Error('forbidden'); } });
    const response = await runtime.handle(post('start'));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'unavailable' });
    assert.equal(constructed, 0);
    await runtime.close();
  });
});

test('fully pinned synthetic runtime reuses only its injected adapter and immediately honors disabled approval', async () => {
  // Reserved .invalid hostname is never contacted: both factories are injected.
  const env = { REMATCH_PIXEL_SIGNIN_ENABLED: 'true', REMATCH_PIXEL_CLIENT_REGISTRATION_APPROVED: 'true',
    REMATCH_PIXEL_TARGET_APPROVED: 'true', REMATCH_PIXEL_DATABASE_URL: 'postgres://synthetic_receiver:unused@synthetic.invalid:5432/synthetic_rematch',
    REMATCH_PIXEL_APPROVED_HOST: 'synthetic.invalid', REMATCH_PIXEL_APPROVED_PORT: '5432', REMATCH_PIXEL_APPROVED_DATABASE: 'synthetic_rematch',
    REMATCH_PIXEL_APPROVED_ROLE: 'synthetic_receiver', REMATCH_PIXEL_APPROVED_HISTORY: '0'.repeat(64) };
  let stores = 0, clients = 0, ready = 0, closed = 0;
  const runtime = createRuntime(env, {
    makeStore(config) {
      stores++;
      assert.equal(config.pins.database, 'synthetic_rematch');
      assert.equal(config.pins.role, 'synthetic_receiver');
      return { async checkReady() { ready++; }, async close() { closed++; } };
    },
    makeOidc(config) { clients++; assert.deepEqual(config, {}); return {}; },
  });
  for (let index = 0; index < 2; index++) assert.deepEqual(await (await runtime.handle(request(`${prefix}/session`))).json(), { available: true, authenticated: false, firstConnections: false });
  assert.equal(stores, 1); assert.equal(clients, 1); assert.equal(ready, 2);
  env.REMATCH_PIXEL_CLIENT_REGISTRATION_APPROVED = 'false';
  assert.equal((await (await runtime.handle(request(`${prefix}/session`))).json()).available, false);
  assert.equal(ready, 2);
  await runtime.close();
  assert.equal(closed, 1);
});

test('HTTP methods, unknown paths and extra query parameters fail before dependencies', async (t) => {
  let dependencies = 0;
  const handle = createPixelHandler({ getDependencies: () => { dependencies++; throw new Error('forbidden'); } });
  for (const [path, options, expected] of [
    ['/unknown', {}, 404], [`${prefix}/session`, { method: 'POST', body: {} }, 405],
    [`${prefix}/start`, {}, 405], [`${prefix}/sign-out`, {}, 405], [callbackPath, { method: 'POST', body: {} }, 405],
    [`${prefix}/session?intent=create`, {}, 400], [`${prefix}/start?intent=link`, { method: 'POST', body: {} }, 400],
  ]) await t.test(`${options.method || 'GET'} ${path}`, async () => assert.equal((await handle(request(path, options))).status, expected));
  assert.equal(dependencies, 0);
});

test('state-changing endpoints reject cross-origin, invalid/massive bodies and all adoption/creation intent', async (t) => {
  let dependencies = 0;
  const handle = createPixelHandler({ getDependencies: () => { dependencies++; throw new Error('forbidden'); } });
  const variations = {
    'other origin': { headers: { origin: 'https://other.invalid' } },
    'missing origin': { headers: { origin: '' } }, 'opaque origin': { headers: { origin: 'null' } },
    'cross-site fetch': { headers: { 'sec-fetch-site': 'cross-site' } },
    'wrong media type': { headers: { 'content-type': 'text/plain' } },
    'form submission': { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'intent=link' },
    'array': { body: [] }, 'null': { body: 'null' }, 'bad JSON': { body: '{' },
    'oversized header': { headers: { 'content-length': '1025' } }, 'non-numeric length': { headers: { 'content-length': 'bad' } },
    'oversized streamed body': { body: JSON.stringify({ value: 'x'.repeat(1025) }) },
    'link intent': { body: { intent: 'link' } }, 'create intent': { body: { intent: 'create' } },
    'browser identity': { body: { subject: 'synthetic-bound-subject' } }, 'guest progress': { body: { profile: { wins: 7 } } },
  };
  for (const [name, options] of Object.entries(variations)) await t.test(name, async () => {
    assert.equal((await handle(post('start', options))).status, 400);
    assert.equal((await handle(post('sign-out', options))).status, 400);
  });
  assert.equal(dependencies, 0);
});

test('start stores only hash-bound one-use flow and fixed code/S256 ordinary return URL', async () => {
  const h = harness();
  const start = await h.begin();
  assert.equal(start.url.origin + start.url.pathname, `${PIXEL_ISSUER}/oauth2/authorize`);
  assert.equal(start.url.searchParams.get('client_id'), 'rematch-rush');
  assert.equal(start.url.searchParams.get('redirect_uri'), PIXEL_CALLBACK);
  assert.equal(start.url.searchParams.get('response_type'), 'code');
  assert.equal(start.url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(start.url.searchParams.get('scope'), 'openid profile email');
  assert.equal(start.url.searchParams.has('pixel_intent'), false);
  const saved = h.calls.find(call => call.name === 'createAttempt').args;
  assert.equal(saved.stateHash, hash(start.state));
  assert.equal(saved.browserHash, hash(start.browser));
  assert.notEqual(saved.stateHash, start.state);
  assert.notEqual(saved.browserHash, start.browser);
  assert.equal(Date.parse(saved.expiresAt), baseTime + 300_000);
  assert.equal(saved.redirectUri, PIXEL_CALLBACK);
  assert.equal(saved.nonce, start.url.searchParams.get('nonce'));
  assert.match(start.response.headers.get('set-cookie'), /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=300$/);
  assert.equal(h.calls.some(call => call.name === 'exchangeAndVerify' || call.name === 'issueBoundSession'), false);
  assertCommonHeaders(start.response);
});

test('start reuses a valid browser secret across new one-use states so signout can cancel both', async () => {
  const h = harness(), first = await h.begin(), second = await h.begin({ cookie: first.cookie });
  assert.equal(second.browser, first.browser);
  assert.notEqual(second.state, first.state);
  const signedOut = await h.handle(post('sign-out', { cookie: second.cookie }));
  assert.equal(signedOut.status, 200);
  const revoke = h.calls.find(call => call.name === 'revokeBrowser');
  assert.deepEqual(revoke.args, { browserHash: hash(first.browser) });
  assertRefused(await h.finish(first));
  assertRefused(await h.finish(second));
  assert.equal(h.calls.some(call => call.name === 'exchangeAndVerify'), false);
});

test('synthetic bound return preserves original account/progress/roles and stores opaque token hash only', async () => {
  const h = harness();
  const start = await h.begin(), response = await h.finish(start);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), `${SITE_ORIGIN}/?pixel=returned`);
  const token = cookieValue(response, SESSION_COOKIE);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const issued = h.calls.find(call => call.name === 'issueBoundSession').args;
  assert.deepEqual(Object.keys(issued).sort(), ['browserHash', 'credentialVersion', 'identityExpiresAt', 'issuer', 'stateHash', 'subject', 'tokenHash']);
  assert.equal(issued.tokenHash, hash(token));
  assert.equal(issued.stateHash, hash(start.state));
  assert.equal(issued.browserHash, hash(start.browser));
  assert.notEqual(issued.tokenHash, token);
  const sessionCookie = cookies(response).find(value => value.startsWith(`${SESSION_COOKIE}=`));
  assert.match(sessionCookie, /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=240; Expires=/);
  assert.equal(sessionCookie.includes('Domain='), false);
  assert.equal(new Date(sessionCookie.split('Expires=')[1]).getTime(), Date.parse(h.identity.identityExpiresAt));
  assert.deepEqual(h.native, h.originalNative);
  assert.deepEqual(h.binding, h.originalBinding);
  const sessionResponse = await h.handle(request(`${prefix}/session`, { cookie: cookieHeader(SESSION_COOKIE, token) }));
  assert.deepEqual(await sessionResponse.json(), { available: true, authenticated: true, firstConnections: false,
    profile: { displayName: 'Original player' }, sessionExpiresAt: h.identity.identityExpiresAt });
  assert.equal(cookies(sessionResponse).length, 0);
  assertCommonHeaders(sessionResponse);
});

test('unknown immutable identity is generically refused without account/binding creation', async () => {
  const h = harness({ unknown: true });
  assertRefused(await h.finish(await h.begin()));
  assert.equal(h.sessions.size, 0);
  assert.deepEqual(h.native, h.originalNative);
  assert.deepEqual(h.binding, h.originalBinding);
  const issue = h.calls.find(call => call.name === 'issueBoundSession');
  assert.equal(issue.args.subject, 'synthetic-unknown-subject');
  assert.equal('email' in issue.args, false);
});

test('callback consumes exact browser/state once; reload, replacement and expired attempts cannot exchange again', async (t) => {
  const h = harness();
  const start = await h.begin();
  assertRefused(await h.finish({ ...start, cookie: cookieHeader(ATTEMPT_COOKIE, browserValue) }));
  assert.equal(h.calls.some(call => call.name === 'exchangeAndVerify'), false);
  assertRefused(await h.finish({ ...start, state: 's'.repeat(43) }));
  assert.equal((await h.finish(start)).headers.get('location'), `${SITE_ORIGIN}/?pixel=returned`);
  assertRefused(await h.finish(start));
  assert.equal(h.calls.filter(call => call.name === 'exchangeAndVerify').length, 1);
  await t.test('a replaced browser secret does not authorize an old flow', async () => {
    const other = harness();
    const old = await other.begin(), current = await other.begin();
    assertRefused(await other.finish({ ...old, cookie: current.cookie }));
    assert.equal(other.calls.some(call => call.name === 'exchangeAndVerify'), false);
  });
  await t.test('expired attempt is refused', async () => {
    const other = harness(), begin = await other.begin();
    other.setNow(baseTime + 300_000);
    assertRefused(await other.finish(begin));
    assert.equal(other.calls.some(call => call.name === 'exchangeAndVerify'), false);
  });
});

test('callback rejects tampered shapes, duplicates, issuer substitution and malformed browser cookies before exchange', async (t) => {
  const cases = {
    'missing state': '?code=code', 'short state': '?code=code&state=short',
    'no result': `?state=${'s'.repeat(43)}`, 'both result modes': `?state=${'s'.repeat(43)}&code=code&error=denied`,
    'duplicate state': '?code=code&state=STATE&state=STATE', 'duplicate code': '?code=code&code=again&state=STATE',
    'wrong issuer': '?code=code&state=STATE&iss=https%3A%2F%2Funtrusted.invalid',
    'arbitrary parameter': '?code=code&state=STATE&returnTo=https%3A%2F%2Funtrusted.invalid',
    'link intent': '?code=code&state=STATE&pixel_intent=link',
    'oversized code': `?code=${'c'.repeat(2049)}&state=STATE`, 'control code': '?code=bad%0Acode&state=STATE',
  };
  for (const [name, shape] of Object.entries(cases)) await t.test(name, async () => {
    const h = harness(), start = await h.begin();
    assertRefused(await h.handle(request(callbackPath + shape.replaceAll('STATE', start.state), { cookie: start.cookie })));
    assert.equal(h.calls.some(call => call.name === 'exchangeAndVerify' || call.name === 'consumeAttempt'), false);
  });
  for (const [name, value] of Object.entries({ missing: '', malformed: `${ATTEMPT_COOKIE}=short`, duplicate: `${ATTEMPT_COOKIE}=${browserValue}; ${ATTEMPT_COOKIE}=${browserValue}` })) await t.test(`${name} cookie`, async () => {
    const h = harness(), start = await h.begin();
    assertRefused(await h.finish({ ...start, cookie: value }));
    assert.equal(h.calls.some(call => call.name === 'exchangeAndVerify' || call.name === 'consumeAttempt'), false);
  });
});

test('provider cancellation consumes its flow but does not exchange, create or revoke an account session', async () => {
  const h = harness(), start = await h.begin();
  const response = await h.handle(request(`${callbackPath}?state=${start.state}&error=access_denied&error_description=private-detail`, { cookie: start.cookie }));
  assert.equal(response.headers.get('location'), `${SITE_ORIGIN}/?pixel=cancelled`);
  assert.equal(h.calls.some(call => ['exchangeAndVerify', 'issueBoundSession', 'revokeSession'].includes(call.name)), false);
  assertRefused(await h.finish(start));
  assert.equal((await response.text()).includes('private-detail'), false);
});

test('explicit cancellation is browser-bound and leaves existing sessions intact', async () => {
  const h = harness(), start = await h.begin();
  h.sessions.set(hash(tokenValue), { expiresAt: new Date(baseTime + 240_000).toISOString(), epoch: 3 });
  const response = await h.handle(post('cancel', { body: { state: start.state }, cookie: start.cookie }));
  assert.deepEqual(await response.json(), { ok: true });
  assertRefused(await h.finish(start));
  assert.equal(h.sessions.get(hash(tokenValue)).revoked, undefined);
  assert.equal(h.calls.some(call => ['exchangeAndVerify', 'issueBoundSession', 'revokeSession'].includes(call.name)), false);
  const invalid = await h.handle(post('cancel', { body: { state: start.state } }));
  assert.equal(invalid.status, 400);
});

test('a different browser cannot cancel the real attempt or manufacture identity authority', async () => {
  const h = harness(), start = await h.begin();
  const result = await h.handle(post('cancel', { body: { state: start.state }, cookie: cookieHeader(ATTEMPT_COOKIE, browserValue) }));
  assert.equal(result.status, 200); // Generic response does not disclose attempt existence.
  assert.equal(h.calls.some(call => call.name === 'exchangeAndVerify' || call.name === 'issueBoundSession'), false);
  assert.equal((await h.finish(start)).headers.get('location'), `${SITE_ORIGIN}/?pixel=returned`);
});

test('synthetic durable-attempt contract: cancellation/signout during delayed exchange blocks mint and callback cookie', async (t) => {
  for (const operation of ['cancel', 'sign-out']) await t.test(operation, async () => {
    const h = harness(), start = await h.begin();
    const entered = deferred(), released = deferred(), exchange = h.oidc.exchangeAndVerify;
    h.oidc.exchangeAndVerify = async args => { const identity = await exchange(args); entered.resolve(); await released.promise; return identity; };
    const pendingCallback = h.finish(start);
    await entered.promise;
    assert.equal(h.attempts.get(hash(start.state)).consumed, true);
    const stopped = await h.handle(post(operation, { body: operation === 'cancel' ? { state: start.state } : {}, cookie: start.cookie }));
    assert.equal(stopped.status, 200);
    assert.equal(h.attempts.get(hash(start.state)).cancelled, true);
    released.resolve();
    assertRefused(await pendingCallback);
    assert.equal(h.sessions.size, 0);
    assert.equal(h.calls.filter(call => call.name === 'issueBoundSession').length, 1, 'durable store must recheck the canceled consumed attempt at mint');
    assert.deepEqual(h.native, h.originalNative);
    assert.deepEqual(h.binding, h.originalBinding);
  });
});

test('synthetic durable-attempt contract: cancellation/signout after mint cannot leave a VALID session despite delayed cookie delivery', async (t) => {
  // An HTTP response can race a committed cancellation. These checks permit an
  // already-revoked opaque cookie to arrive; it must never restore admission.
  // PostgreSQL transaction/race acceptance is tested separately by its owner.
  for (const operation of ['cancel', 'sign-out']) await t.test(operation, async () => {
    const h = harness(), start = await h.begin();
    const minted = deferred(), released = deferred(), issue = h.store.issueBoundSession;
    h.store.issueBoundSession = async args => { const saved = await issue(args); minted.resolve(); await released.promise; return saved; };
    const pendingCallback = h.finish(start);
    await minted.promise;
    assert.equal(h.sessions.size, 1);
    const stopped = await h.handle(post(operation, { body: operation === 'cancel' ? { state: start.state } : {}, cookie: start.cookie }));
    assert.equal(stopped.status, 200);
    assert.equal([...h.sessions.values()][0].revoked, true);
    released.resolve();
    const lateResponse = await pendingCallback;
    const lateToken = cookieValue(lateResponse, SESSION_COOKIE);
    if (lateToken) {
      const read = await h.handle(request(`${prefix}/session`, { cookie: cookieHeader(SESSION_COOKIE, lateToken) }));
      assert.equal((await read.json()).authenticated, false);
      assert.match(cookies(read)[0], /Max-Age=0/);
    }
    assert.equal([...h.sessions.values()].some(saved => !saved.revoked), false);
    assert.deepEqual(h.native, h.originalNative);
    assert.deepEqual(h.binding, h.originalBinding);
  });
});

test('token-only signout derives browser and cancels another in-flight callback after attempt cookie was cleared', async () => {
  const h = harness(), first = await h.begin();
  const second = await h.begin({ cookie: first.cookie });
  const entered = deferred(), released = deferred(), exchange = h.oidc.exchangeAndVerify;
  const secondNonce = second.url.searchParams.get('nonce');
  h.oidc.exchangeAndVerify = async args => {
    const identity = await exchange(args);
    if (args.nonce === secondNonce) { entered.resolve(); await released.promise; }
    return identity;
  };
  const callback = h.finish(second);
  await entered.promise;
  // First callback clears the shared browser cookie while the second request
  // already carries that cookie and is waiting on the provider exchange.
  const returned = await h.finish(first), token = cookieValue(returned, SESSION_COOKIE);
  const signedOut = await h.handle(post('sign-out', { cookie: cookieHeader(SESSION_COOKIE, token) }));
  assert.equal(signedOut.status, 200);
  assert.deepEqual(h.calls.find(call => call.name === 'revokeBrowser').args, { tokenHash: hash(token) });
  assert.equal(h.attempts.get(hash(second.state)).cancelled, true);
  released.resolve();
  assertRefused(await callback);
  assert.equal([...h.sessions.values()].some(saved => !saved.revoked), false);
});

test('signout revokes only this opaque local session and clears local cookies, without provider traffic', async () => {
  const h = harness(), start = await h.begin(), response = await h.finish(start);
  const token = cookieValue(response, SESSION_COOKIE);
  const beforeExchanges = h.calls.filter(call => call.name === 'exchangeAndVerify').length;
  const signedOut = await h.handle(post('sign-out', { cookie: cookieHeader(SESSION_COOKIE, token) }));
  assert.deepEqual(await signedOut.json(), { ok: true, authenticated: false });
  assert.equal(cookies(signedOut).length, 2);
  for (const value of cookies(signedOut)) assert.match(value, /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=0$/);
  assert.equal(h.sessions.get(hash(token)).revoked, true);
  assert.deepEqual(h.native, h.originalNative);
  assert.deepEqual(h.binding, h.originalBinding);
  assert.equal(h.calls.filter(call => call.name === 'exchangeAndVerify').length, beforeExchanges);
  assert.deepEqual(await (await h.handle(request(`${prefix}/session`, { cookie: cookieHeader(SESSION_COOKIE, token) }))).json(), { available: true, authenticated: false, firstConnections: false });
});

test('session reads cannot extend signed expiry or mint refresh cookies, and reject malformed/expired metadata', async (t) => {
  const h = harness(), response = await h.finish(await h.begin());
  const token = cookieValue(response, SESSION_COOKIE);
  h.setNow(baseTime + 239_000);
  const read = await h.handle(request(`${prefix}/session`, { cookie: cookieHeader(SESSION_COOKIE, token) }));
  assert.equal((await read.json()).sessionExpiresAt, h.identity.identityExpiresAt);
  assert.equal(cookies(read).length, 0);
  h.setNow(baseTime + 240_000);
  const expired = await h.handle(request(`${prefix}/session`, { cookie: cookieHeader(SESSION_COOKIE, token) }));
  assert.equal((await expired.json()).authenticated, false);
  assert.match(cookies(expired)[0], /Max-Age=0/);
  for (const [name, expiresAt] of Object.entries({ malformed: 'invalid', overlong: new Date(baseTime + 300_001).toISOString(), expired: new Date(baseTime).toISOString() })) await t.test(name, async () => {
    const other = harness();
    other.store.getSession = async () => ({ displayName: 'Original', expiresAt });
    const result = await other.handle(request(`${prefix}/session`, { cookie: cookieHeader(SESSION_COOKIE, tokenValue) }));
    assert.equal((await result.json()).authenticated, false);
    assert.match(cookies(result)[0], /Max-Age=0/);
  });
  assert.equal(h.calls.filter(call => call.name === 'issueBoundSession').length, 1);
});

test('callback refuses session output extending signed identity expiry or five-minute ceiling', async (t) => {
  for (const [name, savedPatch] of Object.entries({
    'past signed expiry': { expiresAt: new Date(baseTime + 241_000).toISOString() },
    'past five minutes': { expiresAt: new Date(baseTime + 301_000).toISOString() },
    'invalid session expiry': { expiresAt: 'bad-date' },
    'expired': { expiresAt: new Date(baseTime).toISOString() },
  })) await t.test(name, async () => {
    const h = harness({ savedPatch });
    assertRefused(await h.finish(await h.begin()));
  });
});

test('corrupt attempt/identity expiry and substituted issuer cannot reach session creation', async (t) => {
  for (const [name, options] of Object.entries({
    'malformed attempt': { attemptPatch: { expiresAt: 'invalid' } },
    'expired attempt': { attemptPatch: { expiresAt: new Date(baseTime).toISOString() } },
    'substituted callback': { attemptPatch: { redirectUri: 'https://other.invalid/callback' } },
    'malformed signed expiry': { identityPatch: { identityExpiresAt: 'invalid' } },
    'substituted issuer': { identityPatch: { issuer: 'https://other.invalid/api/sso' } },
  })) await t.test(name, async () => {
    const h = harness(options);
    assertRefused(await h.finish(await h.begin()));
    assert.equal(h.calls.some(call => call.name === 'issueBoundSession'), false);
  });
});

test('sub-second remaining lifetime is refused and just-created session is locally revoked', async () => {
  const h = harness({ savedPatch: { expiresAt: new Date(baseTime + 500).toISOString() } });
  assertRefused(await h.finish(await h.begin()));
  assert.equal(h.calls.filter(call => call.name === 'revokeSession').length, 1);
});

test('stale epoch is refused; higher synthetic signed epoch retires old local sessions without changing immutable binding', async () => {
  const stale = harness({ identityPatch: { credentialVersion: 2 } });
  assertRefused(await stale.finish(await stale.begin()));
  assert.equal(stale.sessions.size, 0);
  const h = harness({ identityPatch: { credentialVersion: 4 } });
  h.sessions.set(hash(tokenValue), { epoch: 3, expiresAt: new Date(baseTime + 240_000).toISOString() });
  const result = await h.finish(await h.begin());
  assert.equal(result.headers.get('location'), `${SITE_ORIGIN}/?pixel=returned`);
  assert.equal(h.sessions.get(hash(tokenValue)).revoked, true);
  assert.deepEqual({ ...h.binding, epoch: 3 }, h.originalBinding);
  assert.deepEqual(h.native, h.originalNative);
});

test('trusted higher epoch still reaches security observation when expiry crosses after verifier acceptance', async () => {
  const h = harness({ identityPatch: { credentialVersion: 4, identityExpiresAt: new Date(baseTime + 1000).toISOString() } });
  h.sessions.set(hash(tokenValue), { epoch: 3, expiresAt: new Date(baseTime + 240_000).toISOString() });
  h.oidc.exchangeAndVerify = async () => {
    // Synthetic verifier accepted it at baseTime; time crosses the deadline
    // before its already-verified immutable fact is delivered to the handler.
    const trusted = Object.freeze({ ...h.identity });
    h.setNow(baseTime + 1000);
    return trusted;
  };
  assertRefused(await h.finish(await h.begin()));
  assert.equal(h.calls.some(call => call.name === 'issueBoundSession'), true);
  assert.equal(h.binding.epoch, 4);
  assert.equal(h.sessions.get(hash(tokenValue)).revoked, true);
  assert.equal(h.sessions.size, 1, 'no new session is minted at the identity deadline');
  assert.deepEqual(h.native, h.originalNative);
  assert.deepEqual({ ...h.binding, epoch: 3 }, h.originalBinding);
});

test('trusted higher epoch retires old authority even when original attempt expires during verified exchange', async () => {
  const h = harness({ identityPatch: { credentialVersion: 4, identityExpiresAt: new Date(baseTime + 600_000).toISOString() } });
  h.sessions.set(hash(tokenValue), { epoch: 3, expiresAt: new Date(baseTime + 500_000).toISOString() });
  h.oidc.exchangeAndVerify = async () => {
    h.setNow(baseTime + 300_000);
    return Object.freeze({ ...h.identity });
  };
  assertRefused(await h.finish(await h.begin()));
  assert.equal(h.binding.epoch, 4);
  assert.equal(h.sessions.get(hash(tokenValue)).revoked, true);
  assert.equal(h.sessions.size, 1, 'expired admission does not mint');
  assert.deepEqual(h.native, h.originalNative);
});

test('transport/storage/provider errors expose no secret, SQL, identity, token or exception detail', async (t) => {
  for (const failing of ['checkReady', 'getSession', 'createAttempt', 'consumeAttempt', 'exchangeAndVerify', 'issueBoundSession', 'revokeBrowser', 'cancelAttempt']) await t.test(failing, async () => {
    const failures = {}, h = harness({ failures });
    let result;
    if (failing === 'checkReady') { failures[failing] = true; result = await h.handle(request(`${prefix}/session`)); }
    else if (failing === 'getSession') { failures[failing] = true; result = await h.handle(request(`${prefix}/session`, { cookie: cookieHeader(SESSION_COOKIE, tokenValue) })); }
    else if (failing === 'createAttempt') { failures[failing] = true; result = await h.handle(post('start')); }
    else {
      const start = await h.begin(); failures[failing] = true;
      if (failing === 'revokeBrowser') result = await h.handle(post('sign-out', { cookie: cookieHeader(SESSION_COOKIE, tokenValue) }));
      else if (failing === 'cancelAttempt') result = await h.handle(post('cancel', { body: { state: start.state }, cookie: start.cookie }));
      else result = await h.finish(start);
    }
    const publicText = `${await result.text()} ${JSON.stringify([...result.headers])}`;
    for (const fragment of [secretError, 'synthetic-secret', 'synthetic@example.invalid', 'SQL', 'authorization_code=']) assert.equal(publicText.includes(fragment), false);
    if (['consumeAttempt', 'exchangeAndVerify', 'issueBoundSession'].includes(failing)) assertRefused(result);
    else assert.equal(result.status, 503);
    assertCommonHeaders(result);
  });
});

test('a provider failure consumes its exact attempt; retry cannot exchange or issue another session', async () => {
  const failures = {}, h = harness({ failures }), start = await h.begin();
  failures.exchangeAndVerify = true;
  assertRefused(await h.finish(start));
  failures.exchangeAndVerify = false;
  assertRefused(await h.finish(start));
  assert.equal(h.calls.filter(call => call.name === 'exchangeAndVerify').length, 1);
  assert.equal(h.calls.some(call => call.name === 'issueBoundSession'), false);
});

test('malformed/duplicate session cookies fail unauthenticated without storage token lookup', async (t) => {
  for (const value of [`${SESSION_COOKIE}=short`, `${SESSION_COOKIE}=${tokenValue}; ${SESSION_COOKIE}=${tokenValue}`]) await t.test(value.includes(';') ? 'duplicate' : 'malformed', async () => {
    const h = harness();
    const response = await h.handle(request(`${prefix}/session`, { cookie: value }));
    assert.equal((await response.json()).authenticated, false);
    assert.equal(h.calls.some(call => call.name === 'getSession'), false);
    assert.match(cookies(response)[0], /Max-Age=0/);
  });
});

test('receiver origin override is test-only and cannot broaden production origins', () => {
  const old = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createPixelHandler({ getDependencies: () => null, origin: 'http://127.0.0.1:3000', localTest: true }));
    process.env.NODE_ENV = 'test';
    assert.doesNotThrow(() => createPixelHandler({ getDependencies: () => null, origin: 'http://127.0.0.1:3000', localTest: true }));
    for (const origin of ['https://other.invalid', 'http://localhost:3000', 'http://127.0.0.2:3000']) assert.throws(() => createPixelHandler({ getDependencies: () => null, origin, localTest: true }));
  } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});

test('Vercel Web bridge bounds queries and uses wrapper route rather than incoming Host/path', async () => {
  const queryResult = await servePixelRequest(new Request(`https://untrusted.invalid/?${'x'.repeat(8193)}`), `${prefix}/session`);
  assert.equal(queryResult.status, 400);
  assert.equal(queryResult.headers.get('cache-control'), 'no-store');
  const previous = process.env.REMATCH_PIXEL_SIGNIN_ENABLED;
  process.env.REMATCH_PIXEL_SIGNIN_ENABLED = 'false';
  try {
    const response = await servePixelRequest(new Request('https://untrusted.invalid/ignored-path', { headers: { host: 'other.invalid', 'x-forwarded-host': 'other.invalid' } }), `${prefix}/session`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: false, authenticated: false, firstConnections: false });
    const wrongOrigin = await servePixelRequest(new Request('https://untrusted.invalid/ignored-path', { method: 'POST', headers: { origin: 'https://untrusted.invalid', 'content-type': 'application/json' }, body: '{}' }), `${prefix}/start`);
    assert.equal(wrongOrigin.status, 400);
    const bodyResult = await servePixelRequest(post('start', { body: 'x'.repeat(1025) }), `${prefix}/start`);
    assert.equal(bodyResult.status, 400);
  } finally { if (previous === undefined) delete process.env.REMATCH_PIXEL_SIGNIN_ENABLED; else process.env.REMATCH_PIXEL_SIGNIN_ENABLED = previous; }
});

test('body deadline bounds a stalled stream before any dependency or account action', { timeout: 6500 }, async () => {
  let dependencies = 0, canceled = false;
  const handle = createPixelHandler({ getDependencies: () => { dependencies++; throw new Error('forbidden'); } });
  const stream = new ReadableStream({ cancel() { canceled = true; } });
  const req = new Request(`${SITE_ORIGIN}${prefix}/start`, { method: 'POST', headers: { origin: SITE_ORIGIN, 'content-type': 'application/json' }, body: stream, duplex: 'half' });
  const began = performance.now(), response = await handle(req), elapsed = performance.now() - began;
  assert.equal(response.status, 400);
  assert.equal(canceled, true);
  assert.equal(dependencies, 0);
  assert.ok(elapsed >= 2500 && elapsed < 6000, `deadline took ${elapsed}ms`);
});

test('aborted and excessively fragmented bodies are refused without dependency access', async (t) => {
  let dependencies = 0;
  const handle = createPixelHandler({ getDependencies: () => { dependencies++; throw new Error('forbidden'); } });
  const headers = { origin: SITE_ORIGIN, 'content-type': 'application/json' };
  await t.test('abort stalled reader', async () => {
    let canceled = false;
    const controller = new AbortController();
    const req = new Request(`${SITE_ORIGIN}${prefix}/start`, { method: 'POST', headers, body: new ReadableStream({ cancel() { canceled = true; } }), duplex: 'half', signal: controller.signal });
    const pending = handle(req);
    controller.abort();
    assert.equal((await pending).status, 400);
    assert.equal(canceled, true);
  });
  await t.test('empty-chunk flood', async () => {
    const stream = new ReadableStream({ start(controller) { for (let index = 0; index < 2049; index++) controller.enqueue(new Uint8Array()); controller.enqueue(new TextEncoder().encode('{}')); controller.close(); } });
    const response = await handle(new Request(`${SITE_ORIGIN}${prefix}/start`, { method: 'POST', headers, body: stream, duplex: 'half' }));
    assert.equal(response.status, 400);
  });
  assert.equal(dependencies, 0);
});
