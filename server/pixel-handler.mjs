import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PIXEL_CALLBACK, PIXEL_ISSUER } from './pixel-oidc.mjs';
import { createAbuseGuard } from './pixel-abuse.mjs';
import { freshFlowDigest } from './pixel-proof.mjs';
import { readAcceptedIdentityFact } from './pixel-accepted-identity.mjs';
import { captureEnrollmentWindow, assertEnrollmentWindow } from './pixel-enrollment.mjs';

export const SITE_ORIGIN = 'https://rematch-rush.vercel.app';
export const SESSION_COOKIE = '__Host-rematch-pixel-session';
export const ATTEMPT_COOKIE = '__Host-rematch-pixel-attempt';
export const DISCOVERY_COOKIE = '__Host-rematch-pixel-discovery';
const opaque = /^[A-Za-z0-9_-]{43}$/;
export const hash = value => createHash('sha256').update(value).digest('hex');
const fresh = () => randomBytes(32).toString('base64url');
const headers = { 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Vary': 'Cookie', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (body, status = 200, cookies = []) => {
  const response = new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
  for (const cookie of cookies) response.headers.append('Set-Cookie', cookie);
  return response;
};
const cookie = (name, value, seconds = 0, expiry) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}${expiry ? `; Expires=${new Date(expiry).toUTCString()}` : ''}`;
const clearAttempt = () => cookie(ATTEMPT_COOKIE, '');
const clearSession = () => cookie(SESSION_COOKIE, '');
const clearDiscovery = () => cookie(DISCOVERY_COOKIE, '');
function readCookie(request, name) {
  const found = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.split('=', 1)[0] === name);
  if (found.length > 1) throw new Error('invalid cookie');
  if (!found.length) return null;
  const value = found[0].slice(name.length + 1);
  if (!opaque.test(value)) throw new Error('invalid cookie');
  return value;
}
async function readBody(request, origin) {
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new Error('origin');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '')) throw new Error('content type');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 1024)) throw new Error('body');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body');
  const chunks = []; let bytes = 0, count = 0, timer, abort;
  const read = async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      count++;
      bytes += value.byteLength;
      if (bytes > 1024 || count > 2048) throw new Error('body');
      chunks.push(value);
    }
  };
  const deadline = new Promise((_, reject) => {
    abort = () => { void reader.cancel().catch(() => {}); reject(new Error('body')); };
    timer = setTimeout(abort, 3000);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
  });
  try {
    await Promise.race([read(), deadline]);
  } catch {
    void reader.cancel().catch(() => {});
    throw new Error('body');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('body');
  return value;
}
const empty = body => Object.keys(body).length === 0;
const redirect = (notice, cookies = []) => {
  const response = new Response(null, { status: 303, headers: { ...headers, Location: `${SITE_ORIGIN}/?pixel=${notice}` } });
  for (const value of cookies) response.headers.append('Set-Cookie', value);
  return response;
};

/** Existing immutable return, plus a separately approved standalone first profile. */
export function createPixelHandler({ getDependencies, origin = SITE_ORIGIN, localTest = false, clock = () => Date.now(), abuseGuard = createAbuseGuard({ clock }) }) {
  if (origin !== SITE_ORIGIN && !(localTest && process.env.NODE_ENV === 'test' && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin))) throw new Error('Invalid receiver origin');
  return async function handle(request) {
    const url = new URL(request.url);
    const route = url.pathname;
    const callback = route === '/api/auth/callback/pixel-pulse';
    const session = route === '/api/auth/pixel-pulse/session';
    const start = route === '/api/auth/pixel-pulse/start';
    const create = route === '/api/auth/pixel-pulse/create';
    const discover = route === '/api/auth/pixel-pulse/discover';
    const signout = route === '/api/auth/pixel-pulse/sign-out';
    const cancel = route === '/api/auth/pixel-pulse/cancel';
    if (!callback && !session && !start && !create && !discover && !signout && !cancel) return json({ error: 'not_found' }, 404);
    if (request.method !== ((callback || session) ? 'GET' : 'POST')) return json({ error: 'method_not_allowed' }, 405);
    if (!callback && url.search) return json({ error: 'invalid_request' }, 400);
    let body;
    if (request.method === 'POST') {
      try {
        body = await readBody(request, origin);
        if (create ? Object.keys(body).length !== 2 || body.intent !== 'create' || body.acknowledgeSeparateProfile !== true :
          (!cancel && !empty(body)) || (cancel && (Object.keys(body).length !== 1 || !opaque.test(body.state)))) throw new Error('body');
      } catch { return json({ error: 'invalid_request' }, 400); }
    }
    let creating = false;
    try {
      const deps = await getDependencies();
      if (!deps) return session ? json({ available: false, authenticated: false, firstConnections: false }) : json({ error: 'unavailable' }, 503);
      const { store, oidc } = deps;
      let admission = deps.firstProfileAdmission;
      const ongoing = deps.enrollmentState !== undefined;
      const readEnrollment = deps.readEnrollmentPolicy || (() => deps.enrollmentState);
      let firstConnections = ongoing ? Boolean(deps.firstProfilesEnabled === true && readEnrollment()?.valid && readEnrollment().enabled) : Boolean(deps.firstProfilesEnabled === true && admission &&
        typeof admission.subject === 'string' && clock() >= admission.notBeforeMs && clock() < Date.parse(admission.expiresAt));
      if (discover && !ongoing || (create || discover) && !firstConnections) return json({ error: 'first_profiles_unavailable' }, 503);
      if (start || create || discover) {
        const browser = readCookie(request, ATTEMPT_COOKIE);
        if (!abuseGuard.admit(browser ? hash(browser) : 'anonymous', create ? 3 : 1)) return json({ error: 'try_later' }, 429);
      }
      if (session) {
        await store.checkReady();
        if (firstConnections) {
          if (ongoing) { try { await store.checkProfileReady(); await store.checkEnrollmentReady(captureEnrollmentWindow(readEnrollment(), clock())); } catch { firstConnections = false; } }
          else await store.checkProfileReady();
        }
        let discoveryReady = false, discoveryExpiresAt;
        if (ongoing && firstConnections) { try { const d = readCookie(request, DISCOVERY_COOKIE), b = readCookie(request, ATTEMPT_COOKIE); if (d && b) { const receipt = await store.readDiscovery({ tokenHash: hash(d), browserHash: hash(b) }); discoveryReady = Boolean(receipt); discoveryExpiresAt = receipt?.expiresAt; } } catch { /* Optional discovery never changes known-bound access. */ } }
        const discoveryStatus = ongoing ? { ongoingEnrollment: true, discoveryReady, ...(discoveryReady ? { discoveryExpiresAt } : {}) } : {};
        let token;
        try { token = readCookie(request, SESSION_COOKIE); } catch { return json({ available: true, authenticated: false, firstConnections, ...discoveryStatus }, 200, [clearSession()]); }
        const saved = token ? await store.getSession({ tokenHash: hash(token) }) : null;
        const expiry = Date.parse(saved?.expiresAt);
        if (!saved || !Number.isFinite(expiry) || expiry <= clock() || expiry > clock() + 300_000) return json({ available: true, authenticated: false, firstConnections, ...discoveryStatus }, 200, token ? [clearSession()] : []);
        return json({ available: true, authenticated: true, firstConnections, ...discoveryStatus, profile: { displayName: saved.displayName }, sessionExpiresAt: saved.expiresAt });
      }
      if (start || create || discover) {
        // Reuse the opaque admission secret so logout can atomically cancel
        // callbacks sharing it, including one already exchanging code.
        const state = fresh(), browser = readCookie(request, ATTEMPT_COOKIE) || fresh(), nonce = discover ? `discover_${fresh()}` : create ? `${ongoing ? 'enroll_create' : 'create'}_${fresh()}` : fresh(), codeVerifier = fresh();
        const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
        const authorize = oidc.authorizationUrl({ state, nonce, codeChallenge: challenge, ...(create ? { pixelIntent: 'link' } : {}) });
        const input = { stateHash: hash(state), browserHash: hash(browser), nonce, codeVerifier, expiresAt: new Date(clock() + 300_000).toISOString(), redirectUri: PIXEL_CALLBACK };
        if (discover) await store.createDiscoveryAttempt({ ...input, enrollment: captureEnrollmentWindow(readEnrollment(), clock()) });
        else if (create && ongoing) {
          const discovered = readCookie(request, DISCOVERY_COOKIE);
          if (!discovered) return json({ error: 'discovery_required' }, 409);
          const receipt = await store.readDiscovery({ tokenHash: hash(discovered), browserHash: hash(browser) });
          if (!receipt) return json({ error: 'discovery_required' }, 409, [clearDiscovery()]);
          const snapshot = { generation: receipt.generation, notBeforeMs: receipt.notBeforeMs, expiresAt: receipt.windowEnd };
          const cutoff = assertEnrollmentWindow(readEnrollment, snapshot, clock(), [receipt.expiresAt, receipt.identityExpiresAt]);
          await store.createProfileAttempt({ ...input, targetAccountId: randomUUID(), expectedSubject: receipt.subject,
            admissionExpiresAt: new Date(cutoff).toISOString(), enrollment: { ...snapshot, discoveryHash: hash(discovered), expectedEpoch: receipt.credentialVersion } });
          assertEnrollmentWindow(readEnrollment, snapshot, clock(), [cutoff]);
        } else if (create) await store.createProfileAttempt({ ...input, targetAccountId: randomUUID(), expectedSubject: admission.subject, admissionExpiresAt: admission.expiresAt });
        else await store.createAttempt(input);
        return json({ url: authorize }, 200, [cookie(ATTEMPT_COOKIE, browser, 300), ...(ongoing && (discover || create) ? [clearDiscovery()] : [])]);
      }
      if (signout) {
        let token, browser;
        try { token = readCookie(request, SESSION_COOKIE); } catch { token = null; }
        try { browser = readCookie(request, ATTEMPT_COOKIE); } catch { browser = null; }
        if (token || browser) await store.revokeBrowser({ ...(token ? { tokenHash: hash(token) } : {}), ...(browser ? { browserHash: hash(browser) } : {}) });
        else await store.checkReady();
        return json({ ok: true, authenticated: false }, 200, [clearSession(), clearAttempt(), ...(ongoing ? [clearDiscovery()] : [])]);
      }
      if (cancel) {
        const browser = readCookie(request, ATTEMPT_COOKIE);
        if (!browser) return json({ error: 'invalid_request' }, 400, [clearAttempt()]);
        await store.cancelAttempt({ stateHash: hash(body.state), browserHash: hash(browser) });
        return json({ ok: true }, 200, [clearAttempt()]);
      }
      // Check the entire callback shape before consuming its one-use attempt.
      const allowed = new Set(['code', 'state', 'iss', 'error', 'error_description', 'pixel_link_ticket']);
      for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return redirect('refused', [clearAttempt()]);
      const state = url.searchParams.get('state'), code = url.searchParams.get('code'), error = url.searchParams.get('error');
      if (!opaque.test(state || '') || (!!code === !!error) || (code && (code.length > 2048 || /[\x00-\x20\x7f]/.test(code))) || (error && error.length > 256) || (url.searchParams.has('iss') && url.searchParams.get('iss') !== PIXEL_ISSUER)) return redirect('refused', [clearAttempt()]);
      const browser = readCookie(request, ATTEMPT_COOKIE);
      if (!browser) return redirect('refused', [clearAttempt()]);
      const attempt = await store.consumeAttempt({ stateHash: hash(state), browserHash: hash(browser) });
      if (!attempt || attempt.redirectUri !== PIXEL_CALLBACK || !Number.isFinite(Date.parse(attempt.expiresAt)) || Date.parse(attempt.expiresAt) <= clock()) return redirect('refused', [clearAttempt()]);
      const originalAttemptEnd = Date.parse(attempt.expiresAt);
      if (error) return redirect('cancelled', [clearAttempt()]);
      // Purpose is persisted inside the server-generated, signed OIDC nonce.
      // A changed gate or missing child row cannot turn Create into Return.
      const discoveryPurpose = /^discover_[A-Za-z0-9_-]{43}$/.test(attempt.nonce);
      const ongoingPurpose = /^enroll_create_[A-Za-z0-9_-]{43}$/.test(attempt.nonce);
      const profilePurpose = ongoingPurpose || /^create_[A-Za-z0-9_-]{43}$/.test(attempt.nonce);
      const ticket = url.searchParams.get('pixel_link_ticket');
      if (discoveryPurpose) {
        if (!ongoing || !firstConnections || ticket !== null) return redirect('refused', [clearAttempt(), clearDiscovery()]);
        const flow = await store.getEnrollmentFlow({ stateHash: hash(state), browserHash: hash(browser), purpose: 'discovery' });
        if (!flow) return redirect('refused', [clearAttempt(), clearDiscovery()]);
        const snapshot = Object.freeze({ ...flow.enrollment });
        const live = (caps = []) => assertEnrollmentWindow(readEnrollment, snapshot, clock(), [originalAttemptEnd, flow.expiresAt, ...caps]);
        live();
        const verified = await oidc.exchangeForDiscovery({ code, codeVerifier: attempt.codeVerifier, nonce: attempt.nonce,
          onAcceptedIdentity: async fact => { await store.observeKnownBindingSecurity(fact); live(); } });
        await store.observeKnownBindingSecurity(verified.acceptedIdentity);
        const fact = readAcceptedIdentityFact(verified.acceptedIdentity), identity = verified.identity;
        if (!fact || identity.issuer !== fact.issuer || identity.subject !== fact.subject || identity.credentialVersion !== fact.credentialVersion) throw new Error('Identity mismatch');
        const cutoff = live([identity.identityExpiresAt]), token = fresh();
        // The same first-click identity journey returns an existing immutable
        // owner immediately. It never tries Create or email/device adoption.
        if(await store.hasKnownBinding(identity)){
          live([identity.identityExpiresAt]);
          const returned=await store.issueBoundSession({...identity,identityExpiresAt:new Date(cutoff).toISOString(),tokenHash:hash(token),stateHash:hash(state),browserHash:hash(browser)});
          live([identity.identityExpiresAt]);
          const end=Date.parse(returned?.expiresAt),remaining=Math.floor((end-clock())/1000);
          if(!returned||!Number.isFinite(end)||end>cutoff||remaining<1)return redirect('refused',[clearDiscovery()]);
          return redirect('returned',[cookie(SESSION_COOKIE,token,remaining,end),clearDiscovery()]);
        }
        const saved = await store.saveDiscovery({ ...identity, acceptedIdentity: verified.acceptedIdentity, tokenHash: hash(token), stateHash: hash(state), browserHash: hash(browser), enrollment: snapshot, originalAttemptEnd });
        live([identity.identityExpiresAt]); const expiry = Date.parse(saved?.expiresAt), seconds = Math.floor((expiry-clock())/1000);
        if (!Number.isFinite(expiry) || expiry > cutoff || seconds < 1) return redirect('refused', [clearDiscovery()]);
        return redirect('discovered', [cookie(DISCOVERY_COOKIE, token, seconds, expiry)]);
      }
      if (!profilePurpose && !opaque.test(attempt.nonce)) return redirect('refused', [clearAttempt()]);
      if (profilePurpose && (!firstConnections || ongoing && !ongoingPurpose || ongoingPurpose && !ongoing)) return redirect('refused', [clearAttempt()]);
      const profileAttempt = firstConnections ? await store.getProfileAttempt({ stateHash: hash(state), browserHash: hash(browser) }) : null;
      if (profilePurpose !== Boolean(profileAttempt)) return redirect('refused', [clearAttempt()]);
      let enrollmentContext;
      if (ongoingPurpose) {
        const flow = await store.getEnrollmentFlow({ stateHash: hash(state), browserHash: hash(browser), purpose: 'create' });
        if (!flow || !profileAttempt || flow.targetAccountId !== profileAttempt.targetAccountId || flow.expectedSubject !== profileAttempt.expectedSubject || Date.parse(profileAttempt.admissionExpiresAt) > Date.parse(flow.expiresAt)) return redirect('refused', [clearAttempt()]);
        enrollmentContext = { ...flow.enrollment, discoveryHash: flow.discoveryHash, expectedEpoch: flow.expectedEpoch };
        admission = { subject: flow.expectedSubject, notBeforeMs: flow.enrollment.notBeforeMs,
          expiresAt: new Date(Math.min(Date.parse(flow.expiresAt),Date.parse(flow.identityExpiresAt),Date.parse(flow.enrollment.expiresAt))).toISOString() };
      }
      if (profileAttempt) {
        if (!opaque.test(ticket || '') || url.searchParams.get('iss') !== PIXEL_ISSUER || !deps.proofClient) return redirect('refused', [clearAttempt()]);
        if (profileAttempt.expectedSubject !== admission.subject || !Number.isFinite(Date.parse(profileAttempt.admissionExpiresAt)) ||
            Date.parse(profileAttempt.admissionExpiresAt) <= clock()) return redirect('refused', [clearAttempt()]);
        // Retain primitive original cutoffs. A newer same-subject admission
        // cannot extend an old consumed attempt or its proof phase.
        const originalAdmissionEnd = Date.parse(profileAttempt.admissionExpiresAt);
        const initialCurrentEnd = Date.parse(admission.expiresAt);
        const expectedSubject = profileAttempt.expectedSubject;
        let retainedPhaseEnd = Math.min(originalAttemptEnd, originalAdmissionEnd, initialCurrentEnd);
        const profilePhaseLive = (identityEnd = Infinity) => {
          const now = clock(), currentEnd = Date.parse(admission.expiresAt);
          if (enrollmentContext) assertEnrollmentWindow(readEnrollment, enrollmentContext, now, [retainedPhaseEnd, currentEnd, identityEnd]);
          const cutoff = Math.min(retainedPhaseEnd, currentEnd, identityEnd);
          retainedPhaseEnd = cutoff;
          if (!Number.isSafeInteger(now) || !Number.isFinite(currentEnd) || !Number.isFinite(cutoff) ||
              admission.subject !== expectedSubject || !Number.isSafeInteger(admission.notBeforeMs) ||
              now < admission.notBeforeMs || now >= cutoff) throw new Error('Original profile phase expired.');
          return cutoff;
        };
        const observed = new Set();
        const observeAcceptedIdentity = async acceptedIdentity => {
          if (!readAcceptedIdentityFact(acceptedIdentity)) throw new Error('Untrusted identity fact.');
          if (!observed.has(acceptedIdentity)) {
            await store.observeKnownBindingSecurity(acceptedIdentity);
            observed.add(acceptedIdentity);
          }
          // Retirement is durable before an expired optional flow is refused.
          profilePhaseLive();
        };
        profilePhaseLive();
        const verified = await oidc.exchangeForProfile({ code, codeVerifier: attempt.codeVerifier, nonce: attempt.nonce, onAcceptedIdentity: observeAcceptedIdentity });
        await observeAcceptedIdentity(verified.acceptedIdentity);
        const identity = verified.identity, acceptedFact = readAcceptedIdentityFact(verified.acceptedIdentity);
        if (identity.issuer !== acceptedFact.issuer || identity.subject !== acceptedFact.subject || identity.credentialVersion !== acceptedFact.credentialVersion ||
            identity.subject !== expectedSubject || enrollmentContext && identity.credentialVersion !== enrollmentContext.expectedEpoch) return redirect('refused', [clearAttempt()]);
        const identityEnd = Date.parse(identity.identityExpiresAt);
        profilePhaseLive(identityEnd);
        const flow = { client_id: 'rematch-rush', redirect_uri: PIXEL_CALLBACK, response_type: 'code', scope: 'openid profile email',
          state, nonce: attempt.nonce, code_challenge: createHash('sha256').update(attempt.codeVerifier).digest('base64url'), code_challenge_method: 'S256', pixel_intent: 'link' };
        const proof = await deps.proofClient.redeem({ ticket, idToken: verified.idToken, code, codeVerifier: attempt.codeVerifier, flow,
          subject: identity.subject, credentialVersion: identity.credentialVersion });
        const phaseEnd = profilePhaseLive(identityEnd);
        const token = fresh();
        creating = true;
        const saved = await store.createStandaloneProfile({ ...identity, acceptedIdentity: verified.acceptedIdentity, proof, expectedFlowHash: freshFlowDigest(flow),
          tokenHash: hash(token), stateHash: hash(state), browserHash: hash(browser), targetAccountId: profileAttempt.targetAccountId,
          nonce: attempt.nonce, codeVerifier: attempt.codeVerifier, redirectUri: attempt.redirectUri,
          admissionExpiresAt: new Date(phaseEnd).toISOString(), ...(enrollmentContext ? { enrollment: enrollmentContext } : {}) });
        profilePhaseLive(identityEnd);
        const expiry = Date.parse(saved?.expiresAt), now = clock();
        if (!saved || !Number.isFinite(expiry) || expiry <= now || expiry > Date.parse(identity.identityExpiresAt) || expiry > now + 300_000) return redirect('uncertain', [clearAttempt()]);
        const seconds = Math.floor((expiry - now) / 1000);
        if (seconds < 1) return redirect('uncertain', [clearAttempt()]);
        return redirect('created', [clearAttempt(), cookie(SESSION_COOKIE, token, seconds, expiry)]);
      }
      if (ticket !== null) return redirect('refused', [clearAttempt()]);
      const identity = await oidc.exchangeAndVerify({ code, codeVerifier: attempt.codeVerifier, nonce: attempt.nonce });
      // The verifier already accepted a current signed identity. Its monotonic
      // security fact must reach storage even if the optional mint expires in
      // this gap; storage separately commits retirement and refuses late mint.
      if (identity.issuer !== PIXEL_ISSUER || !Number.isFinite(Date.parse(identity.identityExpiresAt))) return redirect('refused', [clearAttempt()]);
      const token = fresh();
      const saved = await store.issueBoundSession({ ...identity, tokenHash: hash(token), stateHash: hash(state), browserHash: hash(browser) });
      const expiry = Date.parse(saved?.expiresAt);
      if (!saved || !Number.isFinite(expiry) || expiry <= clock() || expiry > Date.parse(identity.identityExpiresAt) || expiry > clock() + 300_000) return redirect('refused', [clearAttempt()]);
      const seconds = Math.floor((expiry - clock()) / 1000);
      if (seconds < 1) { await store.revokeSession({ tokenHash: hash(token) }); return redirect('refused', [clearAttempt()]); }
      return redirect('returned', [clearAttempt(), cookie(SESSION_COOKIE, token, seconds, expiry)]);
    } catch {
      // Never expose transport errors, SQL, credentials, provider bodies or tickets.
      return callback ? redirect(creating ? 'uncertain' : 'refused', [clearAttempt()]) : json({ error: 'unavailable' }, 503);
    }
  };
}
