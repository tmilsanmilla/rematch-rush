// Process-local Create security fact, not identity/profile/mint authority.
// The factory is a trusted server capability, not a signature verifier. Only a
// verifier which already accepted the fixed signed issuer/subject/epoch and the
// matching UserInfo tuple may mark a fact. JSON, cookies and spread objects do
// not carry this private marker. No expiry/profile/password data is inherited.
const facts = new WeakMap();
const ISSUER = 'https://pixel-pulse-websites.vercel.app/api/sso';
export function createAcceptedIdentityMarker() {
  /** @param {Pick<import('./pixel-contracts.js').PixelIdentity, 'issuer' | 'subject' | 'credentialVersion'>} value
   * @returns {import('./pixel-contracts.js').AcceptedIdentity} */
  const mark = value => {
    if (value?.issuer !== ISSUER || typeof value.subject !== 'string' ||
        !/^[\x21-\x7e]{1,256}$/.test(value.subject) ||
        !Number.isSafeInteger(value.credentialVersion) || value.credentialVersion < 0) {
      throw new Error('Invalid accepted identity fact.');
    }
    const handle = Object.freeze({});
    facts.set(handle, Object.freeze({ issuer: value.issuer, subject: value.subject,
      credentialVersion: value.credentialVersion }));
    return /** @type {import('./pixel-contracts.js').AcceptedIdentity} */ (/** @type {unknown} */ (handle));
  };
  return mark;
}
export function readAcceptedIdentityFact(handle) {
  return handle !== null && typeof handle === 'object' ? facts.get(handle) || null : null;
}
