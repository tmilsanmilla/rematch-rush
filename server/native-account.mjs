import {createAbuseGuard} from './pixel-abuse.mjs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
export const BROWSER_COOKIE='__Host-rematch-native-browser';
export const NATIVE_COOKIE='__Host-rematch-account-session';
export const NATIVE_SESSION_MS=300000;
export const hashToken=s=>createHash('sha256').update(s).digest('hex');
const ORIGIN='https://rematch-rush.vercel.app',opaque=/^[A-Za-z0-9_-]{43}$/;
export function readNativeConfig(env){
 if(env.REMATCH_NATIVE_AUTH_APPROVED!=='true')return null;
 const base=new URL(env.REMATCH_NATIVE_AUTH_URL),jwks=new URL(env.REMATCH_NATIVE_JWKS_URL);
 if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!base.hostname.endsWith('.neon.tech')||!base.pathname.endsWith('/auth')||jwks.origin!==base.origin||jwks.username||jwks.password||jwks.search||jwks.hash||!jwks.pathname.startsWith(base.pathname+'/')||env.REMATCH_NATIVE_ISSUER!==base.href||typeof env.REMATCH_NATIVE_AUDIENCE!=='string'||!env.REMATCH_NATIVE_AUDIENCE||!/^[a-f0-9]{64}$/.test(env.REMATCH_NATIVE_SCHEMA_HISTORY||''))throw Error('Unapproved Rematch native authority');
 return Object.freeze({baseUrl:base.href,issuer:env.REMATCH_NATIVE_ISSUER,audience:env.REMATCH_NATIVE_AUDIENCE,jwksUrl:jwks.href,history:env.REMATCH_NATIVE_SCHEMA_HISTORY});
}
export function createNativeVerifier(config,{keySet=createRemoteJWKSet(new URL(config.jwksUrl)),clock=()=>Date.now()}={}){
 return async token=>{
  if(typeof token!=='string'||token.length>16384)throw Error('Invalid sign-in');
  const {payload:p}=await jwtVerify(token,keySet,{issuer:config.issuer,audience:config.audience,algorithms:['EdDSA'],clockTolerance:0,maxTokenAge:'15m',currentDate:new Date(clock())});
  if(typeof p.sub!=='string'||!p.sub||p.sub.length>255||p.emailVerified!==true&&p.email_verified!==true||!Number.isSafeInteger(p.exp)||!Number.isSafeInteger(p.iat)||p.iat*1000>clock()||p.exp*1000<=clock()||p.exp-p.iat>900)throw Error('Verify your email before continuing.');
  return Object.freeze({issuer:config.issuer,subject:p.sub,expiresAt:p.exp*1000,issuedAt:p.iat*1000,name:typeof p.name==='string'?p.name.trim().slice(0,18):'Player'});
 };
}
const cookie=(token,end,now=Date.now())=>`${NATIVE_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0,Math.floor((end-now)/1000))}; Expires=${new Date(end).toUTCString()}`;
const tokenFrom=(request,name)=>{const rows=(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));return rows.length===1&&opaque.test(rows[0].slice(name.length+1))?rows[0].slice(name.length+1):null;};
export function createNativeHandler({getDependencies,clock=()=>Date.now()}){
 const abuse=createAbuseGuard({clock,perKey:30,total:180});
 return async request=>{
  const action=new URL(request.url).pathname.split('/').at(-1),read=action==='config'||action==='session';
  const reply=(body,status=200,cookies=[])=>{const h=new Headers({'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});for(const v of cookies)h.append('Set-Cookie',v);return new Response(JSON.stringify(body),{status,headers:h});};
  if(!['config','session','start','login','create','claim','sign-out'].includes(action))return reply({error:'Not found'},404);
  if(request.method!==(read?'GET':'POST'))return reply({error:'Method not allowed'},405);
  if(!read&&(request.headers.get('origin')!==ORIGIN||request.headers.get('content-type')?.split(';')[0]!=='application/json'))return reply({error:'Invalid request origin'},403);
  try{
   const deps=getDependencies();if(!deps)return reply({enabled:false,error:'Rematch email/password sign-in is not configured yet.'},503);
   if(action==='config')return reply({enabled:true,authUrl:deps.config.baseUrl});
   const token=tokenFrom(request,NATIVE_COOKIE),browser=tokenFrom(request,BROWSER_COOKIE);
   if(action==='session'){const s=token?await deps.store.session(hashToken(token)):null;return reply({enabled:true,authenticated:!!s,...(s?{expiresAt:s.expiresAt}: {})});}
   const text=await request.text();if(Buffer.byteLength(text)>20000)return reply({error:'Request too large'},413);
   const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'Invalid request'},400);if(!abuse.admit(browser?hashToken(browser):'anonymous',1))return reply({error:'Too many sign-in attempts. Wait a minute.'},429);
   if(action==='sign-out'){const legacy=tokenFrom(request,'__Host-rematch-pixel-session');await deps.store.revoke(token?hashToken(token):null,browser?hashToken(browser):null,legacy?hashToken(legacy):null);return reply({ok:true},200,[cookie('',0),'__Host-rematch-pixel-session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0']);}
   if(action==='start'){if(!['login','create','claim'].includes(body.mode)||Object.keys(body).some(k=>k!=='mode'))return reply({error:'Choose sign-in or explicit account setup.'},400);const rawBrowser=browser||randomBytes(32).toString('base64url'),flow=randomBytes(32).toString('base64url');await deps.store.begin({browserHash:hashToken(rawBrowser),flowHash:hashToken(flow),mode:body.mode});return reply({flow},200,[`${BROWSER_COOKIE}=${rawBrowser}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=604800`]);}
   if(Object.keys(body).some(k=>!['token','flow'].includes(k))||!browser||!opaque.test(body.flow||''))return reply({error:'Invalid sign-in fields'},400);
   const identity=await deps.verify(body.token);if(identity.expiresAt<=clock())throw Error('Sign in again.');
   const raw=randomBytes(32).toString('base64url'),end=Math.min(identity.expiresAt,clock()+NATIVE_SESSION_MS);
   // The original game session is proof only for this explicit migration.
   // Equal emails, names and device saves never select the existing account.
   const legacy=action==='claim'?tokenFrom(request,'__Host-rematch-pixel-session'):null;
   if(action==='claim'&&!legacy)return reply({error:'Recover your original Rematch session before transferring its progress.'},401);
   const result=await deps.store.exchange({identity,mode:action,browserHash:hashToken(browser),flowHash:hashToken(body.flow),legacyHash:legacy?hashToken(legacy):null,tokenHash:hashToken(raw),sessionEnd:end,newAccountId:randomUUID()});
   if(result.setupRequired)return reply({setupRequired:true});
   if(identity.expiresAt<=clock()||Math.floor((result.expiresAt-clock())/1000)<1||result.expiresAt>end)throw Error('Sign in again.');
   return reply({authenticated:true,expiresAt:result.expiresAt},200,[cookie(raw,result.expiresAt,clock()),'__Host-rematch-pixel-session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0']);
  }catch(e){return reply({error:e.uncertain?'Could not confirm sign-in. Sign in to the original email account again before retrying setup.':e.status&&e.status<500?e.message:'Rematch sign-in did not complete. Sign in again to check the original account.',...(e.uncertain?{uncertain:true}:{})},e.status||503);}
 };
}
