// Synthetic in-process issuer transport for the REAL receiver/verifiers.
// No HTTP listener/fetch fallback, passwords, managed account or genuine proof.
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {generateKeyPair, exportJWK, SignJWT, jwtVerify} from 'jose';
import {createPixelHandler, SITE_ORIGIN, ATTEMPT_COOKIE, SESSION_COOKIE} from '../../server/pixel-handler.mjs';
import {createOidcClient, PIXEL_ISSUER, PIXEL_CLIENT_ID, PIXEL_CALLBACK} from '../../server/pixel-oidc.mjs';
import {createFreshProofClient, freshFlowDigest, PIXEL_FLOW_FIELDS} from '../../server/pixel-proof.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const pkce=value=>createHash('sha256').update(value).digest('base64url');
const fresh=()=>randomBytes(32).toString('base64url');
const json=value=>Response.json(value,{headers:{'cache-control':'no-store'}});

export async function createSyntheticProfileTransport({store,subject='synthetic_transport_player',clock=Date.now,credentialVersion=1,enrollmentPolicy,onFetch}={}) {
  assert.ok(store && typeof store.createStandaloneProfile==='function');
  assert.ok(/^synthetic_[A-Za-z0-9_]{1,200}$/.test(subject)||enrollmentPolicy&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(subject));
  assert.ok(Number.isSafeInteger(credentialVersion) && credentialVersion>=0);
  const keys=await generateKeyPair('EdDSA',{extractable:true});
  const wrongKeys=await generateKeyPair('EdDSA');
  const jwk={...await exportJWK(keys.publicKey),kid:'synthetic-profile-transport',alg:'EdDSA',use:'sig'};
  const codes=new Map(),accesses=new Map(),handles=new WeakMap(),jar=new Map();
  const counts={authorize:0,exchange:0,proof:0,userInfo:0};
  let fault=null;
  const admission=Object.freeze({subject,notBeforeMs:clock()-1000,expiresAt:new Date(clock()+299000).toISOString()});
  async function sign(payload){return new SignJWT(payload).setProtectedHeader({alg:'EdDSA',kid:jwk.kid,typ:'JWT'}).sign(fault==='signature'?wrongKeys.privateKey:keys.privateKey);}
  const fetchImpl=async(url,options={})=>{
    // Deliberately no call to global fetch, sockets, or any injected live issuer.
    assert.equal(new URL(url).origin+new URL(url).pathname,url);
    await onFetch?.(url,options);
    assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    assert.equal(new Headers(options.headers).has('cookie'),false);
    if(url===`${PIXEL_ISSUER}/.well-known/openid-configuration`)return json({issuer:PIXEL_ISSUER,
      authorization_endpoint:`${PIXEL_ISSUER}/oauth2/authorize`,token_endpoint:`${PIXEL_ISSUER}/oauth2/token`,
      userinfo_endpoint:`${PIXEL_ISSUER}/oauth2/userinfo`,jwks_uri:`${PIXEL_ISSUER}/jwks`,response_types_supported:['code'],
      grant_types_supported:['authorization_code'],code_challenge_methods_supported:['S256'],id_token_signing_alg_values_supported:['EdDSA'],token_endpoint_auth_methods_supported:['none']});
    if(url===`${PIXEL_ISSUER}/jwks`)return json({keys:[jwk]});
    if(url===`${PIXEL_ISSUER}/oauth2/token`){
      counts.exchange++;assert.equal(options.method,'POST');
      const p=new URLSearchParams(options.body),row=codes.get(p.get('code'));
      assert.equal(p.size,5);assert.equal(p.get('grant_type'),'authorization_code');assert.equal(p.get('client_id'),PIXEL_CLIENT_ID);assert.equal(p.get('redirect_uri'),PIXEL_CALLBACK);
      assert.ok(row&&!row.exchanged&&pkce(p.get('code_verifier')||'')===row.flow.code_challenge);row.exchanged=true;
      const iat=Math.floor(clock()/1000),token=fresh();
      row.payload={iss:PIXEL_ISSUER,aud:PIXEL_CLIENT_ID,sub:subject,iat,exp:iat+240,nonce:row.flow.nonce,
        credential_version:credentialVersion,email:'synthetic@example.invalid',email_verified:true,
        preferred_username:'synthetic player',name:'synthetic player'};
      row.idToken=await sign(row.payload);accesses.set(token,row);
      return json({id_token:row.idToken,access_token:token,token_type:'Bearer',expires_in:240});
    }
    if(url===`${PIXEL_ISSUER}/oauth2/userinfo`){
      counts.userInfo++;const token=new Headers(options.headers).get('authorization')?.replace(/^Bearer /,'');const row=accesses.get(token);assert.ok(row);
      return json({...row.payload,...(fault==='profile'?{name:'invalid!',preferred_username:'invalid!'}:{})});
    }
    if(url===`${PIXEL_ISSUER}/pixel-pulse/redeem-link`){
      counts.proof++;assert.equal(options.method,'POST');const b=JSON.parse(options.body),row=codes.get(b.code);
      assert.deepEqual(Object.keys(b).sort(),['ticket','idToken','code','codeVerifier','flow'].sort());
      assert.ok(row&&row.exchanged&&!row.redeemed&&row.ticket===b.ticket&&row.idToken===b.idToken);
      assert.deepEqual(b.flow,row.flow);assert.equal(pkce(b.codeVerifier),row.flow.code_challenge);
      const {payload}=await jwtVerify(b.idToken,keys.publicKey,{issuer:PIXEL_ISSUER,audience:PIXEL_CLIENT_ID,algorithms:['EdDSA'],currentDate:new Date(clock())});
      assert.equal(payload.sub,subject);assert.equal(payload.nonce,row.flow.nonce);row.redeemed=true;
      const iat=Math.floor(clock()/1000),flowHash=freshFlowDigest(row.flow);
      const proof=await sign({iss:PIXEL_ISSUER,aud:PIXEL_CLIENT_ID,sub:subject,jti:randomUUID(),iat,exp:iat+25,
        purpose:'pixel-pulse-fresh-link',link_proof_version:1,intent:'link',amr:['pwd'],auth_time:row.authTime,
        credential_version:credentialVersion,flow_hash:fault==='proof-flow'?hash('wrong'):flowHash,
        oauth_state_hash:hash(row.flow.state),oauth_nonce_hash:hash(row.flow.nonce),pkce_challenge:row.flow.code_challenge,
        redirect_uri:PIXEL_CALLBACK,authorization_code_hash:hash(b.code)});
      return json({proof});
    }
    throw new Error('Synthetic transport endpoint refused; no network fallback.');
  };
  const oidc=createOidcClient({fetchImpl,clock}),proofClient=createFreshProofClient({fetchImpl,clock});
  const handler=createPixelHandler({clock,getDependencies:()=>({store,oidc,proofClient,firstProfilesEnabled:true,firstProfileAdmission:admission,...(enrollmentPolicy?{enrollmentState:enrollmentPolicy(),readEnrollmentPolicy:enrollmentPolicy}:{})})});
  async function deliver(route,{method='GET',body,cookieOverride}={}){
    const response=await handler(new Request(SITE_ORIGIN+route,{method,headers:{
      ...(body===undefined?{}:{origin:SITE_ORIGIN,'content-type':'application/json'}),
      cookie:cookieOverride??[...jar].map(([k,v])=>`${k}=${v}`).join('; ')},...(body===undefined?{}:{body:JSON.stringify(body)})}));
    for(const value of response.headers.getSetCookie()){
      const first=value.split(';',1)[0],at=first.indexOf('='),name=first.slice(0,at),v=first.slice(at+1);
      if(/Max-Age=0(?:;|$)/.test(value))jar.delete(name);else jar.set(name,v);
    }
    return response;
  }
  async function begin(create,discovery=false){
    const response=await deliver(`/api/auth/pixel-pulse/${discovery?'discover':create?'create':'start'}`,{method:'POST',body:create?{intent:'create',acknowledgeSeparateProfile:true}:{}});
    assert.equal(response.status,200);const auth=new URL((await response.json()).url),flow=Object.fromEntries(auth.searchParams);
    assert.equal(auth.origin+auth.pathname,`${PIXEL_ISSUER}/oauth2/authorize`);
    assert.deepEqual(Object.keys(flow).sort(),(create?PIXEL_FLOW_FIELDS:PIXEL_FLOW_FIELDS.slice(0,-1)).slice().sort());
    assert.equal(flow.client_id,PIXEL_CLIENT_ID);assert.equal(flow.redirect_uri,PIXEL_CALLBACK);assert.equal(flow.code_challenge_method,'S256');
    if(create)freshFlowDigest(flow);
    const handle=Object.freeze({});handles.set(handle,{flow,create,browser:jar.get(ATTEMPT_COOKIE),callback:null});return handle;
  }
  async function complete(handle){
    const owned=handles.get(handle);assert.ok(owned&&!owned.callback,'Owned uncompleted authorization required');
    counts.authorize++;const code=fresh(),ticket=owned.create?fresh():null;
    codes.set(code,{flow:owned.flow,ticket,authTime:Math.floor(clock()/1000),exchanged:false,redeemed:false});
    const callback=new URL(PIXEL_CALLBACK);callback.search=new URLSearchParams({code,state:owned.flow.state,iss:PIXEL_ISSUER,...(ticket?{pixel_link_ticket:ticket}:{})}).toString();
    owned.callback=callback.pathname+callback.search;
    return deliver(owned.callback);
  }
  return Object.freeze({beginDiscovery:()=>begin(false,true),beginCreate:()=>begin(true),beginReturn:()=>begin(false),complete,
    replay:handle=>{const owned=handles.get(handle);assert.ok(owned?.callback);return deliver(owned.callback,{cookieOverride:`${ATTEMPT_COOKIE}=${owned.browser}`});},
    post:(route,body)=>deliver('/api/auth/pixel-pulse/'+route,{method:'POST',body}),
    session:()=>deliver('/api/auth/pixel-pulse/session'),signOut:()=>deliver('/api/auth/pixel-pulse/sign-out',{method:'POST',body:{}}),
    setSyntheticActor(value){assert.ok(enrollmentPolicy&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.subject)&&Number.isSafeInteger(value.credentialVersion)&&value.credentialVersion>=0);subject=value.subject;credentialVersion=value.credentialVersion;},
    stats:()=>Object.freeze({...counts,sessionCookiePresent:jar.has(SESSION_COOKIE)}),
    setFault:value=>{assert.ok([null,'signature','profile','proof-flow'].includes(value));fault=value;}
  });
}
