import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createPixelHandler, ATTEMPT_COOKIE, SESSION_COOKIE } from './server/pixel-handler.mjs';
import { createOidcClient, PIXEL_ISSUER, PIXEL_CLIENT_ID, PIXEL_CALLBACK } from './server/pixel-oidc.mjs';
import { createPostgresStore } from './server/pixel-store.mjs';
import { readTargetConfig } from './server/pixel-target.mjs';

// These HTTP tests use SYNTHETIC identities and cryptographic keys on two
// 127.0.0.1 servers. The memory variant is NOT SQL/target/concurrency evidence.
// Neither variant contacts Pixel, sends mail, or proves a real first connection.
const digest = value => createHash('sha256').update(value).digest('hex');
const challenge = value => createHash('sha256').update(value).digest('base64url');
const fresh = () => randomBytes(32).toString('base64url');
const history = digest('rematch-pixel-bound-return-local-v1');
const subject = 'synthetic-already-bound-http-subject';
const prefix = '/api/auth/pixel-pulse';
const callbackPath = new URL(PIXEL_CALLBACK).pathname;

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function shutdown(server) {
  server.closeAllConnections?.();
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
const json = (response, value, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
const cookieValue = (response, name) => response.headers.getSetCookie().find(value => value.startsWith(`${name}=`))?.split(';')[0];

function syntheticMemoryStore() {
  const account = Object.freeze({ id: randomUUID(), displayName: 'Original local player', progress: { wins: 12 }, roles: ['player'] });
  const attempts = new Map(), sessions = new Map();
  let floor = 3;
  return {
    // A single pre-existing fixture, never a create/adopt operation.
    snapshot: async () => structuredClone({ accounts: [account], bindings: [{ issuer: PIXEL_ISSUER, subject, accountId: account.id, floor }] }),
    store: {
      async checkReady() { return true; },
      async createAttempt(args) {
        if ([...attempts.values()].some(value => value.browserHash === args.browserHash && value.cancelled)) throw new Error('Synthetic retired browser');
        attempts.set(args.stateHash, { ...args, consumed: false, cancelled: false, completed: false });
      },
      async consumeAttempt({ stateHash, browserHash }) {
        const saved = attempts.get(stateHash);
        if (!saved || saved.browserHash !== browserHash || saved.consumed || saved.cancelled || saved.completed || Date.parse(saved.expiresAt) <= Date.now()) return null;
        saved.consumed = true;
        return { nonce: saved.nonce, codeVerifier: saved.codeVerifier, redirectUri: saved.redirectUri, expiresAt: saved.expiresAt };
      },
      async cancelAttempt({ stateHash, browserHash }) {
        const saved = attempts.get(stateHash);
        if (saved?.browserHash === browserHash) {
          saved.cancelled = true;
          for (const value of sessions.values()) if (value.attemptStateHash === stateHash) value.revoked = true;
        }
      },
      async issueBoundSession(identity) {
        // Synthetic security observation is independent of optional admission;
        // the native variant is still required to prove database behavior.
        if (identity.issuer !== PIXEL_ISSUER || identity.subject !== subject || identity.credentialVersion < floor) return null;
        if (identity.credentialVersion > floor) { floor = identity.credentialVersion; for (const value of sessions.values()) if (value.epoch < floor) value.revoked = true; }
        const attempt = attempts.get(identity.stateHash);
        if (!attempt || attempt.browserHash !== identity.browserHash || !attempt.consumed || attempt.cancelled || attempt.completed || Date.parse(attempt.expiresAt) <= Date.now() || Date.parse(identity.identityExpiresAt) <= Date.now()) return null;
        const value = { accountId: account.id, displayName: account.displayName, expiresAt: new Date(Math.min(Date.parse(identity.identityExpiresAt), Date.now() + 300_000)).toISOString(), epoch: floor, revoked: false, attemptStateHash: identity.stateHash };
        attempt.completed = true;
        sessions.set(identity.tokenHash, value);
        return { accountId: value.accountId, displayName: value.displayName, expiresAt: value.expiresAt };
      },
      async getSession({ tokenHash }) {
        const value = sessions.get(tokenHash);
        return !value || value.revoked || value.epoch !== floor || Date.parse(value.expiresAt) <= Date.now() ? null : { accountId: value.accountId, displayName: value.displayName, expiresAt: value.expiresAt };
      },
      async revokeSession({ tokenHash }) { const value = sessions.get(tokenHash); if (value) value.revoked = true; },
      async revokeBrowser({ tokenHash, browserHash }) {
        const browsers = new Set(browserHash ? [browserHash] : []);
        const token = sessions.get(tokenHash);
        if (token) browsers.add(attempts.get(token.attemptStateHash).browserHash);
        for (const attempt of attempts.values()) if (browsers.has(attempt.browserHash)) attempt.cancelled = true;
        for (const value of sessions.values()) if (value === token || browsers.has(attempts.get(value.attemptStateHash).browserHash)) value.revoked = true;
      },
      async close() {},
    },
  };
}

async function localProvider() {
  const keys = await generateKeyPair('EdDSA', { extractable: true });
  const wrongKeys = await generateKeyPair('EdDSA');
  const key = { ...await exportJWK(keys.publicKey), kid: 'synthetic-http-key', alg: 'EdDSA', use: 'sig' };
  const codes = new Map(), tokens = new Map();
  const state = { mode: 'bound', exchanges: 0, successfulExchanges: 0, pkceChecks: 0, lastAccepted: null, requests: [] };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      state.requests.push({ path: url.pathname, method: request.method });
      if (url.pathname === '/api/sso/.well-known/openid-configuration') return json(response, {
        issuer: PIXEL_ISSUER, authorization_endpoint: `${PIXEL_ISSUER}/oauth2/authorize`, token_endpoint: `${PIXEL_ISSUER}/oauth2/token`,
        userinfo_endpoint: `${PIXEL_ISSUER}/oauth2/userinfo`, jwks_uri: `${PIXEL_ISSUER}/jwks`, response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['EdDSA'], token_endpoint_auth_methods_supported: ['none'],
      });
      if (url.pathname === '/api/sso/jwks') return json(response, { keys: [key] });
      if (url.pathname === '/api/sso/oauth2/authorize') {
        assert.equal(request.method, 'GET');
        assert.equal(url.searchParams.get('client_id'), PIXEL_CLIENT_ID);
        assert.equal(url.searchParams.get('redirect_uri'), PIXEL_CALLBACK);
        assert.equal(url.searchParams.get('response_type'), 'code');
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.equal(url.searchParams.get('scope'), 'openid profile email');
        const code = fresh();
        codes.set(code, { nonce: url.searchParams.get('nonce'), challenge: state.mode === 'wrong-pkce' ? fresh() : url.searchParams.get('code_challenge'), mode: state.mode, used: false });
        const callback = new URL(PIXEL_CALLBACK);
        callback.search = new URLSearchParams({ code, state: url.searchParams.get('state'), iss: PIXEL_ISSUER }).toString();
        response.writeHead(303, { location: callback.href }); response.end(); return;
      }
      if (url.pathname === '/api/sso/oauth2/token') {
        assert.equal(request.method, 'POST'); state.exchanges++;
        const chunks = []; for await (const value of request) chunks.push(value);
        const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const saved = codes.get(params.get('code'));
        if (!saved || saved.used || params.get('client_id') !== PIXEL_CLIENT_ID || params.get('redirect_uri') !== PIXEL_CALLBACK || params.get('grant_type') !== 'authorization_code') return json(response, { error: 'invalid_grant' }, 400);
        saved.used = true; state.pkceChecks++;
        if (challenge(params.get('code_verifier') || '') !== saved.challenge) return json(response, { error: 'invalid_grant' }, 400);
        const now = Math.floor(Date.now() / 1000);
        const claims = { iss: PIXEL_ISSUER, aud: PIXEL_CLIENT_ID, sub: saved.mode === 'unknown' ? 'synthetic-unbound-http-subject' : subject,
          nonce: saved.nonce, iat: now, exp: now + 120, credential_version: 3, email: 'synthetic-http@example.invalid', email_verified: true };
        const idToken = await new SignJWT(claims).setProtectedHeader({ alg: 'EdDSA', kid: key.kid, typ: 'JWT' }).sign(saved.mode === 'bad-signature' ? wrongKeys.privateKey : keys.privateKey);
        const access = fresh(); tokens.set(access, { ...claims, mode: saved.mode });
        state.successfulExchanges++; state.lastAccepted = { code: params.get('code'), verifier: params.get('code_verifier') };
        return json(response, { id_token: idToken, access_token: access, token_type: 'Bearer', expires_in: 120 });
      }
      if (url.pathname === '/api/sso/oauth2/userinfo') {
        const saved = tokens.get((request.headers.authorization || '').replace(/^Bearer /, ''));
        if (!saved) return json(response, { error: 'invalid_token' }, 401);
        if (saved.mode === 'paused-userinfo') {
          const pause = new Promise(resolve => { state.releaseUserInfo = resolve; });
          state.userInfoEntered?.();
          await pause;
        }
        return json(response, { sub: saved.mode === 'userinfo-mismatch' ? 'synthetic-other-subject' : saved.sub, credential_version: saved.credential_version,
          email: saved.email, email_verified: saved.email_verified, roles: ['provider-roles-are-not-imported'], preferred_username: 'provider-name-not-adopted' });
      }
      return json(response, { error: 'not_found' }, 404);
    } catch { return json(response, { error: 'synthetic_fixture_failure' }, 500); }
  });
  const origin = await listen(server);
  return { server, origin, state };
}

async function runHttpContract(t, backend) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const original = await backend.snapshot();
  let app;
  const provider = await localProvider();
  try {
    const fetched = [];
    const oidc = createOidcClient({ fetchImpl: async (url, options) => {
      const expected = new URL(url);
      assert.equal(expected.origin, new URL(PIXEL_ISSUER).origin);
      assert.ok(expected.pathname.startsWith('/api/sso/'));
      assert.equal(options.headers.cookie, undefined);
      const destination = provider.origin + expected.pathname + expected.search;
      assert.equal(new URL(destination).hostname, '127.0.0.1');
      fetched.push(expected.pathname);
      const response = await fetch(destination, options);
      // Explicit synthetic canonical->loopback transport. This is not evidence
      // that the production provider or registered callback is reachable.
      return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
    } });
    let handler, appOrigin;
    app = createServer(async (incoming, outgoing) => {
      try {
        const chunks = []; for await (const value of incoming) chunks.push(value);
        const request = new Request(appOrigin + incoming.url, { method: incoming.method, headers: incoming.headers,
          ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks), duplex: 'half' } : {}) });
        const response = await handler(request);
        outgoing.statusCode = response.status;
        for (const [key, value] of response.headers) if (key !== 'set-cookie') outgoing.setHeader(key, value);
        const cookies = response.headers.getSetCookie(); if (cookies.length) outgoing.setHeader('set-cookie', cookies);
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch { outgoing.writeHead(500); outgoing.end(); }
    });
    appOrigin = await listen(app);
    handler = createPixelHandler({ getDependencies: async () => ({ store: backend.store, oidc }), origin: appOrigin, localTest: true });
    const appRequest = (path, options = {}) => fetch(appOrigin + path, { redirect: 'manual', ...options });
    const post = (path, cookie) => appRequest(path, { method: 'POST', headers: { origin: appOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: '{}' });
    const begin = async () => {
      const response = await post(`${prefix}/start`);
      assert.equal(response.status, 200);
      const url = new URL((await response.json()).url);
      assert.equal(url.origin + url.pathname, `${PIXEL_ISSUER}/oauth2/authorize`);
      assert.equal(url.searchParams.get('redirect_uri'), PIXEL_CALLBACK);
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.match(response.headers.getSetCookie()[0], /; Secure; HttpOnly; SameSite=Lax;/);
      const authorization = await fetch(provider.origin + url.pathname + url.search, { redirect: 'manual' });
      assert.equal(authorization.status, 303);
      const callback = new URL(authorization.headers.get('location'));
      assert.equal(callback.origin + callback.pathname, PIXEL_CALLBACK);
      return { callback: callback.pathname + callback.search, cookie: cookieValue(response, ATTEMPT_COOKIE) };
    };
    const complete = flow => appRequest(flow.callback, { headers: { cookie: flow.cookie } });
    const refused = response => { assert.equal(response.status, 303); assert.equal(new URL(response.headers.get('location')).searchParams.get('pixel'), 'refused'); assert.equal(cookieValue(response, SESSION_COOKIE), undefined); };

    await t.test('HTTP round trip verifies PKCE+EdDSA+UserInfo, returns original bound account and signs out', async () => {
      assert.deepEqual(await (await appRequest(`${prefix}/session`)).json(), { available: true, authenticated: false, firstConnections: false });
      const flow = await begin(), result = await complete(flow);
      assert.equal(result.status, 303);
      assert.equal(new URL(result.headers.get('location')).searchParams.get('pixel'), 'returned');
      assert.equal(provider.state.pkceChecks, 1);
      assert.deepEqual(fetched, ['/api/sso/.well-known/openid-configuration', '/api/sso/oauth2/token', '/api/sso/jwks', '/api/sso/oauth2/userinfo']);
      const sessionCookie = cookieValue(result, SESSION_COOKIE);
      assert.match(sessionCookie, new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}$`));
      const session = await (await appRequest(`${prefix}/session`, { headers: { cookie: sessionCookie } })).json();
      assert.equal(session.authenticated, true);
      assert.deepEqual(session.profile, { displayName: 'Original local player' });
      assert.equal('accountId' in session, false); assert.equal('roles' in session.profile, false);
      assert.ok(Date.parse(session.sessionExpiresAt) <= Date.now() + 120_000);
      const exchanges = provider.state.exchanges;
      refused(await complete(flow));
      assert.equal(provider.state.exchanges, exchanges, 'callback replay never re-exchanges code');
      const accepted = provider.state.lastAccepted;
      const reused = await fetch(`${provider.origin}/api/sso/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: PIXEL_CLIENT_ID, redirect_uri: PIXEL_CALLBACK, code: accepted.code, code_verifier: accepted.verifier }) });
      assert.equal(reused.status, 400, 'provider code is one-use independently');
      assert.equal((await post(`${prefix}/sign-out`, sessionCookie)).status, 200);
      assert.equal((await (await appRequest(`${prefix}/session`, { headers: { cookie: sessionCookie } })).json()).authenticated, false);
    });
    await t.test('unknown immutable identity cannot create/adopt an account over HTTP', async () => {
      provider.state.mode = 'unknown'; refused(await complete(await begin()));
      assert.deepEqual(await backend.snapshot(), original);
    });
    await t.test('wrong browser cannot consume the attempt or reach token exchange', async () => {
      provider.state.mode = 'bound'; const flow = await begin(), exchanges = provider.state.exchanges;
      refused(await complete({ ...flow, cookie: `${ATTEMPT_COOKIE}=${fresh()}` }));
      assert.equal(provider.state.exchanges, exchanges);
      const returned = await complete(flow);
      assert.equal(new URL(returned.headers.get('location')).searchParams.get('pixel'), 'returned');
      await post(`${prefix}/sign-out`, cookieValue(returned, SESSION_COOKIE));
    });
    for (const mode of ['wrong-pkce', 'bad-signature', 'userinfo-mismatch']) await t.test(`${mode} is refused through actual loopback transport`, async () => {
      provider.state.mode = mode; refused(await complete(await begin()));
      assert.deepEqual(await backend.snapshot(), original);
    });
    for (const action of ['cancel', 'sign-out']) await t.test(`${action} while UserInfo is in flight prevents late session mint`, async () => {
      provider.state.mode = 'paused-userinfo';
      let entered;
      const reached = new Promise(resolve => { entered = resolve; });
      provider.state.userInfoEntered = entered;
      const flow = await begin();
      const completion = complete(flow);
      try {
        await reached;
        const body = action === 'cancel' ? JSON.stringify({ state: new URL(flow.callback, appOrigin).searchParams.get('state') }) : '{}';
        const stopped = await appRequest(`${prefix}/${action}`, { method: 'POST', headers: { origin: appOrigin, 'content-type': 'application/json', cookie: flow.cookie }, body });
        assert.equal(stopped.status, 200);
        assert.equal((await post(`${prefix}/start`, flow.cookie)).status, 503, 'stale retained browser cannot create a later attempt');
      } finally { provider.state.releaseUserInfo?.(); }
      refused(await completion);
      assert.deepEqual(await backend.snapshot(), original);
      delete provider.state.userInfoEntered; delete provider.state.releaseUserInfo;
    });
  } finally {
    await shutdown(app || createServer()); await shutdown(provider.server);
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
}

test('SYNTHETIC-memory actual loopback HTTP integration (not SQL or real-identity evidence)', async t => {
  const backend = syntheticMemoryStore();
  try { await runHttpContract(t, backend); } finally { await backend.store.close(); }
});

test('OPTIONAL native local PostgreSQL + actual loopback HTTP integration', { skip: !process.env.REMATCH_PIXEL_TEST_CONTEXT }, async t => {
  const { Pool } = await import('pg');
  const context = JSON.parse(await readFile(process.env.REMATCH_PIXEL_TEST_CONTEXT, 'utf8'));
  assert.equal(context.host, '127.0.0.1'); assert.match(context.user, /^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
  assert.ok(Number.isInteger(Number(context.port)) && Number(context.port) > 0 && Number(context.port) <= 65535);
  assert.ok(!context.adminDatabase || context.adminDatabase === 'postgres');
  const database = `rematch_pixel_test_${randomBytes(8).toString('hex')}`;
  const connection = { host: context.host, port: Number(context.port), user: context.user, database: 'postgres', password: () => '', ssl: false,
    options: '-c search_path=pg_catalog -c timezone=UTC', replication: 'false', client_encoding: 'UTF8', sslnegotiation: 'postgres', max: 3 };
  const admin = new Pool(connection);
  let direct, store;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    direct = new Pool({ ...connection, database });
    await direct.query(await readFile(new URL('./test/fixtures/pixel-local-schema.sql', import.meta.url), 'utf8'));
    const accountId = randomUUID();
    await direct.query('INSERT INTO rematch_pixel.accounts(id,display_name) VALUES($1,$2)', [accountId, 'Original local player']);
    await direct.query('INSERT INTO rematch_pixel.bindings(issuer,subject,account_id,floor_epoch) VALUES($1,$2,$3,3)', [PIXEL_ISSUER, subject, accountId]);
    store = createPostgresStore(readTargetConfig({ NODE_ENV: 'test', REMATCH_PIXEL_LOCAL_TEST_MODE: 'true', REMATCH_PIXEL_TARGET_APPROVED: 'true',
      REMATCH_PIXEL_DATABASE_URL: `postgresql://${context.user}@127.0.0.1:${context.port}/${database}`, REMATCH_PIXEL_APPROVED_HOST: '127.0.0.1',
      REMATCH_PIXEL_APPROVED_PORT: String(context.port), REMATCH_PIXEL_APPROVED_DATABASE: database, REMATCH_PIXEL_APPROVED_ROLE: context.user, REMATCH_PIXEL_APPROVED_HISTORY: history }));
    await runHttpContract(t, { store, snapshot: async () => ({ accounts: (await direct.query('SELECT to_jsonb(a) AS value FROM rematch_pixel.accounts a ORDER BY id')).rows,
      bindings: (await direct.query('SELECT to_jsonb(b) AS value FROM rematch_pixel.bindings b ORDER BY issuer,subject')).rows }) });
  } finally {
    await store?.close(); await direct?.end();
    try { await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); } finally { await admin.end(); }
  }
});
