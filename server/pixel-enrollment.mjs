// Receiver-owned enrollment policy. Never an identity or central v1 attestation.
export const ENROLLMENT_SECONDS = 300;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function readEnrollmentState(env = {}) {
  const enabled = env.REMATCH_PIXEL_ENROLLMENT_ENABLED, generation = env.REMATCH_PIXEL_ENROLLMENT_GENERATION;
  if (enabled === undefined && generation === undefined) return null;
  return Object.freeze({ configured: true, valid: ['true','false'].includes(enabled) && typeof generation === 'string' && uuid.test(generation),
    enabled: enabled === 'true', generation });
}
export function captureEnrollmentWindow(state, now) {
  if (!state?.valid || !state.enabled || !Number.isSafeInteger(now) || now < 0 || now > 8640000000000000-300000) throw new Error('Enrollment unavailable');
  const notBeforeMs = Math.floor(now / 300000) * 300000;
  return Object.freeze({ generation: state.generation, notBeforeMs, expiresAt: new Date(notBeforeMs + 300000).toISOString() });
}
export function assertEnrollmentWindow(readCurrent, snapshot, now, caps = []) {
  const current = readCurrent();
  const start = snapshot?.notBeforeMs, end = Date.parse(snapshot?.expiresAt);
  const cutoff = Math.min(end, ...caps.map(value => typeof value === 'number' ? value : Date.parse(value)));
  if (!current?.valid || !current.enabled || current.generation !== snapshot?.generation || !uuid.test(snapshot?.generation || '') ||
      !Number.isSafeInteger(start) || start < 0 || start % 300000 !== 0 || end !== start + 300000 ||
      !Number.isSafeInteger(now) || !Number.isFinite(cutoff) || now < start || now >= cutoff) throw new Error('Original enrollment closed');
  return cutoff;
}
