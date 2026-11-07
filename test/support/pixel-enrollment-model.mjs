// Stateful SQL-command double only, NOT PostgreSQL semantics/concurrency proof.
import {readFileSync} from 'node:fs';
import {model,hash,history,firstHistory} from './pixel-profile-model.mjs';
export const generation='33333333-3333-4333-8333-333333333333';
export const enrollmentHistory=hash('synthetic-ongoing-enrollment-v1');
const ddl=readFileSync(new URL('../../ops/sql/target-schema.sql',import.meta.url),'utf8');
const types={boolean:'bool',integer:'int4',text:'text',uuid:'uuid',bigint:'int8',timestamptz:'timestamptz'};
const cols=[...ddl.matchAll(/CREATE TABLE rematch_pixel_ongoing\.([a-z_]+) \(([\s\S]*?)\n\);/g)].flatMap(m=>[...m[2].matchAll(/^  ([a-z_]+) (boolean|integer|text|uuid|bigint|timestamptz)([^\n]*)/gm)].map(c=>({table_name:m[1],column_name:c[1],udt_name:types[c[2]],is_nullable:/NOT NULL|PRIMARY KEY/.test(c[3])?'NO':'YES'})));
const constraint=(table_name,contype,columns,referenced_schema=null,referenced_table=null,referenced_columns=[],confdeltype='r')=>({table_name,contype,columns,referenced_schema,referenced_table,referenced_columns,confdeltype});
const constraints=[constraint('schema_meta','p',['singleton']),constraint('policy','p',['singleton']),constraint('discoveries','p',['token_hash']),constraint('discoveries','u',['discovery_state_hash']),constraint('flows','p',['state_hash']),constraint('flows','f',['state_hash'],'rematch_pixel','attempts',['state_hash'],'c'),constraint('flows','f',['discovery_hash'],'rematch_pixel_ongoing','discoveries',['token_hash'],'r')];
export function enrollmentModel(options={}){
 const policy={configured:true,valid:true,enabled:true,generation};
 const queryHook=c=>{
  options.beforeQuery?.(c);const {sql,params:p,draft:d,result:r,snapshot:j,instant}=c,now=()=>c.getNow();
  if(sql.includes('FROM rematch_pixel_ongoing.schema_meta'))return r([{singleton:true,contract_version:1,migration_hash:options.wrongEnrollmentHistory?'0'.repeat(64):enrollmentHistory,base_history:history,first_history:firstHistory}]);
  if(sql.includes("table_schema='rematch_pixel_ongoing'"))return r(options.badEnrollmentColumns?cols.slice(1):cols);
  if(sql.includes("n.nspname='rematch_pixel_ongoing'"))return r(options.badEnrollmentConstraints?constraints.slice(1):constraints);
  if(sql.startsWith('SELECT singleton,enabled,generation,lock_tag'))return r([d.enrollmentPolicy]);
  if(sql.startsWith('SELECT (clock_timestamp()>='))return r([{enrollment_live:now()>=p[0]&&now()<p[1]}]);
  if(sql.startsWith('DELETE FROM rematch_pixel_ongoing.discoveries')){d.discoveries=d.discoveries.filter(x=>new Date(x.expires_at).getTime()>now()||d.enrollmentFlows.some(f=>f.discovery_hash===x.token_hash));return r();}
  if(sql.startsWith('SELECT count(*)::text AS total,'))return r([{total:String(d.attempts.length),per_browser:String(d.attempts.filter(a=>a.browser_hash===p[0]).length)}]);
  if(sql.startsWith('SELECT count(*)::text AS retained FROM rematch_pixel_ongoing'))return r([{retained:String(d.discoveries.length)}]);
  if(sql.startsWith('INSERT INTO rematch_pixel.attempts AS a')&&p.length===6){if(new Date(p[5]).getTime()<=now())return r();if(d.attempts.some(a=>a.state_hash===p[0]))throw Error('Model unique state');const a={state_hash:p[0],browser_hash:p[1],nonce:p[2],code_verifier:p[3],redirect_uri:p[4],expires_at:p[5],created_at:instant(),consumed_at:null,cancelled_at:null,completed_at:null};d.attempts.push(a);return r([{attempt_snapshot:j(a)}]);}
  if(sql.startsWith('INSERT INTO rematch_pixel_ongoing.flows AS f')){
   if(d.enrollmentFlows.some(f=>f.state_hash===p[0]))throw Error('Model unique flow');const creation=sql.includes("'create'");
   const f={state_hash:p[0],purpose:creation?'create':'discovery',generation:p[1],starts_at:new Date(p[2]).toISOString(),window_end:p[3],expires_at:p[4],discovery_hash:creation?p[5]:null,target_account_id:creation?p[6]:null,subject:creation?p[7]:null,signed_epoch:creation?p[8]:null,identity_expires_at:creation?p[9]:null,created_at:instant()};d.enrollmentFlows.push(f);return r([{flow_snapshot:j(f)}]);
  }
  if(sql.startsWith('SELECT to_jsonb(a)::text AS attempt_snapshot,to_jsonb(f)::text AS flow_snapshot')){const a=d.attempts.find(a=>a.state_hash===p[0]),f=d.enrollmentFlows.find(f=>f.state_hash===p[0]);return r(a&&f?[{attempt_snapshot:j(a),flow_snapshot:j(f)}]:[]);}
  if(sql.startsWith('SELECT f.*,a.nonce')){const a=d.attempts.find(a=>a.state_hash===p[0]&&a.browser_hash===p[1]),f=d.enrollmentFlows.find(f=>f.state_hash===p[0]&&f.purpose===p[2]);return r(a&&f?[{...f,nonce:a.nonce,code_verifier:a.code_verifier,redirect_uri:a.redirect_uri,attempt_end:a.expires_at,cancelled_at:a.cancelled_at,completed_at:a.completed_at,consumed_at:a.consumed_at,flow_snapshot:j(f)}]:[]);}
  if(sql.startsWith('INSERT INTO rematch_pixel_ongoing.discoveries AS d')){
   if(d.discoveries.some(x=>x.token_hash===p[0]||x.discovery_state_hash===p[2]))throw Error('Model duplicate discovery');
   const x={token_hash:p[0],browser_hash:p[1],discovery_state_hash:p[2],issuer:p[3],subject:p[4],signed_epoch:p[5],identity_expires_at:p[6],generation:p[7],starts_at:new Date(p[8]).toISOString(),window_end:p[9],expires_at:p[10],consumed_at:null,created_at:instant()};d.discoveries.push(x);return r([{discovery_snapshot:j(x)}]);
  }
  if(sql.startsWith('SELECT to_jsonb(d)::text AS discovery_snapshot,to_jsonb(f)::text AS flow_snapshot')){const x=d.discoveries.find(x=>x.token_hash===p[0]),f=x&&d.enrollmentFlows.find(f=>f.state_hash===x.discovery_state_hash),a=f&&d.attempts.find(a=>a.state_hash===f.state_hash&&a.cancelled_at===null);return r(x&&f&&a?[{discovery_snapshot:j(x),flow_snapshot:j(f),completed_at:a.completed_at}]:[]);}
  if(sql.startsWith('SELECT d.*,to_jsonb(d)::text AS discovery_snapshot')){const x=d.discoveries.find(x=>x.token_hash===p[0]&&x.browser_hash===p[1]),a=x&&d.attempts.find(a=>a.state_hash===x.discovery_state_hash&&a.browser_hash===p[1]&&a.cancelled_at===null&&a.completed_at!==null);return r(x&&a?[{...x,discovery_snapshot:j(x)}]:[]);}
  if(sql.startsWith('UPDATE rematch_pixel_ongoing.discoveries AS d SET consumed_at=')){const x=d.discoveries.find(x=>x.token_hash===p[0]&&x.consumed_at===null);if(x)x.consumed_at=instant();return r(x?[{discovery_snapshot:j(x)}]:[]);}
  if(sql.startsWith('SELECT to_jsonb(f)::text AS flow_snapshot,to_jsonb(d)::text AS discovery_snapshot')){const f=d.enrollmentFlows.find(f=>f.state_hash===p[0]),x=f&&d.discoveries.find(x=>x.token_hash===f.discovery_hash&&x.browser_hash===p[1]);return r(f&&x?[{flow_snapshot:j(f),discovery_snapshot:j(x)}]:[]);}
  if(sql.startsWith('SELECT a.browser_hash FROM rematch_pixel.sessions')){const x=d.sessions.find(x=>x.token_hash===p[0]),a=x&&d.attempts.find(a=>a.state_hash===x.attempt_state_hash);return r(a?[{browser_hash:a.browser_hash}]:[]);}
  if(sql.startsWith('SELECT state_hash FROM rematch_pixel.attempts WHERE browser_hash=ANY'))return r(d.attempts.filter(a=>p[0].includes(a.browser_hash)).map(a=>({state_hash:a.state_hash})));
  if(sql==='SELECT count(*)::text AS retained FROM rematch_pixel.attempts')return r([{retained:String(d.attempts.length)}]);
  if(sql.startsWith('INSERT INTO rematch_pixel.attempts(state_hash')){if(d.attempts.some(a=>a.state_hash===p[0]))throw Error('Model unique state');const a={state_hash:p[0],browser_hash:p[1],nonce:p[2],code_verifier:p[3],redirect_uri:p[4],expires_at:new Date(Math.min(new Date(p[5]).getTime(),now()+300000)).toISOString(),created_at:instant(),consumed_at:null,cancelled_at:null,completed_at:null};d.attempts.push(a);return r([{state_hash:a.state_hash}]);}
  if(sql.startsWith('SELECT a.state_hash,a.expires_at::text AS attempt_expires_at')){const a=d.attempts.find(a=>a.state_hash===p[0]&&a.browser_hash===p[1]&&a.consumed_at!==null&&a.cancelled_at===null&&a.completed_at===null&&new Date(a.expires_at).getTime()>now());if(!a)return r();const b={...a};delete b.completed_at;return r([{state_hash:a.state_hash,attempt_expires_at:a.expires_at,attempt_snapshot:j(b)}]);}
  if(sql.startsWith('SELECT b.account_id,b.floor_epoch,a.display_name')){const b=d.bindings.find(b=>b.issuer===p[0]&&b.subject===p[1]),a=b&&d.accounts.find(a=>a.id===b.account_id);return r(b&&a?[{account_id:b.account_id,floor_epoch:b.floor_epoch,display_name:a.display_name}]:[]);}
  if(sql.startsWith('SELECT count(*)::text AS retained,')&&sql.includes('per_binding'))return r([{retained:String(d.sessions.length),per_binding:String(d.sessions.filter(x=>x.issuer===p[0]&&x.subject===p[1]).length)}]);
  if(sql.startsWith("SELECT (to_jsonb(a)-'completed_at')::text AS attempt_snapshot")&&!sql.includes('JOIN rematch_pixel_first')){const a=d.attempts.find(a=>a.state_hash===p[0]&&a.browser_hash===p[1]);if(!a)return r();const b={...a};delete b.completed_at;return r([{attempt_snapshot:j(b),completed_at:a.completed_at}]);}
  if(sql.startsWith('WITH fence AS MATERIALIZED'))return r([{deadlines_live:p.slice(0,3).every(v=>new Date(v).getTime()>now())&&new Date(p[2]).getTime()<=new Date(p[1]).getTime()&&new Date(p[2]).getTime()<=new Date(p[3]).getTime()+300000}]);
  if(sql.startsWith('UPDATE rematch_pixel.attempts SET cancelled_at=')&&sql.includes('state_hash=$1')){const a=d.attempts.find(a=>a.state_hash===p[0]&&a.browser_hash===p[1]);if(a)a.cancelled_at??=instant();return r(a?[{state_hash:a.state_hash}]:[]);}
  if(sql.startsWith('UPDATE rematch_pixel.sessions SET revoked_at=COALESCE')&&sql.includes('attempt_state_hash')){for(const x of d.sessions)if(x.attempt_state_hash===p[0])x.revoked_at??=instant();return r();}
  if(sql.startsWith('UPDATE rematch_pixel.attempts SET cancelled_at=COALESCE')){for(const a of d.attempts)if((Array.isArray(p[0])?p[0]:[p[0]]).includes(a.browser_hash))a.cancelled_at??=instant();return r();}
  if(sql.startsWith('UPDATE rematch_pixel.sessions SET revoked_at=COALESCE')&&sql.includes('token_hash=$1')){for(const x of d.sessions)if(x.token_hash===p[0]||d.attempts.some(a=>a.state_hash===x.attempt_state_hash&&(p[1]||[]).includes(a.browser_hash)))x.revoked_at??=instant();return r();}
  if(sql.startsWith('UPDATE rematch_pixel.sessions SET revoked_at=COALESCE')){for(const x of d.sessions)if(d.attempts.some(a=>a.state_hash===x.attempt_state_hash&&a.browser_hash===p[0]))x.revoked_at??=instant();return r();}
 };
 const f=model({...options,onFlush:(draft,meta)=>options.onFlush?.(draft,meta),extraState:{discoveries:[],enrollmentFlows:[],enrollmentPolicy:{singleton:true,enabled:true,generation,lock_tag:0}},queryHook,storeOptions:{enrollmentHistory,readEnrollmentPolicy:()=>policy}});
 return {f,policy,options,store:f.store};
}
