// Offline correspondence contract only. No provider import, API or mutation.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {PIXEL_ISSUER,PIXEL_CLIENT_ID,PIXEL_CALLBACK} from '../server/pixel-oidc.mjs';
import {PIXEL_FLOW_FIELDS} from '../server/pixel-proof.mjs';

const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function registrationHandoff(){return freeze({
  status:'UNAPPLIED_REVIEW_HANDOFF_ONLY',owner:'Existing Pixel central owner',
  issuer:PIXEL_ISSUER,
  providerDescriptor:{clientId:PIXEL_CLIENT_ID,redirectUris:[PIXEL_CALLBACK],
    tokenEndpointAuthMethod:'none',requirePKCE:true,grantTypes:['authorization_code'],responseTypes:['code'],
    scopes:['openid','profile','email'],disabled:true},
  centralAdmission:{signInEnabled:false,linkConfirmationEnabled:false,publicCreateEnabled:false,
    confinedTest:'Historical finite path requires separate exact actor/window. Ongoing path independently seals browser discovery then NEW standalone Create; no actor or generation is configured.',
    ongoing:{centralKeys:['PIXEL_PULSE_REMATCH_SSO_ENABLED','PIXEL_PULSE_REMATCH_SSO_GENERATION'],receiverKeys:['REMATCH_PIXEL_ENROLLMENT_ENABLED','REMATCH_PIXEL_ENROLLMENT_GENERATION'],seconds:300,alignedUtcWindow:true,independentGenerations:true,discoveryProvisions:false,explicitNewCreate:true,v1PolicyAttestation:false}},
  callback:{url:PIXEL_CALLBACK,method:'GET',allowedQuery:['code','state','iss','error','error_description','pixel_link_ticket'],
    requireOneUseBrowserState:true,requireNonce:true,requireS256:true,noArbitraryRedirect:true},
  proof:{version:1,intent:'link',flowFields:[...PIXEL_FLOW_FIELDS],
    redeemEndpoint:`${PIXEL_ISSUER}/pixel-pulse/redeem-link`,jwksEndpoint:`${PIXEL_ISSUER}/jwks`,
    purpose:'pixel-pulse-fresh-link',amr:['pwd'],maxPasswordAgeSeconds:90,maxProofLifetimeSeconds:30,
    requiredBinding:['issuer','scalarAudience','subject','credentialEpoch','stateHash','nonceHash','PKCE','codeHash','callback','flowHash'],
    nativeLink:false,standaloneProfile:'Explicit receiving Create only; central intent=link is the unchanged proof-wire term.'},
  sessions:{maxSeconds:300,alsoBoundToOriginalSignedIdExpiry:true,refresh:false,offlineAccess:false,continuousGlobalRetirementClaim:false},
  operatorReceiptRequired:['Exact central source/registry mapping and reviewed disabled descriptor',
    'Separately reviewed dedicated target/history/roles/effective privileges',
    'Actual separately authorized native first-profile/transport evidence',
    'Exact ongoing producer/receiver enabled correspondence and independently sealed original actor/epoch/generation/window; known-bound return survives first closure',
    'Root-owned explicit genuine identity/inbox/at-most-one-send checkpoint',
    'Separate serial release authority and both applicable budget/history gates'],
  applied:false,credentialsIncluded:false
});}
export function validateRegistrationCorrespondence(value){
  // Accept only this exact public descriptor projection, not account secrets,
  // URLs, mutable registry handles, broad feature flags or implied activation.
  if(!value||!isDeepStrictEqual(value,registrationHandoff().providerDescriptor))throw new Error('Registration correspondence refused.');
  return Object.freeze({valid:true,applied:false,publicActivation:false});
}
export async function registrationCli(args=[]){
  if(args.length===0||args.length===1&&args[0]==='--plan')return registrationHandoff();
  if(args.length===2&&args[0]==='--check')return validateRegistrationCorrespondence(JSON.parse(await readFile(args[1],'utf8')));
  throw new Error('Use --plan or --check <local descriptor JSON>; no apply command exists.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(await registrationCli(process.argv.slice(2)),null,2));}
  catch{console.error('Offline registration handoff refused.');process.exitCode=1;}
}
