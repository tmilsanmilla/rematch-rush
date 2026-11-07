declare const acceptedIdentityBrand: unique symbol;
export interface AcceptedIdentity { readonly [acceptedIdentityBrand]: true }
export interface PixelIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly credentialVersion: number;
  readonly identityExpiresAt: string;
}
export interface StandaloneIdentity extends PixelIdentity { readonly displayName: string }
export interface FreshFlow {
  client_id: 'rematch-rush';
  redirect_uri: 'https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse';
  response_type: 'code'; scope: 'openid profile email';
  state: string; nonce: string; code_challenge: string;
  code_challenge_method: 'S256'; pixel_intent: 'link';
}
export interface FreshProof {
  readonly issuer: string; readonly subject: string; readonly credentialVersion: number;
  readonly jti: string; readonly expiresAt: string; readonly flowHash: string;
  readonly authTime: number; readonly issuedAt: number;
}
export interface ProfileCreation extends StandaloneIdentity {
  acceptedIdentity: AcceptedIdentity;
  proof: FreshProof; expectedFlowHash: string;
  stateHash: string; browserHash: string; tokenHash: string;
  targetAccountId: string; nonce: string; codeVerifier: string; redirectUri: string;
  admissionExpiresAt: string;
}
