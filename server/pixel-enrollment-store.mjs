import {readAcceptedIdentityFact} from './pixel-accepted-identity.mjs';
import {assertEnrollmentWindow} from './pixel-enrollment.mjs';
const ISSUER='https://pixel-pulse-websites.vercel.app/api/sso';
const CALLBACK='https://rematch-rush.vercel.app/api/auth/callback/pixel-pulse';
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const epoch=value=>value instanceof Date?value.getTime():Date.parse(value);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const shapes={schema_meta:{singleton:'bool',contract_version:'int4',migration_hash:'text',base_history:'text',first_history:'text'},policy:{singleton:'bool',enabled:'bool',generation:'uuid',lock_tag:'int4'},discoveries:{token_hash:'text',browser_hash:'text',discovery_state_hash:'text',issuer:'text',subject:'text',signed_epoch:'int8',identity_expires_at:'timestamptz',generation:'uuid',starts_at:'timestamptz',window_end:'timestamptz',expires_at:'timestamptz',consumed_at:'timestamptz',created_at:'timestamptz'},flows:{state_hash:'text',purpose:'text',generation:'uuid',starts_at:'timestamptz',window_end:'timestamptz',expires_at:'timestamptz',discovery_hash:'text',target_account_id:'uuid',subject:'text',signed_epoch:'int8',identity_expires_at:'timestamptz',created_at:'timestamptz'}};
const nullable={policy:['generation'],discoveries:['consumed_at'],flows:['discovery_hash','target_account_id','subject','signed_epoch','identity_expires_at']};
export function createEnrollmentMethods({operation,config,history,firstProfileHistory,readPolicy,maintainAuthRows,observeKnownBindingSecurity,StorageError,TargetError,Refusal}){
 const no=()=>{throw new Refusal();};
 const bad=()=>{throw new StorageError('PIXEL_ENROLLMENT_INPUT',400);};
 const iso=value=>{const d=new Date(value);if(!Number.isFinite(d.getTime()))bad();return d.toISOString();};
 const one=async(c,sql,args=[]) => (await c.query(sql,args)).rows[0];
 const snapshot=row=>({generation:row.generation,notBeforeMs:new Date(row.starts_at).getTime(),expiresAt:iso(row.window_end)});
 const current=(s,caps=[])=>assertEnrollmentWindow(readPolicy,s,Date.now(),caps);
 async function schema(c){
  if(!digest(history)||!digest(firstProfileHistory))throw new TargetError('PIXEL_ENROLLMENT_CONTRACT_UNAPPROVED');
  const rows=(await c.query('SELECT singleton,contract_version,migration_hash,base_history,first_history FROM rematch_pixel_ongoing.schema_meta')).rows;
  if(rows.length!==1||rows[0].singleton!==true||rows[0].contract_version!==1||rows[0].migration_hash!==history||rows[0].base_history!==config.pins.history||rows[0].first_history!==firstProfileHistory)throw new TargetError('PIXEL_ENROLLMENT_SCHEMA_MISMATCH');
  const columns=(await c.query("SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema='rematch_pixel_ongoing' ORDER BY table_name,column_name")).rows;
  const actual=new Map();for(const r of columns){if(!actual.has(r.table_name))actual.set(r.table_name,{});actual.get(r.table_name)[r.column_name]=r.udt_name;if(r.is_nullable!==(nullable[r.table_name]?.includes(r.column_name)?'YES':'NO'))no();}
  if(actual.size!==Object.keys(shapes).length||Object.entries(shapes).some(([t,s])=>!actual.has(t)||Object.keys(actual.get(t)).length!==Object.keys(s).length||Object.entries(s).some(([k,v])=>actual.get(t)[k]!==v)))throw new TargetError('PIXEL_ENROLLMENT_SCHEMA_MISMATCH');
  const constraints=(await c.query(`SELECT c.relname AS table_name,p.contype,
   ARRAY(SELECT a.attname::text FROM unnest(p.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum ORDER BY k.ord) AS columns,
   rn.nspname AS referenced_schema,rc.relname AS referenced_table,p.confdeltype,
   ARRAY(SELECT a.attname::text FROM unnest(p.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=rc.oid AND a.attnum=k.attnum ORDER BY k.ord) AS referenced_columns
   FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class rc ON rc.oid=p.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE n.nspname='rematch_pixel_ongoing' AND p.contype IN ('p','u','f')`)).rows;
  const has=(table,type,names)=>constraints.some(r=>r.table_name===table&&r.contype===type&&JSON.stringify(r.columns)===JSON.stringify(names));
  const fk=(names,schema,table,cols,deletion)=>constraints.some(r=>r.table_name==='flows'&&r.contype==='f'&&JSON.stringify(r.columns)===JSON.stringify(names)&&r.referenced_schema===schema&&r.referenced_table===table&&JSON.stringify(r.referenced_columns)===JSON.stringify(cols)&&r.confdeltype===deletion);
  if(!has('schema_meta','p',['singleton'])||!has('policy','p',['singleton'])||!has('discoveries','p',['token_hash'])||!has('discoveries','u',['discovery_state_hash'])||!has('flows','p',['state_hash'])||!fk(['state_hash'],'rematch_pixel','attempts',['state_hash'],'c')||!fk(['discovery_hash'],'rematch_pixel_ongoing','discoveries',['token_hash'],'r'))throw new TargetError('PIXEL_ENROLLMENT_SCHEMA_MISMATCH');
 }
 async function fence(c,s,caps=[]){
  current(s,caps);
  const end=Math.min(epoch(s.expiresAt),...caps.map(v=>typeof v==='number'?v:epoch(v)));
  if(!Number.isFinite(end))no();
  const locked=await one(c,'SELECT singleton,enabled,generation,lock_tag FROM rematch_pixel_ongoing.policy WHERE singleton=true FOR SHARE');
  if(locked?.singleton!==true||locked.enabled!==true||locked.generation!==s.generation||locked.lock_tag!==0)no();
  const r=await one(c,'SELECT (clock_timestamp()>=to_timestamp($1::double precision/1000) AND clock_timestamp()<to_timestamp($2::double precision/1000)) AS enrollment_live',[s.notBeforeMs,end]);
  if(r?.enrollment_live!==true)no();current(s,[end]);
 }
 async function policy(c,s,caps=[]){
  current(s,caps);await schema(c);
  // SHARE conflicts with policy updates. Runtime only has UPDATE(lock_tag),
  // whose CHECK forces zero; it cannot change enrollment enabled/generation.
  const r=await one(c,'SELECT singleton,enabled,generation,lock_tag FROM rematch_pixel_ongoing.policy WHERE singleton=true FOR SHARE');
  if(r?.singleton!==true||r.enabled!==true||r.generation!==s.generation||r.lock_tag!==0)no();
  await fence(c,s,caps);
 }
 const ready=work=>operation(async c=>{await schema(c);return work(c);});
 function validAttempt(a){if(!digest(a?.stateHash)||!digest(a.browserHash)||typeof a.nonce!=='string'||! /^[A-Za-z0-9_-]{22,256}$/.test(a.nonce)||! /^[A-Za-z0-9._~-]{43,128}$/.test(a.codeVerifier||'')||a.redirectUri!==CALLBACK)bad();}
 async function flow(c,stateHash,browserHash,purpose){
  const r=await one(c,`SELECT f.*,a.nonce,a.code_verifier,a.redirect_uri,a.expires_at AS attempt_end,a.cancelled_at,a.completed_at,a.consumed_at,to_jsonb(f)::text AS flow_snapshot
   FROM rematch_pixel_ongoing.flows f JOIN rematch_pixel.attempts a ON a.state_hash=f.state_hash
   WHERE a.state_hash=$1 AND a.browser_hash=$2 AND f.purpose=$3 FOR UPDATE OF a,f`,[stateHash,browserHash,purpose]);
  if(!r||r.cancelled_at!==null||r.completed_at!==null||r.consumed_at===null)no();return r;
 }
 const asDiscovery=r=>({subject:r.subject,credentialVersion:Number(r.signed_epoch),identityExpiresAt:iso(r.identity_expires_at),expiresAt:iso(r.expires_at),generation:r.generation,notBeforeMs:new Date(r.starts_at).getTime(),windowEnd:iso(r.window_end)});
 async function discovery(c,tokenHash,browserHash,{consumed=false}={}){
  const r=await one(c,`SELECT d.*,to_jsonb(d)::text AS discovery_snapshot FROM rematch_pixel_ongoing.discoveries d
   JOIN rematch_pixel.attempts a ON a.state_hash=d.discovery_state_hash
   WHERE d.token_hash=$1 AND d.browser_hash=$2 AND a.browser_hash=$2 AND a.cancelled_at IS NULL AND a.completed_at IS NOT NULL FOR UPDATE OF d`,[tokenHash,browserHash]);
  if(!r||(!consumed&&r.consumed_at!==null)||(consumed&&r.consumed_at===null)||r.issuer!==ISSUER||!uuid(r.subject)||!Number.isSafeInteger(Number(r.signed_epoch))||Number(r.signed_epoch)<0)no();return r;
 }
 const methods={
  checkEnrollmentReady(s){return operation(async c=>{await policy(c,s);return true;});},
  createDiscoveryAttempt(input){
   validAttempt(input);if(!/^discover_[A-Za-z0-9_-]{43}$/.test(input.nonce))bad();const s=Object.freeze({...input.enrollment}),end=iso(Math.min(epoch(input.expiresAt),epoch(s.expiresAt)));
   return operation(async c=>{
    await policy(c,s,[end]);await maintainAuthRows(c);
    await c.query('DELETE FROM rematch_pixel_ongoing.discoveries d WHERE d.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM rematch_pixel_ongoing.flows f WHERE f.discovery_hash=d.token_hash)');
    const n=await one(c,`SELECT count(*)::text AS total,(count(*) FILTER(WHERE browser_hash=$1))::text AS per_browser FROM rematch_pixel.attempts`,[input.browserHash]);
    const retired=await one(c,'SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=$1 AND cancelled_at IS NOT NULL LIMIT 1',[input.browserHash]);
    const receipts=await one(c,'SELECT count(*)::text AS retained FROM rematch_pixel_ongoing.discoveries');
    if(retired||!n||!receipts||!/^\d+$/.test(n.total)||!/^\d+$/.test(n.per_browser)||!/^\d+$/.test(receipts.retained)||Number(n.total)>=1000||Number(n.per_browser)>=6||Number(receipts.retained)>=10000)no();
    const a=await one(c,`INSERT INTO rematch_pixel.attempts AS a(state_hash,browser_hash,nonce,code_verifier,redirect_uri,expires_at)
     SELECT $1,$2,$3,$4,$5,$6::timestamptz WHERE $6::timestamptz>clock_timestamp() RETURNING to_jsonb(a)::text AS attempt_snapshot`,[input.stateHash,input.browserHash,input.nonce,input.codeVerifier,CALLBACK,end]);if(!a)no();
    const f=await one(c,`INSERT INTO rematch_pixel_ongoing.flows AS f(state_hash,purpose,generation,starts_at,window_end,expires_at)
     VALUES($1,'discovery',$2,to_timestamp($3::double precision/1000),$4,$5) RETURNING to_jsonb(f)::text AS flow_snapshot`,[input.stateHash,s.generation,s.notBeforeMs,s.expiresAt,end]);if(!f)no();
    await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    const check=await one(c,`SELECT to_jsonb(a)::text AS attempt_snapshot,to_jsonb(f)::text AS flow_snapshot FROM rematch_pixel.attempts a JOIN rematch_pixel_ongoing.flows f ON f.state_hash=a.state_hash WHERE a.state_hash=$1 FOR UPDATE OF a,f`,[input.stateHash]);
    if(check?.attempt_snapshot!==a.attempt_snapshot||check.flow_snapshot!==f.flow_snapshot)no();await fence(c,s,[end]);return true;
   }).then(ok=>{if(!ok)throw new StorageError();return true;});
  },
  getEnrollmentFlow({stateHash,browserHash,purpose}){
   if(!digest(stateHash)||!digest(browserHash)||!['discovery','create'].includes(purpose))bad();
   return ready(async c=>{const r=await flow(c,stateHash,browserHash,purpose),s=snapshot(r);await policy(c,s,[r.expires_at,r.attempt_end]);
    return {enrollment:s,expiresAt:iso(r.expires_at),targetAccountId:r.target_account_id,expectedSubject:r.subject,expectedEpoch:r.signed_epoch===null?null:Number(r.signed_epoch),identityExpiresAt:r.identity_expires_at===null?null:iso(r.identity_expires_at),discoveryHash:r.discovery_hash};});
  },
  async saveDiscovery(input){
   await observeKnownBindingSecurity(input.acceptedIdentity);const fact=readAcceptedIdentityFact(input.acceptedIdentity);
   if(!fact||fact.issuer!==ISSUER||fact.subject!==input.subject||fact.credentialVersion!==input.credentialVersion||!uuid(input.subject)||!digest(input.tokenHash)||!digest(input.stateHash)||!digest(input.browserHash))bad();
   const s=Object.freeze({...input.enrollment}),identityEnd=iso(input.identityExpiresAt);
   return ready(async c=>{
    await policy(c,s,[identityEnd,input.originalAttemptEnd]);await maintainAuthRows(c);
    const f=await flow(c,input.stateHash,input.browserHash,'discovery');if(f.generation!==s.generation||new Date(f.starts_at).getTime()!==s.notBeforeMs||iso(f.window_end)!==s.expiresAt)no();
    const end=iso(Math.min(epoch(identityEnd),epoch(f.expires_at),epoch(f.attempt_end),input.originalAttemptEnd,epoch(s.expiresAt)));
    const d=await one(c,`INSERT INTO rematch_pixel_ongoing.discoveries AS d(token_hash,browser_hash,discovery_state_hash,issuer,subject,signed_epoch,identity_expires_at,generation,starts_at,window_end,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9::double precision/1000),$10,$11) RETURNING to_jsonb(d)::text AS discovery_snapshot`,[input.tokenHash,input.browserHash,input.stateHash,ISSUER,input.subject,input.credentialVersion,identityEnd,s.generation,s.notBeforeMs,s.expiresAt,end]);if(!d)no();
    const completed=await one(c,'UPDATE rematch_pixel.attempts SET completed_at=clock_timestamp() WHERE state_hash=$1 AND cancelled_at IS NULL AND completed_at IS NULL RETURNING completed_at::text AS completed_at',[input.stateHash]);if(!completed)no();
    await c.query('SET CONSTRAINTS ALL IMMEDIATE');
    const check=await one(c,`SELECT to_jsonb(d)::text AS discovery_snapshot,to_jsonb(f)::text AS flow_snapshot,a.completed_at::text AS completed_at FROM rematch_pixel_ongoing.discoveries d JOIN rematch_pixel_ongoing.flows f ON f.state_hash=d.discovery_state_hash JOIN rematch_pixel.attempts a ON a.state_hash=f.state_hash WHERE d.token_hash=$1 AND a.cancelled_at IS NULL FOR UPDATE OF a,d,f`,[input.tokenHash]);
    if(check?.discovery_snapshot!==d.discovery_snapshot||check.flow_snapshot!==f.flow_snapshot||check.completed_at!==completed.completed_at)no();await fence(c,s,[end,identityEnd,input.originalAttemptEnd]);return {expiresAt:end};
   });
  },
  readDiscovery({tokenHash,browserHash}){
   if(!digest(tokenHash)||!digest(browserHash))bad();
   return ready(async c=>{const r=await discovery(c,tokenHash,browserHash),s=snapshot(r);await policy(c,s,[r.expires_at,r.identity_expires_at]);return asDiscovery(r);});
  },
 };
 const hooks={
  async prepareAttempt(c,input){
   const e=Object.freeze({...input.enrollment});if(!input.enrollment||!e||!digest(e.discoveryHash)||!uuid(input.targetAccountId)||!Number.isSafeInteger(e.expectedEpoch)||!/^enroll_create_[A-Za-z0-9_-]{43}$/.test(input.nonce))bad();
   const s=Object.freeze({generation:e.generation,notBeforeMs:e.notBeforeMs,expiresAt:e.expiresAt});await policy(c,s,[input.admissionExpiresAt]);
   const d=await discovery(c,e.discoveryHash,input.browserHash);
   if(d.generation!==s.generation||new Date(d.starts_at).getTime()!==s.notBeforeMs||iso(d.window_end)!==s.expiresAt||d.subject!==input.expectedSubject||Number(d.signed_epoch)!==e.expectedEpoch||epoch(input.admissionExpiresAt)>epoch(d.expires_at))no();
   const used=await one(c,'UPDATE rematch_pixel_ongoing.discoveries AS d SET consumed_at=clock_timestamp() WHERE token_hash=$1 AND consumed_at IS NULL RETURNING to_jsonb(d)::text AS discovery_snapshot',[e.discoveryHash]);if(!used)no();
   return Object.freeze({s,discoveryHash:e.discoveryHash,discoverySnapshot:used.discovery_snapshot,identityEnd:iso(d.identity_expires_at),end:iso(d.expires_at),epoch:Number(d.signed_epoch),subject:d.subject,target:input.targetAccountId.toLowerCase()});
  },
  async writeFlow(c,g,input){
   const f=await one(c,`INSERT INTO rematch_pixel_ongoing.flows AS f(state_hash,purpose,generation,starts_at,window_end,expires_at,discovery_hash,target_account_id,subject,signed_epoch,identity_expires_at)
    VALUES($1,'create',$2,to_timestamp($3::double precision/1000),$4,$5,$6,$7,$8,$9,$10) RETURNING to_jsonb(f)::text AS flow_snapshot`,[input.stateHash,g.s.generation,g.s.notBeforeMs,g.s.expiresAt,input.admissionExpiresAt,g.discoveryHash,g.target,g.subject,g.epoch,g.identityEnd]);if(!f)no();return Object.freeze({...g,flowSnapshot:f.flow_snapshot});
  },
  async fenceAttempt(c,g,input,caps=[]){
   const r=await one(c,`SELECT to_jsonb(f)::text AS flow_snapshot,to_jsonb(d)::text AS discovery_snapshot FROM rematch_pixel_ongoing.flows f JOIN rematch_pixel_ongoing.discoveries d ON d.token_hash=f.discovery_hash WHERE f.state_hash=$1 AND d.browser_hash=$2 FOR UPDATE OF f,d`,[input.stateHash,input.browserHash]);
   if(r?.flow_snapshot!==g.flowSnapshot||r.discovery_snapshot!==g.discoverySnapshot)no();await fence(c,g.s,[g.end,g.identityEnd,input.admissionExpiresAt,...caps]);
  },
  async prepareComplete(c,input){
   const e=Object.freeze({...input.enrollment});if(!input.enrollment||!e||!digest(e.discoveryHash))bad();const s=Object.freeze({generation:e.generation,notBeforeMs:e.notBeforeMs,expiresAt:e.expiresAt});await policy(c,s,[input.admissionExpiresAt,input.identityExpiresAt,input.proof?.expiresAt]);
   const f=await flow(c,input.stateHash,input.browserHash,'create'),d=await discovery(c,e.discoveryHash,input.browserHash,{consumed:true});
   if(f.generation!==s.generation||f.discovery_hash!==e.discoveryHash||f.subject!==input.subject||Number(f.signed_epoch)!==input.credentialVersion||f.target_account_id!==input.targetAccountId.toLowerCase()||d.subject!==f.subject||Number(d.signed_epoch)!==Number(f.signed_epoch)||d.generation!==f.generation||new Date(f.starts_at).getTime()!==s.notBeforeMs||iso(f.window_end)!==s.expiresAt||epoch(input.admissionExpiresAt)>epoch(f.expires_at))no();
   return Object.freeze({s,flowSnapshot:f.flow_snapshot,discoverySnapshot:d.discovery_snapshot,end:iso(f.expires_at),identityEnd:iso(d.identity_expires_at)});
  },
  async fenceComplete(c,g,input,caps=[]){
   const r=await one(c,`SELECT to_jsonb(f)::text AS flow_snapshot,to_jsonb(d)::text AS discovery_snapshot FROM rematch_pixel_ongoing.flows f JOIN rematch_pixel_ongoing.discoveries d ON d.token_hash=f.discovery_hash WHERE f.state_hash=$1 AND d.browser_hash=$2 FOR UPDATE OF f,d`,[input.stateHash,input.browserHash]);
   if(r?.flow_snapshot!==g.flowSnapshot||r.discovery_snapshot!==g.discoverySnapshot)no();await fence(c,g.s,[g.end,g.identityEnd,input.admissionExpiresAt,input.identityExpiresAt,input.proof.expiresAt,...caps]);
  },
 };
 return {methods,hooks};
}
