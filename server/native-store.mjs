import {createRequire} from 'node:module';
import {assertTargetConfig} from './pixel-target.mjs';
import {NATIVE_SESSION_MS} from './native-account.mjs';
const require=createRequire(import.meta.url),fail=(s,status=409)=>{throw Object.assign(Error(s),{status});};
export function createNativeStore(target,{history,PoolClass}={}){
 assertTargetConfig(target);if(!/^[a-f0-9]{64}$/.test(history||''))throw Error('Native history missing');
 const Pool=PoolClass||require('pg').Pool,pool=new Pool({...target.connection,password:()=>target.connection.password,sslnegotiation:'postgres',max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,options:'-c search_path=pg_catalog -c timezone=UTC'});pool.on?.('error',()=>{});
 async function tx(work){let c,began=false,commit=false;try{c=await pool.connect();await c.query('BEGIN');began=true;await c.query("SET LOCAL lock_timeout='3000ms'");await c.query("SET LOCAL statement_timeout='5000ms'");
  const r=(await c.query('SELECT current_database() AS db,current_user AS role,inet_server_port() AS port')).rows[0];if(r.db!==target.pins.database||r.role!==target.pins.role||Number(r.port)!==target.pins.port)throw Error('Wrong native target');
  const role=(await c.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_roles WHERE rolname=current_user')).rows[0];if(!role||Object.values(role).some(Boolean))throw Error('Native runtime role changed');
  const base=(await c.query('SELECT migration_hash FROM rematch_pixel.schema_meta WHERE singleton')).rows[0];if(base?.migration_hash!==target.pins.history)throw Error('Original account schema changed');
  const tables=(await c.query("SELECT c.relname,c.relkind,c.relowner::regrole::text AS owner,EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS public_acl,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,EXISTS(SELECT 1 FROM pg_rewrite w WHERE w.ev_class=c.oid) AS rules FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rematch_native' AND c.relkind IN('r','v','m','f','p')")).rows;
  if(tables.length!==4||tables.some(t=>!['schema_meta','bindings','sessions','browsers'].includes(t.relname)||t.relkind!=='r'||t.owner===target.pins.role||t.public_acl||t.triggers||t.rules))throw Error('Native schema descriptor changed');
  const m=(await c.query('SELECT migration_hash FROM rematch_native.schema_meta WHERE singleton')).rows[0];if(m?.migration_hash!==history)throw Error('Native schema not approved');
  await c.query('SELECT pg_advisory_xact_lock(1919249761,1734438245)');const out=await work(c);await c.query('SET CONSTRAINTS ALL IMMEDIATE');
  const now=()=>c.query('SELECT clock_timestamp() AS now');
  if(out?.expiresAt&&new Date((await now()).rows[0].now).getTime()>=Math.min(out.expiresAt,out.proofEnd??Infinity))fail('Sign in again.',401);
  commit=true;await c.query('COMMIT');began=false;return out;
 }catch(e){if(began)try{await c.query('ROLLBACK');}catch{}if(commit)throw Object.assign(Error('Could not confirm sign-in. Sign in to the original account again before creating another.'),{status:503,uncertain:true});throw e;}finally{c?.release();}}
 const sessionQuery=`SELECT s.account_id,s.expires_at FROM rematch_native.sessions s JOIN rematch_native.bindings b ON b.issuer=s.issuer AND b.subject=s.subject AND b.account_id=s.account_id JOIN rematch_native.browsers f ON f.browser_hash=s.browser_hash AND f.generation=s.browser_generation WHERE f.revoked_at IS NULL AND f.consumed_at IS NOT NULL AND s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.expires_at<=s.created_at+interval '5 minutes' FOR SHARE OF s,b,f`;
 return {
  begin:({browserHash,flowHash,mode})=>tx(c=>c.query("INSERT INTO rematch_native.browsers(browser_hash,flow_hash,mode,generation,expires_at) VALUES($1,$2,$3,1,clock_timestamp()+interval '5 minutes') ON CONFLICT(browser_hash) DO UPDATE SET flow_hash=EXCLUDED.flow_hash,mode=EXCLUDED.mode,generation=rematch_native.browsers.generation+1,expires_at=EXCLUDED.expires_at,revoked_at=NULL,consumed_at=NULL RETURNING generation",[browserHash,flowHash,mode]).then(()=>({ok:true}))),
  session:hash=>tx(async c=>{const s=(await c.query(sessionQuery,[hash])).rows[0];return s?{expiresAt:new Date(s.expires_at).getTime()}:null;}),
  revoke:(hash,browserHash,legacyHash)=>tx(async c=>{if(legacyHash)await c.query('UPDATE rematch_pixel.sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1 AND revoked_at IS NULL',[legacyHash]);await c.query('UPDATE rematch_native.sessions SET revoked_at=clock_timestamp() WHERE (token_hash=$1 OR browser_hash=$2) AND revoked_at IS NULL',[hash,browserHash]);await c.query('UPDATE rematch_native.browsers SET revoked_at=clock_timestamp(),generation=generation+1 WHERE browser_hash=$1',[browserHash]);return {ok:true};}),
  exchange:input=>tx(async c=>{
   const {identity:i,mode,legacyHash,tokenHash,browserHash,flowHash,newAccountId}=input;const flow=(await c.query('SELECT mode,generation,expires_at,revoked_at,consumed_at FROM rematch_native.browsers WHERE browser_hash=$1 AND flow_hash=$2 FOR UPDATE',[browserHash,flowHash])).rows[0];if(!flow||flow.mode!==mode||flow.revoked_at||flow.consumed_at)fail('Restart sign-in.',401);const flowEnd=new Date(flow.expires_at).getTime(),sessionEnd=Math.min(input.sessionEnd,flowEnd,i.expiresAt);if(new Date((await c.query('SELECT clock_timestamp() AS now')).rows[0].now).getTime()>=sessionEnd)fail('Sign-in expired.',401);
   let binding=(await c.query('SELECT account_id FROM rematch_native.bindings WHERE issuer=$1 AND subject=$2 FOR UPDATE',[i.issuer,i.subject])).rows[0];
   if(mode==='login'&&!binding)return {setupRequired:true};
   let original,proofEnd;
   if(mode==='claim'){
    const proof=(await c.query(`SELECT s.account_id,s.expires_at FROM rematch_pixel.sessions s JOIN rematch_pixel.bindings b ON b.issuer=s.issuer AND b.subject=s.subject AND b.account_id=s.account_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.signed_epoch=b.floor_epoch FOR SHARE OF s,b`,[legacyHash])).rows[0];original=proof?.account_id;proofEnd=proof?new Date(proof.expires_at).getTime():undefined;
    if(!original)fail('Your original Rematch session ended. Recover it again before continuing.',401);
    if(binding&&binding.account_id!==original)fail('This email account already has a different Rematch profile.');
   }
   if(!binding){
    const account=mode==='claim'?original:newAccountId;
    if(mode!=='claim'&&mode!=='create')fail('Explicit account setup required.');
    if(mode==='create'){
     await c.query('INSERT INTO rematch_pixel.accounts(id,display_name) VALUES($1,$2)',[account,i.name||'Player']);
     await c.query("INSERT INTO rematch_game.profiles(account_id,money,progress) VALUES($1,0,'{}'::jsonb)",[account]);
    }
    await c.query('INSERT INTO rematch_native.bindings(issuer,subject,account_id) VALUES($1,$2,$3)',[i.issuer,i.subject,account]);binding={account_id:account};
   }
   const before=new Date((await c.query('SELECT clock_timestamp() AS now')).rows[0].now).getTime();
   if(sessionEnd>i.expiresAt||sessionEnd>before+NATIVE_SESSION_MS||sessionEnd<=before)fail('Sign in again.',401);
   await c.query('INSERT INTO rematch_native.sessions(token_hash,issuer,subject,account_id,expires_at,browser_hash,browser_generation) VALUES($1,$2,$3,$4,$5,$6,$7)',[tokenHash,i.issuer,i.subject,binding.account_id,new Date(sessionEnd),browserHash,flow.generation]);
   await c.query('UPDATE rematch_native.browsers SET consumed_at=clock_timestamp() WHERE browser_hash=$1 AND generation=$2',[browserHash,flow.generation]);
   await c.query('SET CONSTRAINTS ALL IMMEDIATE');
   const saved=(await c.query(sessionQuery,[tokenHash])).rows[0];
   if(!saved||saved.account_id!==binding.account_id||new Date(saved.expires_at).getTime()!==sessionEnd)throw Error('Native session mismatch');
   if(mode==='claim'){
    const still=(await c.query(`SELECT s.account_id FROM rematch_pixel.sessions s JOIN rematch_pixel.bindings b ON b.issuer=s.issuer AND b.subject=s.subject AND b.account_id=s.account_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.signed_epoch=b.floor_epoch`,[legacyHash])).rows[0];
    if(still?.account_id!==original)fail('Original account proof expired.',401);
   }
   return {expiresAt:sessionEnd,proofEnd:Math.min(flowEnd,proofEnd??Infinity)};
  }),close:()=>pool.end(),
 };
}
