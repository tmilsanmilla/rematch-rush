import { createPixelHandler, SITE_ORIGIN } from './pixel-handler.mjs';
import { readTargetConfig } from './pixel-target.mjs';
import { createPostgresStore } from './pixel-store.mjs';
import { createOidcClient } from './pixel-oidc.mjs';
import { createFreshProofClient } from './pixel-proof.mjs';
import { readEnrollmentState } from './pixel-enrollment.mjs';

export function readFirstProfileAdmission(env) {
  const subject = env.REMATCH_PIXEL_FIRST_PROFILE_SUBJECT;
  const start = env.REMATCH_PIXEL_FIRST_PROFILE_STARTS_AT, end = env.REMATCH_PIXEL_FIRST_PROFILE_ENDS_AT;
  const notBeforeMs = Date.parse(start), expiresMs = Date.parse(end);
  if (typeof subject !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(subject) ||
      !Number.isSafeInteger(notBeforeMs) || !Number.isSafeInteger(expiresMs) ||
      new Date(notBeforeMs).toISOString() !== start || new Date(expiresMs).toISOString() !== end ||
      expiresMs <= notBeforeMs || expiresMs - notBeforeMs > 300_000) throw new Error('Unapproved first-profile admission');
  return Object.freeze({ subject, notBeforeMs, expiresAt: end });
}

export function createRuntime(env = process.env, { makeStore = createPostgresStore, makeOidc = createOidcClient, makeProof = createFreshProofClient } = {}) {
  let dependencies;
  const getDependencies = () => {
    if (env.REMATCH_PIXEL_SIGNIN_ENABLED !== 'true' || env.REMATCH_PIXEL_CLIENT_REGISTRATION_APPROVED !== 'true') return null;
    const enrollmentState = readEnrollmentState(env);
    if (!dependencies) {
      const config = readTargetConfig(env);
      const firstProfilesEnabled = env.REMATCH_PIXEL_FIRST_PROFILE_ENABLED === 'true' && env.REMATCH_PIXEL_FRESH_PROOF_APPROVED === 'true';
      const firstProfileHistory = firstProfilesEnabled ? env.REMATCH_PIXEL_FIRST_PROFILE_HISTORY : undefined;
      if (firstProfilesEnabled && !enrollmentState && !/^[a-f0-9]{64}$/.test(firstProfileHistory || '')) throw new Error('Unapproved first-profile history');
      const firstProfileAdmission = firstProfilesEnabled && !enrollmentState ? readFirstProfileAdmission(env) : null;
      const enrollmentHistory = enrollmentState ? env.REMATCH_PIXEL_ENROLLMENT_HISTORY : undefined;
      dependencies = { store: makeStore(config, { firstProfileHistory, enrollmentHistory, readEnrollmentPolicy: () => readEnrollmentState(env) }), oidc: makeOidc({}),
        firstProfilesEnabled, firstProfileAdmission, ...(firstProfilesEnabled ? { proofClient: makeProof({}) } : {}) };
    }
    return { ...dependencies, ...(enrollmentState ? { firstProfilesEnabled: env.REMATCH_PIXEL_FIRST_PROFILE_ENABLED === 'true' && env.REMATCH_PIXEL_FRESH_PROOF_APPROVED === 'true', enrollmentState, readEnrollmentPolicy: () => readEnrollmentState(env) } : {}) };
  };
  return { handle: createPixelHandler({ getDependencies }), close: async () => { await dependencies?.store.close(); } };
}

let runtime;
/** Vercel Web Handler bridge. Each wrapper supplies its fixed route. */
export async function servePixelRequest(request, route) {
  try {
    const incoming = new URL(request.url);
    if (incoming.search.length > 8192) return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    // The route and callback origin never come from Host/forwarded headers.
    const canonical = new Request(`${SITE_ORIGIN}${route}${incoming.search}`, request);
    runtime ||= createRuntime();
    return await runtime.handle(canonical);
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
