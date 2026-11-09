import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createOidcClient, PIXEL_ISSUER, PIXEL_CLIENT_ID, PIXEL_CALLBACK } from './server/pixel-oidc.mjs';
import { createAcceptedIdentityMarker, readAcceptedIdentityFact } from './server/pixel-accepted-identity.mjs';

// Every response is synthetic and injected. No provider, mailbox, database or
// real identity is contacted, and these tests are not receiving-proof evidence.
const now = 1_800_000_000;
const state = 's'.repeat(43), nonce = 'n'.repeat(43), codeVerifier = 'v'.repeat(43), challenge = 'c'.repeat(43);
const keys = await generateKeyPair('EdDSA', { extractable: true });
const otherKeys = await generateKeyPair('EdDSA', { extractable: true });
const publicKey = { ...await exportJWK(keys.publicKey), kid: 'synthetic-key', alg: 'EdDSA', use: 'sig' };

function discovery(issuer = PIXEL_ISSUER) {
  return { issuer, authorization_endpoint: `${issuer}/oauth2/authorize`, token_endpoint: `${issuer}/oauth2/token`,
    userinfo_endpoint: `${issuer}/oauth2/userinfo`, jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'],
    id_token_signing_alg_values_supported: ['EdDSA'], token_endpoint_auth_methods_supported: ['none'] };
}

function claims(overrides = {}) {
  return { iss: PIXEL_ISSUER, aud: PIXEL_CLIENT_ID, sub: 'synthetic-subject', nonce, iat: now - 2,
    exp: now + 240, credential_version: 3, email: 'synthetic@example.invalid', email_verified: true, ...overrides };
}

async function signed(payload = claims(), header = {}, privateKey = keys.privateKey) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', kid: 'synthetic-key', typ: 'JWT', ...header }).sign(privateKey);
}

function json(value, options = {}) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', ...options.headers }, ...options });
}

async function harness(options = {}) {
  const payload = options.claims || claims();
  const token = options.idToken ?? await signed(payload, options.header, options.privateKey);
  const issuer = options.issuer || PIXEL_ISSUER;
  const calls = [];
  const fetchImpl = async (url, request) => {
    calls.push({ url, request });
    if (options.fetchOverride) return options.fetchOverride(url, request, calls);
    if (url === `${issuer}/.well-known/openid-configuration`) return json(options.discovery ?? discovery(issuer));
    if (url === `${issuer}/oauth2/token`) return json(options.token ?? { id_token: token, access_token: 'synthetic-access', token_type: 'Bearer' });
    if (url === `${issuer}/jwks`) return json(options.jwks ?? { keys: [publicKey] });
    if (url === `${issuer}/oauth2/userinfo`) return json(options.userInfo ?? {
      sub: payload.sub, credential_version: payload.credential_version, email: payload.email, email_verified: payload.email_verified,
      roles: ['this-is-not-consumer-authority'], preferred_username: 'not-returned',
    });
    throw new Error('Unexpected external I/O is forbidden in this harness.');
  };
  const client = createOidcClient({ issuer, fetchImpl, clock: () => now * 1_000, ...options.configuration });
  return { client, calls, exchange: () => client.exchangeAndVerify({ code: 'synthetic-code', codeVerifier, nonce }) };
}

test('fixed public code/S256 authorization does not request creation, tokens or expanded authority', () => {
  const client = createOidcClient({ fetchImpl: () => { throw new Error('No request expected.'); } });
  const url = new URL(client.authorizationUrl({ state, nonce, codeChallenge: challenge }));
  assert.equal(url.origin + url.pathname, `${PIXEL_ISSUER}/oauth2/authorize`);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: PIXEL_CLIENT_ID, redirect_uri: PIXEL_CALLBACK, response_type: 'code', scope: 'openid profile email',
    state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
  });
  assert.equal(url.searchParams.has('pixel_intent'), false);
  assert.equal(url.searchParams.has('refresh_token'), false);
  assert.equal(url.searchParams.has('offline_access'), false);
});

test('configuration refuses issuer, client or callback substitution before I/O', () => {
  const bad = [
    { issuer: 'https://untrusted.invalid/api/sso' }, { issuer: `${PIXEL_ISSUER}/` },
    { issuer: `${PIXEL_ISSUER}?target=other` }, { issuer: 'http://127.0.0.1:1234/api/sso' },
    { clientId: 'skyway-sprint' }, { redirectUri: 'https://untrusted.invalid/callback' },
    { requestTimeoutMs: 0 }, { requestTimeoutMs: 5_001 }, { clock: null }, { fetchImpl: null },
  ];
  for (const options of bad) assert.throws(() => createOidcClient(options), { code: 'PIXEL_OIDC_CONFIGURATION' });
});

test('loopback issuer requires explicit local-test option AND NODE_ENV=test, without callback expansion', () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createOidcClient({ issuer: 'http://127.0.0.1:1234/api/sso', allowLocalTestIssuer: true }), { code: 'PIXEL_OIDC_CONFIGURATION' });
    process.env.NODE_ENV = 'test';
    assert.throws(() => createOidcClient({ issuer: 'http://127.0.0.1:1234/api/sso' }), { code: 'PIXEL_OIDC_CONFIGURATION' });
    const client = createOidcClient({ issuer: 'http://127.0.0.1:1234/api/sso', allowLocalTestIssuer: true });
    const url = new URL(client.authorizationUrl({ state, nonce, codeChallenge: challenge }));
    assert.equal(url.origin, 'http://127.0.0.1:1234');
    assert.equal(url.searchParams.get('redirect_uri'), PIXEL_CALLBACK);
    for (const issuer of ['http://localhost:1234/api/sso', 'http://127.0.0.2:1234/api/sso', 'http://127.0.0.1:1234/api/sso/', 'http://a@127.0.0.1:1234/api/sso']) {
      assert.throws(() => createOidcClient({ issuer, allowLocalTestIssuer: true }), { code: 'PIXEL_OIDC_CONFIGURATION' });
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

test('valid signed identity returns only immutable binding authority and exact signed expiry', async () => {
  const { exchange, calls } = await harness();
  const identity = await exchange();
  assert.deepEqual(identity, { issuer: PIXEL_ISSUER, subject: 'synthetic-subject', credentialVersion: 3,
    identityExpiresAt: new Date((now + 240) * 1_000).toISOString() });
  assert.equal(Object.isFrozen(identity), true);
  assert.deepEqual(calls.map(call => call.url), [
    `${PIXEL_ISSUER}/.well-known/openid-configuration`, `${PIXEL_ISSUER}/oauth2/token`,
    `${PIXEL_ISSUER}/jwks`, `${PIXEL_ISSUER}/oauth2/userinfo`,
  ]);
  for (const { request } of calls) {
    assert.equal(request.redirect, 'error');
    assert.equal(request.credentials, 'omit');
    assert.equal(request.cache, 'no-store');
    assert.equal(request.referrerPolicy, 'no-referrer');
    assert.equal('cookie' in request.headers, false);
  }
  const tokenRequest = calls[1].request;
  assert.equal(tokenRequest.method, 'POST');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tokenRequest.body)), {
    grant_type: 'authorization_code', client_id: PIXEL_CLIENT_ID, redirect_uri: PIXEL_CALLBACK,
    code: 'synthetic-code', code_verifier: codeVerifier,
  });
  assert.equal(calls[3].request.headers.authorization, 'Bearer synthetic-access');
  assert.equal('email' in identity, false);
  assert.equal('roles' in identity, false);
});

test('Google upstream authentication preserves the same Pixel immutable returning identity', async () => {
  // A synthetic Pixel-issued token models an upstream social login; this is
  // neither a Google token nor evidence of a configured/live social provider.
  const password = await harness({ claims: claims({ amr: ['pwd'] }) });
  const social = await harness({ claims: claims({ amr: ['google'], provider: 'google',
    google_sub: 'synthetic-google-id', roles: ['admin'] }) });
  const previous = await password.exchange(), returned = await social.exchange();
  assert.deepEqual(returned, previous);
  assert.deepEqual(Object.keys(returned), ['issuer', 'subject', 'credentialVersion', 'identityExpiresAt']);
  assert.equal('google_sub' in returned || 'roles' in returned || 'email' in returned, false);
});

test('same email with a different Google-backed Pixel subject never becomes the original owner', async () => {
  const previous = await harness();
  const other = await harness({ claims: claims({ sub: 'different-pixel-subject', amr: ['google'] }) });
  const original = await previous.exchange(), returned = await other.exchange();
  assert.notEqual(returned.subject, original.subject);
  assert.equal(returned.issuer, original.issuer);
  assert.equal('email' in returned, false);
});

test('direct Google ID tokens cannot replace the fixed Pixel issuer even with matching email', async () => {
  for (const iss of ['https://accounts.google.com', 'accounts.google.com']) {
    const f = await harness({ claims: claims({ iss, amr: ['google'] }) });
    await assert.rejects(f.exchange(), { code: 'PIXEL_IDENTITY_REJECTED' });
    assert.equal(f.calls.some(c => c.url.endsWith('/userinfo')), false);
  }
});

test('malformed browser flow arguments fail before any provider request', async () => {
  const { client, calls } = await harness();
  for (const patch of [{ state: 'short' }, { nonce: 'bad nonce'.repeat(5) }, { codeChallenge: 'x'.repeat(42) }]) {
    assert.throws(() => client.authorizationUrl({ state, nonce, codeChallenge: challenge, ...patch }), { code: 'PIXEL_FLOW_REJECTED' });
  }
  for (const patch of [{ code: '' }, { code: 'bad\r\ncode' }, { codeVerifier: 'short' }, { codeVerifier: 'v'.repeat(129) }, { nonce: 'short' }]) {
    await assert.rejects(client.exchangeAndVerify({ code: 'synthetic-code', codeVerifier, nonce, ...patch }), { code: 'PIXEL_FLOW_REJECTED' });
  }
  assert.equal(calls.length, 0);
});

test('optional signed authorized party must be the exact consumer client', async () => {
  const { exchange } = await harness({ claims: claims({ azp: PIXEL_CLIENT_ID }) });
  assert.equal((await exchange()).subject, 'synthetic-subject');
});

test('invalid signed identity claims cannot reach UserInfo or become consumer authority', async (t) => {
  const cases = {
    'wrong issuer': { iss: 'https://untrusted.invalid/api/sso' },
    'wrong audience': { aud: 'skyway-sprint' },
    'audience array': { aud: [PIXEL_CLIENT_ID] },
    'wrong authorized party': { azp: 'skyway-sprint' },
    'authorized party array': { azp: [PIXEL_CLIENT_ID] },
    'null authorized party': { azp: null },
    'wrong nonce': { nonce: 'wrong'.repeat(9) },
    'missing subject': { sub: undefined }, 'empty subject': { sub: '' }, 'oversized subject': { sub: 's'.repeat(257) },
    'string epoch': { credential_version: '3' }, 'negative epoch': { credential_version: -1 },
    'fractional epoch': { credential_version: 3.5 }, 'unsafe epoch': { credential_version: Number.MAX_SAFE_INTEGER + 1 },
    'expired': { exp: now }, 'missing expiry': { exp: undefined }, 'fractional expiry': { exp: now + 5.5 },
    'unrepresentable expiry': { exp: Number.MAX_SAFE_INTEGER },
    'future issue': { iat: now + 1 }, 'missing issued time': { iat: undefined },
    'inverted lifetime': { iat: now, exp: now - 1 }, 'not yet valid': { nbf: now + 20 },
    'unverified': { email_verified: false }, 'truthy verification': { email_verified: 'true' },
    'missing verified email': { email: undefined }, 'bad email': { email: 'not-an-email' },
  };
  for (const [name, patch] of Object.entries(cases)) await t.test(name, async () => {
    const { exchange, calls } = await harness({ claims: claims(patch) });
    await assert.rejects(exchange(), { code: 'PIXEL_IDENTITY_REJECTED' });
    assert.equal(calls.some(call => call.url.endsWith('/userinfo')), false);
  });
});

test('a stale or inconsistent UserInfo identity cannot authorize a session', async (t) => {
  const base = { sub: 'synthetic-subject', credential_version: 3, email: 'synthetic@example.invalid', email_verified: true };
  for (const [name, patch] of Object.entries({
    'different subject': { sub: 'another-subject' }, 'newer epoch': { credential_version: 4 },
    'older epoch': { credential_version: 2 }, 'string epoch': { credential_version: '3' },
    'unverified': { email_verified: false }, 'different email': { email: 'other@example.invalid' },
    'wrong optional issuer': { iss: 'https://untrusted.invalid/api/sso' },
  })) await t.test(name, async () => {
    const { exchange } = await harness({ userInfo: { ...base, ...patch } });
    await assert.rejects(exchange(), { code: 'PIXEL_IDENTITY_REJECTED' });
  });
});

test('discovery cannot redirect credential exchange to a different origin/path or weaker flow', async (t) => {
  const bad = {
    'issuer': { issuer: 'https://untrusted.invalid/api/sso' },
    'authorization endpoint': { authorization_endpoint: `${PIXEL_ISSUER}/other` },
    'token endpoint': { token_endpoint: 'https://untrusted.invalid/token' },
    'userinfo endpoint': { userinfo_endpoint: `${PIXEL_ISSUER}/userinfo` },
    'JWKS endpoint': { jwks_uri: 'https://untrusted.invalid/jwks' },
    'S256 absent': { code_challenge_methods_supported: ['plain'] },
    'EdDSA absent': { id_token_signing_alg_values_supported: ['HS256'] },
    'public client absent': { token_endpoint_auth_methods_supported: ['client_secret_basic'] },
    'code absent': { response_types_supported: ['token'] },
    'grant absent': { grant_types_supported: ['refresh_token'] },
  };
  for (const [name, patch] of Object.entries(bad)) await t.test(name, async () => {
    const { exchange, calls } = await harness({ discovery: { ...discovery(), ...patch } });
    await assert.rejects(exchange(), { code: 'PIXEL_OIDC_UNAVAILABLE' });
    assert.equal(calls.length, 1);
  });
});

test('signature, protected-header and key-selection failures cannot reach UserInfo', async (t) => {
  const token = await signed();
  const fakeNone = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'synthetic-key' })).toString('base64url')}.${token.split('.')[1]}.invalid`;
  const variants = {
    'untrusted signer': { privateKey: otherKeys.privateKey },
    'unknown kid': { header: { kid: 'unknown-key' } },
    'embedded key URL': { header: { jku: 'https://untrusted.invalid/jwks' } },
    'certificate URL': { header: { x5u: 'https://untrusted.invalid/cert' } },
    'wrong token type': { header: { typ: 'at+jwt' } },
    'none': { idToken: fakeNone },
    'duplicate key IDs': { jwks: { keys: [publicKey, publicKey] } },
    'private key material': { jwks: { keys: [{ ...publicKey, d: 'private-data' }] } },
    'key-use mismatch': { jwks: { keys: [{ ...publicKey, use: 'enc' }] } },
    'key algorithm mismatch': { jwks: { keys: [{ ...publicKey, alg: 'HS256' }] } },
    'key operation mismatch': { jwks: { keys: [{ ...publicKey, key_ops: ['sign'] }] } },
    'empty key set': { jwks: { keys: [] } },
  };
  for (const [name, options] of Object.entries(variants)) await t.test(name, async () => {
    const { exchange, calls } = await harness(options);
    await assert.rejects(exchange(), { code: 'PIXEL_IDENTITY_REJECTED' });
    assert.equal(calls.some(call => call.url.endsWith('/userinfo')), false);
  });
});

test('redirects, wrong content types, oversized and malformed documents fail closed', async (t) => {
  const variants = {
    'HTTP redirect': () => new Response(null, { status: 302, headers: { location: 'https://untrusted.invalid/' } }),
    'redirected response': () => Object.defineProperty(json(discovery()), 'redirected', { value: true }),
    'unexpected response URL': () => Object.defineProperty(json(discovery()), 'url', { value: 'https://untrusted.invalid/' }),
    'HTML': () => new Response('<html>not metadata</html>', { headers: { 'content-type': 'text/html' } }),
    'oversized header': () => json(discovery(), { headers: { 'content-type': 'application/json', 'content-length': '99999999' } }),
    'oversized stream': () => json({ text: 'x'.repeat(40_000) }),
    'bad JSON': () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    'array': () => json([]),
  };
  for (const [name, response] of Object.entries(variants)) await t.test(name, async () => {
    const { exchange, calls } = await harness({ fetchOverride: response });
    await assert.rejects(exchange(), { code: 'PIXEL_OIDC_UNAVAILABLE' });
    assert.equal(calls.length, 1);
  });
});

test('network hangs are bounded even when an injected fetch ignores AbortSignal', async () => {
  const { exchange } = await harness({ configuration: { requestTimeoutMs: 10 }, fetchOverride: () => new Promise(() => {}) });
  await assert.rejects(exchange(), { code: 'PIXEL_OIDC_UNAVAILABLE' });
});

test('identity that expires while UserInfo is in flight is rejected at completion', async () => {
  let reads = 0;
  const { exchange } = await harness({ configuration: { clock: () => (++reads === 1 ? now : now + 240) * 1_000 } });
  await assert.rejects(exchange(), { code: 'PIXEL_IDENTITY_REJECTED' });
});

test('provider errors never echo code, verifier, tokens or identity in public error', async () => {
  const { exchange } = await harness({ fetchOverride: () => { throw new Error('synthetic-code synthetic-access synthetic@example.invalid'); } });
  await assert.rejects(exchange(), error => {
    assert.equal(error.message, 'Pixel sign-in could not be completed.');
    assert.equal(error.code, 'PIXEL_OIDC_UNAVAILABLE');
    assert.equal(error.cause, undefined);
    return true;
  });
});

const goodProfile = { sub: 'synthetic-subject', credential_version: 3, email: 'synthetic@example.invalid',
  email_verified: true, preferred_username: 'synthetic player', name: 'Synthetic Player' };
const profileOptions = onAcceptedIdentity => ({ code: 'synthetic-code', codeVerifier, nonce, onAcceptedIdentity });
test('profile exchange emits a private minimal accepted fact and returns the same handle without projection authority', async () => {
  const { client } = await harness({ userInfo: goodProfile });
  const observed = [];
  const result = await client.exchangeForProfile(profileOptions(handle => { observed.push(handle); }));
  assert.equal(observed.length, 1); assert.equal(result.acceptedIdentity, observed[0]);
  assert.deepEqual(readAcceptedIdentityFact(observed[0]), { issuer: PIXEL_ISSUER, subject: 'synthetic-subject', credentialVersion: 3 });
  assert.deepEqual(Object.keys(observed[0]), []); assert.equal(Object.isFrozen(observed[0]), true);
  assert.equal(result.identity.displayName, 'synthetic player');
  assert.equal(readAcceptedIdentityFact({ ...observed[0] }), null); assert.equal(readAcceptedIdentityFact(JSON.parse(JSON.stringify(observed[0]))), null);
});
for (const [name, patch] of Object.entries({
  'missing profile name': { name: undefined }, 'invalid profile name': { preferred_username: '**', name: '**' },
  'unverified optional UserInfo email': { email_verified: false }, 'mismatching optional UserInfo email': { email: 'different@example.invalid' },
})) test('accepted minimal fact reaches its awaited observer before optional profile refusal: ' + name, async () => {
  const { client } = await harness({ userInfo: { ...goodProfile, ...patch } });
  const observed = []; let persisted = false;
  await assert.rejects(client.exchangeForProfile(profileOptions(async handle => {
    observed.push(readAcceptedIdentityFact(handle)); await Promise.resolve(); persisted = true;
  })), { code: 'PIXEL_IDENTITY_REJECTED' });
  assert.equal(persisted, true); assert.deepEqual(observed, [{ issuer: PIXEL_ISSUER, subject: 'synthetic-subject', credentialVersion: 3 }]);
});
test('accepted minimal fact is observed before expiry during UserInfo or independent persistence is refused', async () => {
  for (const during of ['userinfo', 'persistence']) {
    let time = now * 1000, clockReads = 0, observed = 0;
    const { client } = await harness({ userInfo: goodProfile, configuration: { clock: () => {
      clockReads++; if (during === 'userinfo' && clockReads > 1) time = (now + 240) * 1000; return time;
    } } });
    await assert.rejects(client.exchangeForProfile(profileOptions(async handle => {
      assert.equal(readAcceptedIdentityFact(handle).credentialVersion, 3); observed++;
      if (during === 'persistence') { await Promise.resolve(); time = (now + 240) * 1000; }
    })), { code: 'PIXEL_IDENTITY_REJECTED' });
    assert.equal(observed, 1);
  }
});
test('security persistence failure aborts the profile exchange without returning an identity or token', async () => {
  const { client } = await harness({ userInfo: goodProfile }); let observed = 0;
  await assert.rejects(client.exchangeForProfile(profileOptions(async handle => {
    assert.ok(readAcceptedIdentityFact(handle)); observed++; throw new Error('Synthetic persistence unavailable');
  })), /Synthetic persistence unavailable/);
  assert.equal(observed, 1);
});
for (const [name, options] of Object.entries({
  'wrong signed subject nonce': { claims: claims({ nonce: 'x'.repeat(43) }), userInfo: goodProfile },
  'untrusted signed key': { privateKey: otherKeys.privateKey, userInfo: goodProfile },
  'mismatching UserInfo subject': { userInfo: { ...goodProfile, sub: 'another-subject' } },
  'mismatching UserInfo epoch': { userInfo: { ...goodProfile, credential_version: 4 } },
  'wrong optional UserInfo issuer': { userInfo: { ...goodProfile, iss: 'https://untrusted.invalid' } },
})) test('untrusted or inconsistent identity never produces a security fact: ' + name, async () => {
  const { client } = await harness(options); let observed = 0;
  await assert.rejects(client.exchangeForProfile(profileOptions(() => { observed++; })), { code: 'PIXEL_IDENTITY_REJECTED' });
  assert.equal(observed, 0);
});
test('only explicit trusted-server capability can mark a minimal fact; raw JSON/spreads are untrusted', () => {
  const mark = createAcceptedIdentityMarker(), tuple = { issuer: PIXEL_ISSUER, subject: 'synthetic-subject', credentialVersion: 2 };
  const handle = mark(tuple);
  assert.equal(readAcceptedIdentityFact(tuple), null); assert.equal(readAcceptedIdentityFact({ ...handle }), null);
  assert.deepEqual(readAcceptedIdentityFact(handle), tuple);
  for (const patch of [{ issuer: 'https://untrusted.invalid' }, { subject: '' }, { credentialVersion: -1 }, { credentialVersion: '2' }]) assert.throws(() => mark({ ...tuple, ...patch }));
});
