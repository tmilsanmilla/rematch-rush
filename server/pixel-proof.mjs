import { createHash } from 'node:crypto';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { createOidcClient, PIXEL_ISSUER, PIXEL_CLIENT_ID, PIXEL_CALLBACK, validatePixelJwks } from './pixel-oidc.mjs';

export const PIXEL_FLOW_FIELDS = Object.freeze(['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'nonce',
  'code_challenge', 'code_challenge_method', 'pixel_intent']);
const hash = value => createHash('sha256').update(value).digest('hex');
const input = (value, min, max, pattern) => typeof value === 'string' && value.length >= min && value.length <= max && pattern.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const epoch = value => Number.isSafeInteger(value) && value >= 0;
function fail(code = 'PIXEL_PROOF_REJECTED') {
  const error = new Error('Fresh Pixel confirmation could not be completed.');
  error.name = 'PixelProofError'; error.code = code; throw error;
}

/** The central v1 wire is deliberately ordered and contains exactly nine fields. */
export function freshFlowDigest(flow) {
  if (!object(flow) || Object.keys(flow).length !== PIXEL_FLOW_FIELDS.length ||
      Object.keys(flow).some(field => !PIXEL_FLOW_FIELDS.includes(field)) ||
      PIXEL_FLOW_FIELDS.some(field => !Object.hasOwn(flow, field)) ||
      PIXEL_FLOW_FIELDS.some(field => typeof flow[field] !== 'string') ||
      flow.client_id !== PIXEL_CLIENT_ID || flow.redirect_uri !== PIXEL_CALLBACK || flow.response_type !== 'code' ||
      flow.scope !== 'openid profile email' || flow.pixel_intent !== 'link' || flow.code_challenge_method !== 'S256' ||
      !input(flow.state, 22, 256, /^[A-Za-z0-9_-]+$/) || !input(flow.nonce, 22, 256, /^[A-Za-z0-9_-]+$/) ||
      !input(flow.code_challenge, 43, 43, /^[A-Za-z0-9_-]+$/)) fail();
  return hash(JSON.stringify(Object.fromEntries(PIXEL_FLOW_FIELDS.map(field => [field, flow[field]]))));
}

async function boundedJson(response, url, maximumBytes) {
  if (response?.status !== 200 || response.redirected === true || response.url && response.url !== url ||
      !/^(?:application\/json|application\/jwk-set\+json)(?:\s*;|$)/i.test(response.headers?.get('content-type') || '')) fail('PIXEL_PROOF_UNAVAILABLE');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximumBytes)) fail('PIXEL_PROOF_UNAVAILABLE');
  if (typeof response.body?.getReader !== 'function') fail('PIXEL_PROOF_UNAVAILABLE');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength; if (bytes > maximumBytes) fail('PIXEL_PROOF_UNAVAILABLE'); chunks.push(next.value);
    }
  } catch { try { await reader.cancel(); } catch { /* Already closed. */ } fail('PIXEL_PROOF_UNAVAILABLE'); }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  let parsed; try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result)); }
  catch { fail('PIXEL_PROOF_UNAVAILABLE'); }
  if (!object(parsed)) fail('PIXEL_PROOF_UNAVAILABLE'); return parsed;
}

/** No gate, account, binding or network action is performed by construction. */
export function createFreshProofClient({ issuer = PIXEL_ISSUER, fetchImpl = globalThis.fetch, clock = Date.now,
  requestTimeoutMs = 5_000, allowLocalTestIssuer = false } = {}) {
  // Share the exact production issuer/client/callback and explicit loopback-only
  // test configuration rules with the already reviewed identity verifier.
  createOidcClient({ issuer, fetchImpl, clock, requestTimeoutMs, allowLocalTestIssuer });
  const redeemUrl = `${issuer}/pixel-pulse/redeem-link`, jwksUrl = `${issuer}/jwks`;
  async function request(url, options, maximumBytes) {
    const controller = new AbortController(); let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Timed out.')); }, requestTimeoutMs); });
    const perform = async () => boundedJson(await fetchImpl(url, { ...options,
      headers: { accept: 'application/json', ...options.headers }, redirect: 'error', credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal }), url, maximumBytes);
    try { return await Promise.race([perform(), timeout]); }
    catch { controller.abort(); fail('PIXEL_PROOF_UNAVAILABLE'); } finally { clearTimeout(timer); }
  }

  async function redeem({ ticket, idToken, code, codeVerifier, flow, subject, credentialVersion } = {}) {
    const flowHash = freshFlowDigest(flow);
    if (!input(ticket, 43, 43, /^[A-Za-z0-9_-]+$/) ||
        !input(idToken, 1, 16_384, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/) ||
        !input(code, 1, 2_048, /^[\x21-\x7e]+$/) || !input(codeVerifier, 43, 128, /^[A-Za-z0-9._~-]+$/) ||
        createHash('sha256').update(codeVerifier).digest('base64url') !== flow.code_challenge ||
        !input(subject, 1, 256, /^[\x21-\x7e]+$/) || !epoch(credentialVersion)) fail();
    // Snapshot caller input before any await; changing an object while I/O is
    // pending must not change the original flow or expected signed identity.
    const original = Object.freeze(Object.fromEntries(PIXEL_FLOW_FIELDS.map(field => [field, flow[field]])));
    const response = await request(redeemUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket, idToken, code, codeVerifier, flow: original }) }, 16_384);
    if (!input(response.proof, 1, 8_192, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)) fail();
    let header; try { header = decodeProtectedHeader(response.proof); } catch { fail(); }
    if (header.alg !== 'EdDSA' || !input(header.kid, 1, 128, /^[A-Za-z0-9._-]+$/) ||
        header.typ !== undefined && header.typ !== 'JWT' || Object.keys(header).some(name => !['alg', 'kid', 'typ'].includes(name))) fail();
    const jwks = await request(jwksUrl, {}, 131_072);
    try { validatePixelJwks(jwks); } catch { fail(); }
    const milliseconds = clock(); if (!epoch(milliseconds)) fail(); const seconds = Math.floor(milliseconds / 1_000);
    let p; try {
      ({ payload: p } = await jwtVerify(response.proof, createLocalJWKSet(jwks), { issuer, audience: PIXEL_CLIENT_ID,
        algorithms: ['EdDSA'], currentDate: new Date(milliseconds), clockTolerance: 0,
        requiredClaims: ['iss', 'aud', 'sub', 'jti', 'iat', 'exp', 'purpose', 'link_proof_version', 'intent', 'amr', 'auth_time',
          'credential_version', 'flow_hash', 'oauth_state_hash', 'oauth_nonce_hash', 'pkce_challenge', 'redirect_uri', 'authorization_code_hash'] }));
    } catch { fail(); }
    if (p.iss !== issuer || p.aud !== PIXEL_CLIENT_ID || p.sub !== subject ||
        p.purpose !== 'pixel-pulse-fresh-link' || p.link_proof_version !== 1 || p.intent !== 'link' ||
        !Array.isArray(p.amr) || p.amr.length !== 1 || p.amr[0] !== 'pwd' ||
        !input(p.jti, 36, 36, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/) ||
        !epoch(p.auth_time) || !epoch(p.iat) || !epoch(p.exp) || p.auth_time > seconds || seconds - p.auth_time > 90 ||
        p.iat > seconds || p.iat < p.auth_time || p.exp <= seconds || p.exp <= p.iat || p.exp - p.iat > 30 || p.exp > p.auth_time + 90 ||
        p.credential_version !== credentialVersion || p.flow_hash !== flowHash || p.oauth_state_hash !== hash(original.state) ||
        p.oauth_nonce_hash !== hash(original.nonce) || p.pkce_challenge !== original.code_challenge ||
        p.redirect_uri !== original.redirect_uri || p.authorization_code_hash !== hash(code)) fail();
    const completedAt = clock();
    if (!epoch(completedAt) || completedAt >= p.exp * 1_000 || completedAt < milliseconds) fail();
    return Object.freeze({ issuer, subject, credentialVersion, jti: p.jti, expiresAt: new Date(p.exp * 1_000).toISOString(),
      flowHash, authTime: p.auth_time, issuedAt: p.iat });
  }
  return Object.freeze({ redeem });
}
