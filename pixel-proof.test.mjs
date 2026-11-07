import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createFreshProofClient, freshFlowDigest, PIXEL_FLOW_FIELDS } from './server/pixel-proof.mjs';
import { createOidcClient, PIXEL_ISSUER, PIXEL_CLIENT_ID, PIXEL_CALLBACK } from './server/pixel-oidc.mjs';

// Credential-free injected cryptographic fixtures only. These tests never
// contact a provider, account, mailbox or database and are not receiving proof.
const now = 1_800_000_000, verifier = 'v'.repeat(43), code = 'synthetic-code', subject = 'synthetic-subject';
const hash = value => createHash('sha256').update(value).digest('hex');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const flow = Object.freeze({ client_id: PIXEL_CLIENT_ID, redirect_uri: PIXEL_CALLBACK, response_type: 'code',
  scope: 'openid profile email', state: 's'.repeat(43), nonce: 'n'.repeat(43), code_challenge: challenge,
  code_challenge_method: 'S256', pixel_intent: 'link' });
const key = await generateKeyPair('EdDSA', { extractable: true });
const otherKey = await generateKeyPair('EdDSA', { extractable: true });
const publicKey = { ...await exportJWK(key.publicKey), kid: 'synthetic-key', alg: 'EdDSA', use: 'sig' };
const json = (value, init = {}) => new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
const payload = overrides => ({ iss: PIXEL_ISSUER, aud: PIXEL_CLIENT_ID, sub: subject, jti: randomUUID(),
  iat: now - 1, exp: now + 20, auth_time: now - 5, amr: ['pwd'], purpose: 'pixel-pulse-fresh-link',
  link_proof_version: 1, intent: 'link', credential_version: 3, flow_hash: freshFlowDigest(flow),
  oauth_state_hash: hash(flow.state), oauth_nonce_hash: hash(flow.nonce), pkce_challenge: challenge,
  redirect_uri: PIXEL_CALLBACK, authorization_code_hash: hash(code), ...overrides });
async function signed(p, header = {}, privateKey = key.privateKey) {
  return new SignJWT(p).setProtectedHeader({ alg: 'EdDSA', kid: 'synthetic-key', typ: 'JWT', ...header }).sign(privateKey);
}
async function harness(options = {}) {
  const claims = payload(options.claims), proof = options.proof ?? await signed(claims, options.header, options.privateKey), calls = [];
  let offset = 0;
  const client = createFreshProofClient({ clock: options.clock || (() => now * 1_000 + offset), requestTimeoutMs: options.timeout || 5_000,
    fetchImpl: async (url, request) => {
      calls.push({ url, request });
      if (options.fetch) return options.fetch(url, request, { proof, calls, advance: value => { offset += value; } });
      if (url === `${PIXEL_ISSUER}/pixel-pulse/redeem-link`) return json({ proof });
      if (url === `${PIXEL_ISSUER}/jwks`) return json(options.jwks || { keys: [publicKey] });
      throw new Error('Unapproved synthetic URL.');
    } });
  const input = { ticket: 't'.repeat(43), idToken: 'e30.e30.c3ludGhldGlj', code, codeVerifier: verifier, flow, subject, credentialVersion: 3 };
  return { client, input, calls, claims, redeem: overrides => client.redeem({ ...input, ...overrides }) };
}

test('exact central v1 nine-field order/digest and explicit fresh intent preserve ordinary return URL', () => {
  assert.deepEqual(PIXEL_FLOW_FIELDS, Object.keys(flow));
  assert.equal(freshFlowDigest(flow), hash(JSON.stringify(flow)));
  assert.equal(freshFlowDigest(Object.fromEntries(Object.entries(flow).reverse())), freshFlowDigest(flow));
  const client = createOidcClient({ fetchImpl() { throw new Error('No I/O permitted.'); } });
  const args = { state: flow.state, nonce: flow.nonce, codeChallenge: challenge };
  assert.equal(new URL(client.authorizationUrl(args)).searchParams.has('pixel_intent'), false);
  assert.deepEqual(Object.fromEntries(new URL(client.authorizationUrl({ ...args, pixelIntent: 'link' })).searchParams), flow);
  for (const pixelIntent of ['create', '', true, 'return']) assert.throws(() => client.authorizationUrl({ ...args, pixelIntent }));
});
test('valid proof returns only frozen verified receipt; request uses fixed endpoints and exact body', async () => {
  const f = await harness(), receipt = await f.redeem();
  assert.deepEqual(receipt, { issuer: PIXEL_ISSUER, subject, credentialVersion: 3, jti: f.claims.jti,
    expiresAt: new Date((now + 20) * 1_000).toISOString(), flowHash: freshFlowDigest(flow), authTime: now - 5, issuedAt: now - 1 });
  assert.equal(Object.isFrozen(receipt), true);
  assert.deepEqual(f.calls.map(c => c.url), [`${PIXEL_ISSUER}/pixel-pulse/redeem-link`, `${PIXEL_ISSUER}/jwks`]);
  assert.deepEqual(JSON.parse(f.calls[0].request.body), { ticket: f.input.ticket, idToken: f.input.idToken, code, codeVerifier: verifier, flow });
  for (const { request } of f.calls) { assert.equal(request.redirect, 'error'); assert.equal(request.credentials, 'omit'); assert.equal(request.cache, 'no-store'); }
  assert.doesNotMatch(JSON.stringify(receipt), /ticket|idToken|codeVerifier|email|password|roles/);
});
for (const [name, change] of [
  ['audience-array', { aud: [PIXEL_CLIENT_ID] }], ['foreign-audience', { aud: 'skyway' }], ['issuer', { iss: 'https://foreign.invalid' }],
  ['actor', { sub: 'other-subject' }], ['credential-epoch', { credential_version: 4 }], ['fractional-epoch', { credential_version: 3.5 }],
  ['purpose', { purpose: 'other' }], ['version', { link_proof_version: 2 }], ['intent', { intent: 'create' }],
  ['amr-extra', { amr: ['pwd', 'otp'] }], ['amr-missing-pwd', { amr: ['otp'] }], ['jti', { jti: 'not-a-uuid' }],
  ['future-password', { auth_time: now + 1 }], ['old-password', { auth_time: now - 91 }], ['future-issued', { iat: now + 1 }],
  ['issued-before-password', { iat: now - 8 }], ['expired', { exp: now }], ['duration', { exp: now + 31 }],
  ['password-window', { auth_time: now - 80, iat: now - 1, exp: now + 20 }], ['flow', { flow_hash: '0'.repeat(64) }],
  ['state', { oauth_state_hash: '0'.repeat(64) }], ['nonce', { oauth_nonce_hash: '0'.repeat(64) }],
  ['pkce', { pkce_challenge: 'a'.repeat(43) }], ['callback', { redirect_uri: 'https://foreign.invalid/callback' }],
  ['code', { authorization_code_hash: '0'.repeat(64) }], ['fractional-time', { auth_time: now - 2.5 }],
]) test(`proof refuses ${name}`, async () => { const f = await harness({ claims: change }); await assert.rejects(f.redeem(), { code: 'PIXEL_PROOF_REJECTED' }); });
for (const name of ['iss', 'aud', 'sub', 'jti', 'iat', 'exp', 'purpose', 'link_proof_version', 'intent', 'amr', 'auth_time',
  'credential_version', 'flow_hash', 'oauth_state_hash', 'oauth_nonce_hash', 'pkce_challenge', 'redirect_uri', 'authorization_code_hash']) {
  test(`proof requires ${name}`, async () => {
    const p = payload(); delete p[name]; const f = await harness({ proof: await signed(p) }); await assert.rejects(f.redeem());
  });
}
for (const [name, change] of [
  ['ticket', { ticket: 'short' }], ['ID-token', { idToken: 'plain-text' }], ['code', { code: '' }], ['verifier', { codeVerifier: 'q'.repeat(43) }],
  ['subject', { subject: '' }], ['epoch', { credentialVersion: -1 }], ['foreign-client', { flow: { ...flow, client_id: 'other' } }],
  ['extra-flow-field', { flow: { ...flow, extra: 'not allowed' } }], ['missing-intent', { flow: { ...flow, pixel_intent: undefined } }],
]) test(`bad input ${name} refuses before transport`, async () => { const f = await harness(); await assert.rejects(f.redeem(change)); assert.equal(f.calls.length, 0); });
for (const [name, options] of [
  ['foreign-signature', { privateKey: otherKey.privateKey }], ['header-URL', { header: { jku: 'https://foreign.invalid' } }],
  ['header-JWK', { header: { jwk: publicKey } }], ['header-type', { header: { typ: 'other' } }],
  ['private-JWKS', { jwks: { keys: [{ ...publicKey, d: 'x'.repeat(43) }] } }], ['duplicate-JWKS', { jwks: { keys: [publicKey, publicKey] } }],
  ['wrong-key-use', { jwks: { keys: [{ ...publicKey, use: 'enc' }] } }], ['missing-key', { jwks: { keys: [] } }],
]) test(`proof refuses ${name}`, async () => { const f = await harness(options); await assert.rejects(f.redeem()); });
for (const [name, response] of [
  ['redirect', () => new Response('', { status: 302, headers: { location: 'https://foreign.invalid' } })],
  ['HTML', () => new Response('<html>', { headers: { 'content-type': 'text/html' } })],
  ['oversize-header', () => json({ proof: 'a' }, { headers: { 'content-length': '999999' } })],
  ['oversize-body', () => json({ proof: 'a'.repeat(17_000) })], ['invalid-JSON', () => new Response('{', { headers: { 'content-type': 'application/json' } })],
]) test(`transport refuses ${name}`, async () => { const f = await harness({ fetch: async () => response() }); await assert.rejects(f.redeem()); });
test('request deadline bounds a transport that never resolves', async () => {
  const f = await harness({ timeout: 10, fetch: () => new Promise(() => {}) }); await assert.rejects(f.redeem(), { code: 'PIXEL_PROOF_UNAVAILABLE' });
});
test('expiry during signature verification is refused on the final clock sample', async () => {
  let calls = 0; const f = await harness({ clock: () => now * 1_000 + (calls++ ? 20_000 : 0) }); await assert.rejects(f.redeem());
});
test('invalid issuer configuration refuses construction before transport', () => {
  for (const issuer of ['https://foreign.invalid/api/sso', `${PIXEL_ISSUER}/`, 'http://127.0.0.1:9000/api/sso']) {
    assert.throws(() => createFreshProofClient({ issuer, fetchImpl() { throw new Error('No I/O.'); } }));
  }
});

async function identityHarness({ user = {}, id = {} } = {}) {
  const p = { iss: PIXEL_ISSUER, aud: PIXEL_CLIENT_ID, sub: subject, nonce: flow.nonce, iat: now - 1, exp: now + 240,
    credential_version: 3, email: 'synthetic@example.invalid', email_verified: true, ...id };
  const token = await signed(p);
  const client = createOidcClient({ clock: () => now * 1_000, fetchImpl: async url => {
    if (url.endsWith('/.well-known/openid-configuration')) return json({ issuer: PIXEL_ISSUER, authorization_endpoint: `${PIXEL_ISSUER}/oauth2/authorize`,
      token_endpoint: `${PIXEL_ISSUER}/oauth2/token`, userinfo_endpoint: `${PIXEL_ISSUER}/oauth2/userinfo`, jwks_uri: `${PIXEL_ISSUER}/jwks`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'],
      id_token_signing_alg_values_supported: ['EdDSA'], token_endpoint_auth_methods_supported: ['none'] });
    if (url.endsWith('/oauth2/token')) return json({ id_token: token, access_token: 'synthetic-access', token_type: 'Bearer' });
    if (url.endsWith('/jwks')) return json({ keys: [publicKey] });
    if (url.endsWith('/oauth2/userinfo')) return json({ sub: subject, email: p.email, email_verified: true, credential_version: 3,
      preferred_username: 'central_player', name: 'central_player', ...user });
    throw new Error('Unexpected synthetic route.');
  } });
  return { client, token, input: { code, codeVerifier: verifier, nonce: flow.nonce } };
}
test('profile exchange keeps ID token server-side, returns only canonical verified name and immutable identity', async () => {
  const f = await identityHarness(), ordinary = await f.client.exchangeAndVerify(f.input), result = await f.client.exchangeForProfile(f.input);
  assert.deepEqual(Object.keys(ordinary), ['issuer', 'subject', 'credentialVersion', 'identityExpiresAt']);
  assert.deepEqual(result.identity, { ...ordinary, displayName: 'central_player' }); assert.equal(result.idToken, f.token);
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.identity), true);
  assert.doesNotMatch(JSON.stringify(result.identity), /email|roles|access_token|idToken/);
});
for (const [name, options] of [
  ['missing-name', { user: { name: undefined } }], ['mismatching-name', { user: { name: 'other_player' } }],
  ['email-derived-name', { user: { preferred_username: 'synthetic@example.invalid', name: 'synthetic@example.invalid' } }],
  ['long-name', { user: { preferred_username: 'a'.repeat(26), name: 'a'.repeat(26) } }],
  ['signed-name-mismatch', { id: { preferred_username: 'other_player' } }],
]) test(`profile exchange refuses ${name}`, async () => { const f = await identityHarness(options); await assert.rejects(f.client.exchangeForProfile(f.input)); });
