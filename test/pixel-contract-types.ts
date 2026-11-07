import type { PixelIdentity, StandaloneIdentity, AcceptedIdentity, FreshProof, FreshFlow, ProfileCreation } from '../server/pixel-contracts.js';
import { createOidcClient } from '../server/pixel-oidc.mjs';
import { createFreshProofClient } from '../server/pixel-proof.mjs';
import { createPixelHandler } from '../server/pixel-handler.mjs';
const oidc = createOidcClient();
const proofClient = createFreshProofClient();
declare const flow: FreshFlow;
declare const creation: ProfileCreation;
const flowCopy: FreshFlow = { ...flow };
// @ts-expect-error First-profile wire is the reviewed v1 link intent, never a new protocol value.
const wrongIntent: FreshFlow = { ...flow, pixel_intent: 'create' };
// @ts-expect-error Rematch has no receiving native password or adoption field.
const noNativeAdoption: ProfileCreation = { ...creation, nativePassword: 'forbidden' };
async function verifyPublicShapes(): Promise<void> {
  const identity: Readonly<PixelIdentity> = await oidc.exchangeAndVerify({ code: 'code', codeVerifier: 'verifier', nonce: 'nonce' });
  const discovery: Readonly<{identity: Readonly<PixelIdentity>; acceptedIdentity: AcceptedIdentity}> = await oidc.exchangeForDiscovery({ code: 'code', codeVerifier: 'verifier', nonce: 'nonce' });
  void discovery;
  const profile: Readonly<{ identity: Readonly<StandaloneIdentity>; idToken: string; acceptedIdentity: AcceptedIdentity }> = await oidc.exchangeForProfile({ code: 'code', codeVerifier: 'verifier', nonce: 'nonce' });
  const proof: Readonly<FreshProof> = await proofClient.redeem({ ticket: 'ticket', idToken: profile.idToken, code: 'code', codeVerifier: 'verifier', flow: flowCopy, subject: identity.subject, credentialVersion: identity.credentialVersion });
  const complete: ProfileCreation = { ...creation, ...profile.identity, acceptedIdentity: profile.acceptedIdentity, proof };
  // @ts-expect-error Browser JSON cannot construct the opaque server-only accepted identity handle.
  const forgedFact: AcceptedIdentity = { issuer: identity.issuer, subject: identity.subject, credentialVersion: identity.credentialVersion };
  void forgedFact;
  void complete; void wrongIntent; void noNativeAdoption;
}
const handler: (request: Request) => Promise<Response> = createPixelHandler({ getDependencies: () => null });
void handler; void verifyPublicShapes;
