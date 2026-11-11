import {isPixelAuthorizationUrl} from './pixel-account.js?v=5';
const createAuthClient=async(url,options)=>(await import('./vendor/neon-auth.min.js')).createAuthClient(url,options);
const base='/api/account';
export function createRematchAccount({fetcher=fetch,clientFactory=createAuthClient,onChange=()=>{globalThis.dispatchEvent?.(new Event('rematch-account-changed'));},notify=()=>{}}={}){
 let client,enabled=false,pendingSetup=false,renewal,uncertain=false;
 const post=async(action,body={})=>{const r=await fetcher(`${base}/${action}`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok){if(d.uncertain)uncertain=true;throw Error(d.error||'Rematch sign-in did not complete.');}return d;};
 const checked=async result=>{if(result?.error)throw Object.assign(Error(result.error.message||'Sign-in did not complete.'),{code:result.error.code});return result?.data;};
 async function finish(mode,flow){const t=await checked(await client.token());if(!t?.token)throw Error('Verify your email, then sign in again.');const d=await post(mode,{token:t.token,flow});if(mode==='login')uncertain=false;pendingSetup=d.setupRequired===true;if(d.authenticated){clearTimeout(renewal);renewal=setTimeout(()=>refresh().catch(()=>{}),Math.max(1000,Date.parse(new Date(d.expiresAt).toISOString())-Date.now()-30000));onChange();}return d;}
 async function refresh(){const r=await fetcher(`${base}/config`,{credentials:'same-origin',cache:'no-store'});const config=await r.json();enabled=r.ok&&config.enabled===true;if(!enabled)return {enabled:false};const authUrl=new URL(config.authUrl);if(authUrl.protocol!=='https:'||!authUrl.hostname.endsWith('.neon.tech')||!authUrl.pathname.endsWith('/auth')||authUrl.username||authUrl.password||authUrl.search||authUrl.hash)throw Error('Rematch account configuration is unavailable.');client||=await clientFactory(config.authUrl,{allowAnonymous:false});const session=await checked(await client.getSession());if(!session?.user)return {enabled:true,authenticated:false};if(session.user.emailVerified!==true)return {enabled:true,verificationRequired:true};const {flow}=await post('start',{mode:'login'});return {enabled:true,...await finish('login',flow)};}
 async function signIn(email,password){if(!enabled)throw Error('Rematch email/password sign-in is not available yet.');const {flow}=await post('start',{mode:'login'});const result=await checked(await client.signIn.email({email,password}));if(result?.user?.emailVerified===false)return {verificationRequired:true};return finish('login',flow);}
 async function signUp(name,email,password){if(!enabled)throw Error('Rematch email/password sign-in is not available yet.');await checked(await client.signUp.email({name,email,password}));return {verificationRequired:true};}
 const needClient=()=>{if(!enabled||!client)throw Error('Rematch email/password sign-in is being set up.');};
 async function setup(mode){needClient();if(uncertain)throw Error('Sign in to the original email account again before retrying setup.');if(!['create','claim'].includes(mode))throw Error('Choose an account setup option.');const {flow}=await post('start',{mode});return finish(mode,flow);}
 async function verifyEmail(email,otp){needClient();await checked(await client.emailOtp.verifyEmail({email,otp}));return refresh();}
 async function sendCode(email){needClient();await checked(await client.emailOtp.sendVerificationOtp({email,type:'email-verification'}));return {ok:true};}
 async function reset(email){needClient();await checked(await client.requestPasswordReset({email,redirectTo:location.origin+'/?account=reset'}));return {ok:true};}
 async function signOut(){clearTimeout(renewal);await post('sign-out');onChange();await checked(await client?.signOut());pendingSetup=false;return {ok:true};}
 async function resetPassword(value,token){needClient();await checked(await client.resetPassword({newPassword:value,token}));return {message:'Password saved. Sign in with your new password.'};}
 return {refresh,signIn,signUp,setup,verifyEmail,sendCode,reset,resetPassword,signOut,get enabled(){return enabled;},get pendingSetup(){return pendingSetup;},dispose(){clearTimeout(renewal);}};
}
export function initRematchAccountUI({doc=document,controller}={}){
 const root=doc.getElementById('rematch-account'),status=doc.getElementById('rematch-account-status'),form=doc.getElementById('rematch-signin-form');if(!root||!form)return null;
 const email=doc.getElementById('rematch-email'),password=doc.getElementById('rematch-password'),name=doc.getElementById('rematch-name'),register=doc.getElementById('rematch-register');
 const api=controller||createRematchAccount();let busy=false;
 const message=(text,error=false)=>{status.textContent=text;status.dataset.tone=error?'error':'status';status.setAttribute('role',error?'alert':'status');};
 const run=async(work)=>{if(busy)return;busy=true;root.setAttribute('aria-busy','true');try{const r=await work();password.value='';doc.getElementById('rematch-setup').hidden=!r?.setupRequired;doc.getElementById('rematch-verify').hidden=!r?.verificationRequired;message(r?.message|| (r?.authenticated?'Signed in to your Rematch account.':r?.setupRequired?'Choose whether to keep existing Rematch progress or create a new profile.':r?.verificationRequired?'Verify your email to finish your Rematch account.':'Done.'),r?.error===true);return r;}catch(e){password.value='';message(e.message,true);if(/verif/i.test(e.code||e.message))doc.getElementById('rematch-verify').hidden=false;}finally{busy=false;root.setAttribute('aria-busy','false');}};
 form.addEventListener('submit',e=>{e.preventDefault();void run(()=>api.signIn(email.value,password.value));});
 register.addEventListener('click',()=>void run(()=>api.signUp(name.value||'Player',email.value,password.value)));
 doc.getElementById('rematch-create').addEventListener('click',()=>void run(()=>api.setup('create')));
 doc.getElementById('rematch-claim').addEventListener('click',()=>void run(()=>api.setup('claim')));
 doc.getElementById('rematch-signout').addEventListener('click',()=>void run(()=>api.signOut()));
 doc.getElementById('rematch-forgot').addEventListener('click',()=>void run(async()=>{await api.reset(email.value);return {message:'Check your email.'};}));
 doc.getElementById('rematch-send-code').addEventListener('click',()=>void run(()=>api.sendCode(email.value)));
 doc.getElementById('rematch-code-form').addEventListener('submit',e=>{e.preventDefault();void run(()=>api.verifyEmail(email.value,doc.getElementById('rematch-code').value));});
 doc.getElementById('rematch-recover').addEventListener('click',()=>void run(async()=>{const r=await fetch('/api/auth/pixel-pulse/start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});const d=await r.json();if(!r.ok||!isPixelAuthorizationUrl(d.url))throw Error('Previous-account recovery is unavailable. Your original progress is kept.');location.assign(d.url);return {message:'Opening previous-account recovery…'};}));
 const params=new URLSearchParams(globalThis.location?.search||'');if(params.get('account')==='reset'&&params.get('token')){root.hidden=false;doc.getElementById('rematch-reset-form').hidden=false;}
 doc.getElementById('rematch-reset-form').addEventListener('submit',e=>{e.preventDefault();void run(()=>api.resetPassword(doc.getElementById('rematch-new-password').value,params.get('token')));});
 globalThis.addEventListener?.('rematch-open-account',()=>{root.hidden=false;email.focus();});
 void run(async()=>{const s=await api.refresh();for(const el of form.querySelectorAll('button,input'))el.disabled=!api.enabled;return !s.enabled?{...s,message:'Rematch email/password sign-in is being set up. Guest play is available.',error:true}:s;});
 return api;
}
if(typeof document!=='undefined')initRematchAccountUI();
