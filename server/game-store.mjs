import {createRequire} from 'node:module';
import {assertTargetConfig} from './pixel-target.mjs';
import {normaliseProgress,splitGameMoney,joinGameMoney,stageLeaderboard,STYLE_IDS} from '../progression.js';
const require=createRequire(import.meta.url),deny=()=>{throw Object.assign(new Error('Game storage is not ready.'),{status:503});};
export const GAME_TABLES=Object.freeze(['schema_meta','profiles','matches','operations','league_stages','league_points','admins','bans','appeals','admin_audit']);
const date=v=>new Date(v).getTime();
/** A separate additive namespace on the same explicitly approved Rematch target.
 * Existing auth DDL, rows, cookie lifetimes and epoch rules are never changed. */
export function createGameStore(config,{history,PoolClass}={}){
 assertTargetConfig(config);if(!/^[a-f0-9]{64}$/.test(history||''))deny();
 const Pool=PoolClass||require('pg').Pool,pool=new Pool({...config.connection,password:()=>config.connection.password,options:'-c search_path=pg_catalog -c timezone=UTC',replication:'false',client_encoding:'UTF8',sslnegotiation:'postgres',max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,application_name:'rematch-game-progression'});pool.on?.('error',()=>{});
 async function verify(c){
  const r=(await c.query(`SELECT current_database() AS db,current_user AS role,inet_server_port() AS port,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolinherit FROM pg_roles r WHERE rolname=current_user`)).rows[0];
  if(!r||r.db!==config.pins.database||r.role!==config.pins.role||Number(r.port)!==config.pins.port||r.rolsuper||r.rolbypassrls||r.rolcreaterole||r.rolcreatedb||r.rolinherit)deny();
  const base=(await c.query('SELECT migration_hash FROM rematch_pixel.schema_meta WHERE singleton')).rows[0];if(base?.migration_hash!==config.pins.history)deny();
  const meta=(await c.query('SELECT contract_version,migration_hash FROM rematch_game.schema_meta WHERE singleton')).rows[0];if(meta?.contract_version!==1||meta.migration_hash!==history)deny();
  // No executable additions, public/default exposure or owner runtime. Operator
  // preflight pins the complete descriptor; the runtime additionally checks it.
  const tables=(await c.query(`SELECT c.relname,c.relkind,c.relowner::regrole::text AS owner,EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS public_acl,EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,EXISTS(SELECT 1 FROM pg_rewrite w WHERE w.ev_class=c.oid) AS rules FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rematch_game' AND c.relkind IN('r','v','m','f','p') ORDER BY c.relname`)).rows;
  if(tables.length!==GAME_TABLES.length||tables.some(t=>!GAME_TABLES.includes(t.relname)||t.relkind!=='r'||t.owner===config.pins.role||t.public_acl||t.triggers||t.rules))deny();
 }
 async function leader(c){const stage=(await c.query("SELECT starts_at,ends_at FROM rematch_game.league_stages WHERE id='stage-1'")).rows[0];if(!stage)deny();const totals=Object.fromEntries((await c.query("SELECT character_id,SUM(points)::text AS points FROM rematch_game.league_points WHERE stage_id='stage-1' GROUP BY character_id")).rows.map(r=>[r.character_id,Number(r.points)]));const now=date((await c.query('SELECT clock_timestamp() AS now')).rows[0].now);return stageLeaderboard(STYLE_IDS,totals,new Date(stage.starts_at).toISOString(),now);}
 async function operation(tokenHash,work,anonymous=false){let c,began=false,commitSent=false;try{
  c=await pool.connect();await c.query('BEGIN');began=true;await c.query("SET LOCAL statement_timeout='5000ms'");await c.query("SET LOCAL lock_timeout='3000ms'");await verify(c);
  await c.query('SELECT pg_advisory_xact_lock(1919249761,1734438245)');
  const live=async()=>{const row=(await c.query(`SELECT s.account_id,s.expires_at FROM rematch_pixel.sessions s JOIN rematch_pixel.bindings b ON b.issuer=s.issuer AND b.subject=s.subject AND b.account_id=s.account_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.signed_epoch=b.floor_epoch FOR SHARE OF s,b`,[tokenHash])).rows[0];if(!row)throw Object.assign(new Error('Your Rematch session ended. Sign in again to continue.'),{status:401});return row;};
  const actor=anonymous?null:(await live()).account_id;
  const tx={actor,now:async()=>date((await c.query('SELECT clock_timestamp() AS now')).rows[0].now),
   profile:async id=>{let r=(await c.query('SELECT money,progress FROM rematch_game.profiles WHERE account_id=$1 FOR UPDATE',[id])).rows[0];if(!r)r={money:0,progress:{}};return {...r.progress,money:joinGameMoney(r.money,r.progress?._moneyCents)};},
   displayName:async id=>(await c.query('SELECT display_name FROM rematch_pixel.accounts WHERE id=$1',[id])).rows[0]?.display_name,
   saveProfile:async(id,p)=>{const n=normaliseProgress(p),{money,...progress}=n;const wallet=splitGameMoney(money);progress._moneyCents=wallet.cents;await c.query('INSERT INTO rematch_game.profiles(account_id,money,progress) VALUES($1,$2,$3::jsonb) ON CONFLICT(account_id) DO UPDATE SET money=EXCLUDED.money,progress=EXCLUDED.progress,updated_at=clock_timestamp()',[id,wallet.whole,JSON.stringify(progress)]);},
   operation:async id=>{const r=(await c.query('SELECT account_id AS actor,input_digest AS digest,result FROM rematch_game.operations WHERE id=$1',[id])).rows[0];return r;},
   saveOperation:async o=>{await c.query('INSERT INTO rematch_game.operations(id,account_id,kind,input_digest,result) VALUES($1,$2,$3,$4,$5::jsonb)',[o.id,o.actor,o.kind,o.digest,JSON.stringify(o.result)]);},
   abandonActive:async id=>{await c.query("UPDATE rematch_game.matches SET state='abandoned',finished_at=clock_timestamp() WHERE account_id=$1 AND state='active'",[id]);},
   startMatch:async m=>{await c.query('INSERT INTO rematch_game.matches(id,account_id,format,settings,character_id) VALUES($1,$2,$3,$4::jsonb,$5)',[m.id,m.actor,m.format,JSON.stringify(m.settings),m.character]);},
   match:async id=>{const r=(await c.query('SELECT id,account_id AS actor,format,character_id AS character,settings,started_at,state FROM rematch_game.matches WHERE id=$1 FOR UPDATE',[id])).rows[0];return r?{...r,startedAt:date(r.started_at)}:null;},
   finishMatch:async(id,state,hash,result)=>{await c.query('UPDATE rematch_game.matches SET state=$2,result_digest=$3,result=$4::jsonb,finished_at=clock_timestamp() WHERE id=$1 AND state=\'active\'',[id,state,hash,JSON.stringify(result)]);},
   leaderboard:()=>leader(c),points:async(id,style,points)=>{await c.query("INSERT INTO rematch_game.league_points(stage_id,account_id,character_id,points) VALUES('stage-1',$1,$2,$3) ON CONFLICT(stage_id,account_id,character_id) DO UPDATE SET points=rematch_game.league_points.points+EXCLUDED.points",[id,style,points]);},
   isAdmin:async id=>(await c.query('SELECT 1 FROM rematch_game.admins WHERE account_id=$1',[id])).rows.length===1,
   adminCount:async()=>Number((await c.query('SELECT count(*) AS n FROM rematch_game.admins a LEFT JOIN rematch_game.bans b ON b.account_id=a.account_id WHERE b.account_id IS NULL OR NOT b.active OR b.until_at<=clock_timestamp()')).rows[0].n),
   addAdmin:async(id,by)=>{await c.query('INSERT INTO rematch_game.admins(account_id,added_by) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,by]);},
   removeAdmin:async id=>{await c.query('DELETE FROM rematch_game.admins WHERE account_id=$1',[id]);},
   resolveAccount:async name=>{const r=(await c.query('SELECT id FROM rematch_pixel.accounts WHERE lower(display_name)=lower($1) ORDER BY id LIMIT 2',[name])).rows;return r.length===1?r[0]:null;},
   ban:async id=>{const b=(await c.query('SELECT version,active,until_at,reason FROM rematch_game.bans WHERE account_id=$1',[id])).rows[0];return b?{...b,until:b.until_at===null?null:new Date(b.until_at).toISOString()}:null;},
   setBan:async b=>{await c.query('INSERT INTO rematch_game.bans(account_id,version,active,until_at,reason,created_by) VALUES($1,$2,true,$3,$4,$5) ON CONFLICT(account_id) DO UPDATE SET version=EXCLUDED.version,active=true,until_at=EXCLUDED.until_at,reason=EXCLUDED.reason,created_by=EXCLUDED.created_by,updated_at=clock_timestamp()',[b.actor,b.version,b.until,b.reason,b.createdBy]);},
   unban:async id=>{await c.query('UPDATE rematch_game.bans SET active=false,updated_at=clock_timestamp() WHERE account_id=$1',[id]);},
   appeal:async v=>{await c.query('INSERT INTO rematch_game.appeals(id,account_id,ban_version,message) VALUES(gen_random_uuid(),$1,$2,$3) ON CONFLICT(account_id,ban_version) DO NOTHING',[v.actor,v.banVersion,v.message]);},
   appeals:async()=>(await c.query('SELECT p.id,a.display_name AS username,p.message,p.created_at AS "createdAt" FROM rematch_game.appeals p JOIN rematch_pixel.accounts a ON a.id=p.account_id WHERE p.dismissed_at IS NULL ORDER BY p.created_at LIMIT 100')).rows,
   dismiss:async id=>{await c.query('UPDATE rematch_game.appeals SET dismissed_at=clock_timestamp() WHERE id=$1 AND dismissed_at IS NULL',[id]);},
   audit:async o=>{await c.query('INSERT INTO rematch_game.admin_audit(id,actor_id,target_id,action,details) VALUES(gen_random_uuid(),$1,$2,$3,$4::jsonb)',[o.actor,o.target||null,o.action,JSON.stringify(o.details)]);},
  };
  const result=await work(tx);await c.query('SET CONSTRAINTS ALL IMMEDIATE');if(!anonymous)await live();const finalNow=date((await c.query('SELECT clock_timestamp() AS now')).rows[0].now);if(!anonymous){const end=(await live()).expires_at;const fence=date((await c.query('SELECT clock_timestamp() AS now')).rows[0].now);if(fence>=date(end)||date(end)>fence+300000)throw Object.assign(new Error('Your Rematch session ended.'),{status:401});}commitSent=true;await c.query('COMMIT');began=false;return result;
 }catch(e){if(began)try{await c.query('ROLLBACK');}catch{}if(commitSent)throw Object.assign(new Error('Could not confirm this operation. Retry the same operation ID.'),{status:503,uncertain:true});throw e;}finally{c?.release();}}
 return {transaction:(hash,work)=>operation(hash,work),leaderboard:()=>operation(null,tx=>tx.leaderboard(),true),close:()=>pool.end()};
}
