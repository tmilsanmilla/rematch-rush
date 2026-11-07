import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { createAcceptedIdentityMarker } from './pixel-accepted-identity.mjs';

export const PIXEL_ISSUER = 'https://pixel-pulse-websites.vercel.app/api/sso';
export const PIXEL_CLIENT_ID = 'rematch-rush';
export const PIXEL_CALLBACK = 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse';

const GENERAL_ERROR = 'Pixel sign-in could not be completed.';
const endpoint = (issuer, path) => `${issuer}${path}`;
const fail = (code) => {
  const error = new Error(GENERAL_ERROR);
  error.name = 'PixelOidcError';
  error.code = code;
  throw error;
};
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const secretInput = (value, min, max, pattern) => typeof value === 'string' && value.length >= min && value.length <= max && pattern.test(value);
const flowInput = value => secretInput(value, 22, 256, /^[A-Za-z0-9_-]+$/);
const emailClaim = value => typeof value === 'string' && value.length <= 254 && /^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+$/.test(value);
const epoch = value => Number.isSafeInteger(value) && value >= 0;

function validateConfiguration(issuer, clientId, redirectUri, allowLocalTestIssuer) {
  if (clientId !== PIXEL_CLIENT_ID || redirectUri !== PIXEL_CALLBACK) fail('PIXEL_OIDC_CONFIGURATION');
  if (issuer === PIXEL_ISSUER) return;
  let local;
  try { local = new URL(issuer); } catch { fail('PIXEL_OIDC_CONFIGURATION'); }
  if (process.env.NODE_ENV !== 'test' || allowLocalTestIssuer !== true ||
      local.protocol !== 'http:' || local.hostname !== '127.0.0.1' ||
      local.pathname !== '/api/sso' || local.username || local.password || local.search || local.hash ||
      issuer !== `${local.origin}/api/sso`) fail('PIXEL_OIDC_CONFIGURATION');
}

async function readJson(response, maximumBytes) {
  if (!response || response.status !== 200 || response.redirected === true ||
      !/^(?:application\/json|application\/jwk-set\+json)(?:\s*;|$)/i.test(response.headers?.get('content-type') || '')) {
    fail('PIXEL_OIDC_UNAVAILABLE');
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) fail('PIXEL_OIDC_UNAVAILABLE');
  if (!response.body || typeof response.body.getReader !== 'function') fail('PIXEL_OIDC_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) fail('PIXEL_OIDC_UNAVAILABLE');
      chunks.push(value);
    }
  } catch {
    // Cancel before dropping an oversized or failed response. No response text is
    // used in errors because it may contain an authorization code or identity.
    try { await reader.cancel(); } catch { /* The stream may already be closed. */ }
    fail('PIXEL_OIDC_UNAVAILABLE');
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('PIXEL_OIDC_UNAVAILABLE'); }
  if (!plainObject(parsed)) fail('PIXEL_OIDC_UNAVAILABLE');
  return parsed;
}

function validateDiscovery(discovery, issuer) {
  const exact = {
    issuer,
    authorization_endpoint: endpoint(issuer, '/oauth2/authorize'),
    token_endpoint: endpoint(issuer, '/oauth2/token'),
    userinfo_endpoint: endpoint(issuer, '/oauth2/userinfo'),
    jwks_uri: endpoint(issuer, '/jwks'),
  };
  if (Object.entries(exact).some(([name, expected]) => discovery[name] !== expected)) fail('PIXEL_OIDC_UNAVAILABLE');
  for (const [name, required] of [
    ['response_types_supported', 'code'], ['grant_types_supported', 'authorization_code'],
    ['code_challenge_methods_supported', 'S256'], ['id_token_signing_alg_values_supported', 'EdDSA'],
    ['token_endpoint_auth_methods_supported', 'none'],
  ]) {
    if (!Array.isArray(discovery[name]) || !discovery[name].includes(required)) fail('PIXEL_OIDC_UNAVAILABLE');
  }
}

export function validatePixelJwks(jwks) {
  if (!Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 8) fail('PIXEL_IDENTITY_REJECTED');
  const ids = new Set();
  for (const key of jwks.keys) {
    if (!plainObject(key) || key.kty !== 'OKP' || key.crv !== 'Ed25519' ||
        !secretInput(key.kid, 1, 128, /^[A-Za-z0-9._-]+$/) || ids.has(key.kid) ||
        !secretInput(key.x, 43, 43, /^[A-Za-z0-9_-]+$/) ||
        key.d !== undefined || key.jku !== undefined || key.x5u !== undefined ||
        (key.alg !== undefined && key.alg !== 'EdDSA') ||
        (key.use !== undefined && key.use !== 'sig') ||
        (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify'))) {
      fail('PIXEL_IDENTITY_REJECTED');
    }
    ids.add(key.kid);
  }
}

/**
 * A fixed public OIDC verifier. It never creates/binds an account, accepts
 * identity from the browser, or requests a refresh token. Ordinary return exposes
 * only immutable identity. Explicit profile exchange adds a verified name and
 * a server-only ID token for the separate fresh-password proof transport.
 */
export function createOidcClient({
  issuer = PIXEL_ISSUER,
  clientId = PIXEL_CLIENT_ID,
  redirectUri = PIXEL_CALLBACK,
  fetchImpl = globalThis.fetch,
  allowLocalTestIssuer = false,
  clock = Date.now,
  requestTimeoutMs = 5_000,
} = {}) {
  validateConfiguration(issuer, clientId, redirectUri, allowLocalTestIssuer);
  if (typeof fetchImpl !== 'function' || typeof clock !== 'function' ||
      !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 10 || requestTimeoutMs > 5_000) {
    fail('PIXEL_OIDC_CONFIGURATION');
  }

  async function jsonRequest(url, options = {}, maximumBytes = 32_768) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(GENERAL_ERROR));
      }, requestTimeoutMs);
    });
    const perform = async () => {
      const response = await fetchImpl(url, {
        ...options,
        headers: { accept: 'application/json', ...options.headers },
        redirect: 'error', credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      if (response?.url && response.url !== url) fail('PIXEL_OIDC_UNAVAILABLE');
      return readJson(response, maximumBytes);
    };
    try { return await Promise.race([perform(), timeout]); }
    catch { controller.abort(); fail('PIXEL_OIDC_UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }

  function authorizationUrl({ state, nonce, codeChallenge, pixelIntent } = {}) {
    if (!flowInput(state) || !flowInput(nonce) || !secretInput(codeChallenge, 43, 43, /^[A-Za-z0-9_-]+$/)) {
      fail('PIXEL_FLOW_REJECTED');
    }
    if (pixelIntent !== undefined && pixelIntent !== 'link') fail('PIXEL_FLOW_REJECTED');
    const url = new URL(endpoint(issuer, '/oauth2/authorize'));
    url.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: 'openid profile email', state, nonce,
      code_challenge: codeChallenge, code_challenge_method: 'S256',
      ...(pixelIntent === 'link' ? { pixel_intent: 'link' } : {}),
    }).toString();
    return url.href;
  }

  const markAcceptedIdentity = createAcceptedIdentityMarker();
  async function exchange({ code, codeVerifier, nonce, onAcceptedIdentity } = {}, includeProfile = false) {
    if (onAcceptedIdentity !== undefined && (!includeProfile || typeof onAcceptedIdentity !== 'function')) fail('PIXEL_FLOW_REJECTED');
    if (!secretInput(code, 1, 2_048, /^[\x21-\x7e]+$/) ||
        !secretInput(codeVerifier, 43, 128, /^[A-Za-z0-9._~-]+$/) || !flowInput(nonce)) fail('PIXEL_FLOW_REJECTED');
    const discovery = await jsonRequest(endpoint(issuer, '/.well-known/openid-configuration'));
    validateDiscovery(discovery, issuer);
    const token = await jsonRequest(endpoint(issuer, '/oauth2/token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId,
        redirect_uri: redirectUri, code, code_verifier: codeVerifier }).toString(),
    });
    if (!secretInput(token.id_token, 1, 16_384, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) ||
        !secretInput(token.access_token, 1, 16_384, /^[\x21-\x7e]+$/) ||
        typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') fail('PIXEL_IDENTITY_REJECTED');
    let header;
    try { header = decodeProtectedHeader(token.id_token); }
    catch { fail('PIXEL_IDENTITY_REJECTED'); }
    if (header.alg !== 'EdDSA' || !secretInput(header.kid, 1, 128, /^[A-Za-z0-9._-]+$/) ||
        (header.typ !== undefined && header.typ !== 'JWT') ||
        Object.keys(header).some(name => !['alg', 'kid', 'typ'].includes(name))) fail('PIXEL_IDENTITY_REJECTED');
    const jwks = await jsonRequest(endpoint(issuer, '/jwks'), {}, 131_072);
    validatePixelJwks(jwks);
    const nowMilliseconds = clock();
    if (!Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0) fail('PIXEL_IDENTITY_REJECTED');
    const now = Math.floor(nowMilliseconds / 1_000);
    let payload;
    try {
      ({ payload } = await jwtVerify(token.id_token, createLocalJWKSet(jwks), {
        issuer, audience: clientId, algorithms: ['EdDSA'], currentDate: new Date(nowMilliseconds),
        requiredClaims: ['iss', 'sub', 'aud', 'iat', 'exp', 'nonce', 'credential_version', 'email', 'email_verified'],
      }));
    } catch { fail('PIXEL_IDENTITY_REJECTED'); }
    if (payload.iss !== issuer || payload.aud !== clientId || payload.nonce !== nonce ||
        (payload.azp !== undefined && payload.azp !== clientId) ||
        !secretInput(payload.sub, 1, 256, /^[\x21-\x7e]+$/) ||
        !epoch(payload.credential_version) || !epoch(payload.iat) || !epoch(payload.exp) ||
        payload.iat > now || payload.exp <= now || payload.exp <= payload.iat || payload.exp > 8_640_000_000_000 ||
        payload.email_verified !== true || !emailClaim(payload.email)) fail('PIXEL_IDENTITY_REJECTED');
    const info = await jsonRequest(endpoint(issuer, '/oauth2/userinfo'), {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    // The minimal signed fact survives optional profile/email validation and
    // later expiry. It is security-only: no profile, binding or mint authority.
    if (info.sub !== payload.sub || info.credential_version !== payload.credential_version ||
        (info.iss !== undefined && info.iss !== issuer)) fail('PIXEL_IDENTITY_REJECTED');
    const acceptedIdentity = includeProfile ? markAcceptedIdentity({ issuer, subject: payload.sub, credentialVersion: payload.credential_version }) : null;
    if (includeProfile && onAcceptedIdentity) await onAcceptedIdentity(acceptedIdentity);
    if (info.email_verified !== true || info.email !== payload.email) fail('PIXEL_IDENTITY_REJECTED');
    const completedAt = clock();
    if (!Number.isSafeInteger(completedAt) || completedAt < 0 || completedAt >= payload.exp * 1_000) fail('PIXEL_IDENTITY_REJECTED');
    // Ordinary return exposes no email/profile/roles or provider tokens. The
    // separate explicit profile exchange below adds only a verified name and
    // a server-only ID token; neither is native ownership or adoption authority.
    const identity = { issuer, subject: payload.sub, credentialVersion: payload.credential_version,
      identityExpiresAt: new Date(payload.exp * 1_000).toISOString() };
    if (!includeProfile) return Object.freeze(identity);
    if (includeProfile === 'discovery') return Object.freeze({ identity: Object.freeze(identity), acceptedIdentity });
    // This optional name is authenticated central profile data, never an email
    // lookup, local-profile ownership proof, role or browser-progress import.
    const canonical = value => typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
    const displayName = canonical(info.preferred_username);
    if (!/^[a-z0-9_ ]{3,25}$/.test(displayName) || canonical(info.name) !== displayName ||
        (payload.preferred_username !== undefined && canonical(payload.preferred_username) !== displayName) ||
        (payload.name !== undefined && canonical(payload.name) !== displayName)) fail('PIXEL_IDENTITY_REJECTED');
    return Object.freeze({ identity: Object.freeze({ ...identity, displayName }), idToken: token.id_token, acceptedIdentity });
  }

  /** @returns {Promise<Readonly<import('./pixel-contracts.js').PixelIdentity>>} */
  async function exchangeAndVerify(options) {
    const result = await exchange(options, false);
    if ('identity' in result) fail('PIXEL_IDENTITY_REJECTED');
    return result;
  }
  /** @returns {Promise<Readonly<{identity: Readonly<import('./pixel-contracts.js').StandaloneIdentity>, idToken: string, acceptedIdentity: import('./pixel-contracts.js').AcceptedIdentity}>>} */
  async function exchangeForProfile(options) {
    const result = await exchange(options, true);
    if (!('identity' in result)) fail('PIXEL_IDENTITY_REJECTED');
    return result;
  }
  /** @returns {Promise<Readonly<{identity: Readonly<import('./pixel-contracts.js').PixelIdentity>, acceptedIdentity: import('./pixel-contracts.js').AcceptedIdentity}>>} */
  async function exchangeForDiscovery(options) {
    const result = await exchange(options, 'discovery');
    if (!('identity' in result) || !result.acceptedIdentity) fail('PIXEL_IDENTITY_REJECTED');
    return Object.freeze({ identity: result.identity, acceptedIdentity: result.acceptedIdentity });
  }
  return Object.freeze({ authorizationUrl, exchangeAndVerify, exchangeForProfile, exchangeForDiscovery });
}
