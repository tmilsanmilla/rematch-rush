import {pathToFileURL} from 'node:url';
import {CATALOG_QUERIES,HISTORY_SQL,ENROLLMENT_POLICY_SQL} from './target-catalog.mjs';
import {readManifest,UNSELECTED_MANIFEST,validateManifest,manifestDigest} from './target-manifest.mjs';
import {renderAdditiveDdl} from './target-ddl.mjs';
import {SCHEMAS,TABLE_PRIVILEGES,TABLE_OPERATIONS,COLUMN_OPERATIONS,canonical,sha256,reject,expectedDatabaseOwner,trustedBootstrapAdminEdge} from './target-contract.mjs';

export const ROLE_CONTEXT_SQL="SELECT current_user::text AS current_role,session_user::text AS session_role,current_setting('transaction_read_only') AS transaction_read_only";
export const descriptorDigest=snapshot=>sha256(canonical(snapshot));
const roles=t=>[t.schemaOwner,t.migrationRole,t.runtimeRole,...(t.operatorRole?[t.operatorRole]:[])];
const checks=(condition,message)=>{if(!condition)reject(message);};
const unique=values=>new Set(values).size===values.length;
const tableName=row=>row.schema+'.'+row.relname;
const INTERNAL_FK_FUNCTIONS=new Set(['RI_FKey_check_ins','RI_FKey_check_upd','RI_FKey_noaction_del','RI_FKey_noaction_upd','RI_FKey_restrict_del','RI_FKey_restrict_upd','RI_FKey_cascade_del','RI_FKey_cascade_upd','RI_FKey_setnull_del','RI_FKey_setnull_upd','RI_FKey_setdefault_del','RI_FKey_setdefault_upd']);
function pinnedSql(sql){
 const pins='_rematch_pins AS (SELECT $1::text AS runtime_role,$2::text[] AS selected_roles,$3::text[] AS selected_schemas)';
 return sql.startsWith('WITH RECURSIVE ')?sql.replace('WITH RECURSIVE ','WITH RECURSIVE '+pins+', '):'WITH '+pins+' '+sql;
}
/** All SQL is fixed and SELECT-only; no connection or driver is constructed. */
export function createCatalogPlan(input,{phase='empty',collectOnly=false}={}){
 checks(['empty','installed'].includes(phase),'unknown catalog phase');
 const m=validateManifest(input,{phase,requireCatalogDigest:!collectOnly});
 checks(renderAdditiveDdl(m).sha256===m.renderedDdlSha256,'DDL bytes changed');
 return Object.freeze({manifest:m,phase,queries:Object.freeze(Object.entries({...CATALOG_QUERIES,...(phase==='installed'?{histories:HISTORY_SQL,enrollmentPolicy:ENROLLMENT_POLICY_SQL}:{})}).map(([name,sql])=>Object.freeze({name,requiredCurrentRole:['histories','enrollmentPolicy'].includes(name)?m.target.schemaOwner:m.target.migrationRole,requiredSessionRole:m.target.operatorRole||m.target.migrationRole,restoreCurrentRole:m.target.migrationRole,roleContextSql:ROLE_CONTEXT_SQL,sql:pinnedSql(sql),params:Object.freeze([m.target.runtimeRole,Object.freeze(roles(m.target)),SCHEMAS])}))),
  connectionInstructions:`Existing operator-owned connection only, session_user=${m.target.operatorRole||m.target.migrationRole}. BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; ${m.target.operatorRole?'SET LOCAL ROLE '+m.target.migrationRole+'; ':''}SET LOCAL search_path=pg_catalog; execute the 18 catalog queries as migrator. For ONLY histories/enrollmentPolicy, SET LOCAL ROLE to the selected schema owner, read those rows, then return to migrator; measure actual role/read-only context before/after each query and after restoration in this SAME transaction; finish ROLLBACK. No transport is supplied by this module.`});
}
function requireRows(snapshot,name){checks(Array.isArray(snapshot?.[name]),'missing complete catalog category '+name);return snapshot[name];}
function exactPrivilegeRows(rows,keys,operations,label){
 checks(rows.length===keys.length*operations.length,label+' row count incomplete');
 checks(unique(rows.map(r=>keys.includes(r.key)&&operations.includes(r.privilege)?r.key+'|'+r.privilege:'invalid')),label+' duplicate/unknown rows');
 checks(rows.every(r=>keys.includes(r.key)&&operations.includes(r.privilege)&&typeof r.allowed==='boolean'&&r.grantable===false),label+' missing flags or grant option');
}
export function assertCatalogSnapshot(snapshot,input,{phase='empty'}={}){
 const m=validateManifest(input,{phase}),t=m.target;
 checks(renderAdditiveDdl(m).sha256===m.renderedDdlSha256,'DDL bytes changed');
 const names=[...Object.keys(CATALOG_QUERIES),...(phase==='installed'?['histories','enrollmentPolicy']:[])];
 checks(snapshot&&Object.keys(snapshot).length===names.length&&names.every(n=>Object.hasOwn(snapshot,n)),'catalog categories incomplete/unknown');
 for(const name of names)requireRows(snapshot,name);
 const identity=snapshot.identity;
 checks(identity.length===1,'target identity unavailable');
 const i=identity[0];
 checks(i.database===t.database&&i.role===t.migrationRole&&i.session_role===(t.operatorRole||t.migrationRole)&&i.database_owner===expectedDatabaseOwner(t)&&t.serverAddresses.includes(i.server_address)&&i.server_port===t.serverPort&&i.server_version_num>=170000&&i.transaction_read_only==='on','actual target/role/version/read-only correspondence failed');
 const rs=snapshot.roles;
 checks(rs.length===roles(t).length&&unique(rs.map(r=>r.rolname))&&rs.every(r=>roles(t).includes(r.rolname)),'selected roles incomplete');
 const runtime=rs.find(r=>r.rolname===t.runtimeRole);
 checks(runtime&&runtime.rolcanlogin===true&&['rolsuper','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls'].every(k=>runtime[k]===false)&&(runtime.rolconfig===null||Array.isArray(runtime.rolconfig)&&runtime.rolconfig.length===0),'runtime role expands security authority');
 checks(snapshot.memberships.every(r=>r.member!==t.runtimeRole&&(r.role!==t.runtimeRole||trustedBootstrapAdminEdge(t,r))),'runtime membership/SET ROLE/inherited authority is not allowed');
 if(t.operatorRole){
  const closed=['rolsuper','rolinherit','rolcreaterole','rolcreatedb','rolreplication','rolbypassrls'];
  checks([t.schemaOwner,t.migrationRole,t.runtimeRole].every(name=>{const r=rs.find(x=>x.rolname===name);return r&&closed.every(k=>r[k]===false)&&(r.rolconfig===null||Array.isArray(r.rolconfig)&&r.rolconfig.length===0);}), 'selected application roles expand authority');
  checks(rs.find(r=>r.rolname===t.schemaOwner)?.rolcanlogin===false&&rs.find(r=>r.rolname===t.migrationRole)?.rolcanlogin===false&&rs.find(r=>r.rolname===t.operatorRole)?.rolcanlogin===true,'NOLOGIN owner/migrator and pinned bootstrap login required');
  checks(snapshot.memberships.some(r=>r.member===t.operatorRole&&r.role===t.migrationRole&&r.set_option===true&&r.inherit_option===false&&r.admin_option===false),'bootstrap cannot assume exact NOLOGIN migrator with non-inherited membership');
  checks(snapshot.memberships.some(r=>r.member===t.migrationRole&&r.role===t.schemaOwner&&r.set_option===true&&r.inherit_option===false&&r.admin_option===false),'NOLOGIN migrator cannot assume exact owner with non-inherited membership');
  const app=[t.schemaOwner,t.migrationRole,t.runtimeRole];
  const selectedEdge=r=>(r.member===t.operatorRole&&r.role===t.migrationRole||r.member===t.migrationRole&&r.role===t.schemaOwner)&&r.set_option===true&&r.inherit_option===false&&r.admin_option===false;
  checks(snapshot.memberships.every(r=>!app.includes(r.member)&&!app.includes(r.role)||selectedEdge(r)||trustedBootstrapAdminEdge(t,r)),'unreviewed application-role membership/administrator');
  if(t.bootstrapAdminGrantor)checks(app.every(name=>snapshot.memberships.filter(r=>r.role===name&&trustedBootstrapAdminEdge(t,r)).length===1),'exact provider bootstrap administrator rows missing/duplicate');
  if(expectedDatabaseOwner(t)===t.operatorRole)checks(i.schema_owner_create===true,'schema owner lacks exact database CREATE prerequisite');

 }

 checks(snapshot.defaultAcls.every(r=>r.grantee===r.role),'unexpected global/schema default grant (including PUBLIC/inherited runtime)');
 checks(snapshot.namespaces.every(r=>r.owner!==t.runtimeRole&&r.runtime_create===false&&r.runtime_usage_grantable===false&&r.runtime_create_grantable===false),'runtime owns schema or can create/grant');
 checks(snapshot.relations.every(r=>r.owner!==t.runtimeRole)&&snapshot.functions.every(r=>r.owner!==t.runtimeRole&&r.runtime_execute_grantable===false&&
  (r.runtime_execute===false||(r.schema==='pg_catalog'&&r.internal_fk_builtin===true&&INTERNAL_FK_FUNCTIONS.has(r.proname)))),'runtime owns/executes non-system objects');
 const db=snapshot.effectiveDatabase.map(r=>({...r,key:t.database}));
 exactPrivilegeRows(db,[t.database],['CONNECT','CREATE','TEMP'],'database privilege');
 checks(db.find(r=>r.privilege==='CONNECT').allowed===true&&db.find(r=>r.privilege==='CREATE').allowed===false,'runtime database authority invalid');
 if(phase==='empty'){
  const canSet=new Set([t.migrationRole]);let grew=true;
  while(grew){grew=false;for(const edge of snapshot.memberships)if(edge.set_option===true&&canSet.has(edge.member)&&!canSet.has(edge.role)){canSet.add(edge.role);grew=true;}}
  checks(rs.find(r=>r.rolname===t.migrationRole)?.rolsuper===true||canSet.has(t.schemaOwner),'migrator cannot SET ROLE to the selected existing schema owner');
  checks(!snapshot.namespaces.some(r=>SCHEMAS.includes(r.nspname))&&snapshot.relations.length===0&&snapshot.functions.length===0,'dedicated target is not empty / Rematch namespace already exists');
  for(const n of ['columns','constraints','indexes','triggers','policies','viewsRules','dependencies','effectiveTables','effectiveColumns'])checks(snapshot[n].length===0,'empty target has unexpected '+n);
 }else{
  checks(snapshot.defaultAcls.some(r=>r.role===t.schemaOwner&&r.schema==='*'&&r.defaclobjtype==='f'&&r.grantee===t.schemaOwner),'owner-global function PUBLIC default has not been explicitly removed');
  checks(db.find(r=>r.privilege==='TEMP').allowed===false,'runtime TEMP remains enabled (including PUBLIC/inherited)');
  const ns=snapshot.namespaces.filter(r=>SCHEMAS.includes(r.nspname));
  checks(ns.length===SCHEMAS.length&&ns.every(r=>r.owner===t.schemaOwner&&r.runtime_usage===true),'schema ownership/usage differs');
  const tables=snapshot.relations.filter(r=>['r','p','v','m','f'].includes(r.relkind));
  checks(tables.length===Object.keys(TABLE_PRIVILEGES).length&&unique(tables.map(tableName))&&tables.every(r=>Object.hasOwn(TABLE_PRIVILEGES,tableName(r))&&r.owner===t.schemaOwner&&r.relkind==='r'&&r.relrowsecurity===false&&r.relforcerowsecurity===false),'unexpected tables/ownership/RLS/view/foreign relation');
  checks(tables.every(t=>snapshot.aclEntries.some(a=>a.kind==='relation'&&a.schema===t.schema&&a.object===t.relname&&a.grantee===m.target.schemaOwner)),'raw relation ACL inventory incomplete');
  checks(snapshot.constraints.every(r=>r.convalidated===true)&&snapshot.indexes.every(r=>r.indisvalid===true&&r.indisready===true),'unvalidated constraints/indexes');
  checks(snapshot.triggers.every(r=>r.tgisinternal===true)&&snapshot.policies.length===0&&snapshot.viewsRules.length===0,'unreviewed triggers/RLS policies/views/rules');
  const effective=snapshot.effectiveTables.map(r=>({...r,key:tableName(r)}));
  exactPrivilegeRows(effective,Object.keys(TABLE_PRIVILEGES),TABLE_OPERATIONS,'table privilege');
  checks(effective.every(r=>r.allowed===TABLE_PRIVILEGES[r.key].table.includes(r.privilege)),'runtime table privilege matrix expanded/missing');
  const columns=snapshot.columns.map(r=>({...r,key:tableName(r)+'.'+r.attname}));
  checks(columns.length>0&&unique(columns.map(r=>r.key))&&columns.every(r=>Object.hasOwn(TABLE_PRIVILEGES,tableName(r))),'column inventory incomplete');
  const columnPrivileges=snapshot.effectiveColumns.map(r=>({...r,key:tableName(r)+'.'+r.attname}));
  exactPrivilegeRows(columnPrivileges,columns.map(r=>r.key),COLUMN_OPERATIONS,'column privilege');
  checks(columnPrivileges.every(r=>{const p=TABLE_PRIVILEGES[tableName(r)];return r.allowed===(p.table.includes(r.privilege)||(r.privilege==='UPDATE'&&p.updateColumns.includes(r.attname)));}),'runtime column privilege matrix expanded/missing');
  checks(snapshot.histories.length===3&&snapshot.histories.every(r=>r.singleton===true&&r.contract_version===1)&&snapshot.histories.find(r=>r.kind==='base')?.migration_hash===m.histories.base&&snapshot.histories.find(r=>r.kind==='first')?.migration_hash===m.histories.first&&snapshot.histories.find(r=>r.kind==='first')?.base_history===m.histories.base&&snapshot.histories.find(r=>r.kind==='ongoing')?.migration_hash===m.histories.ongoing&&snapshot.histories.find(r=>r.kind==='ongoing')?.base_history===m.histories.base&&snapshot.histories.find(r=>r.kind==='ongoing')?.first_history===m.histories.first,'history rows differ from target-specific contract');
  const ep=snapshot.enrollmentPolicy;checks(ep.length===1&&ep[0].singleton===true&&typeof ep[0].enabled==='boolean'&&ep[0].lock_tag===0&&(ep[0].generation===null&&!ep[0].enabled||typeof ep[0].generation==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ep[0].generation)),'enrollment policy missing or malformed');
 }
 checks(snapshot.aclEntries.every(r=>{
  if(typeof r.owner!=='string'||typeof r.grantee!=='string'||typeof r.privilege_type!=='string'||typeof r.is_grantable!=='boolean')return false;
  if(r.grantee===r.owner)return true;
  if(t.providerDatabaseRole&&r.kind==='database'&&r.schema===null&&r.object===t.database&&r.owner===expectedDatabaseOwner(t)&&r.grantee===t.providerDatabaseRole&&['CONNECT','CREATE','TEMPORARY'].includes(r.privilege_type)&&r.is_grantable===false)return true;
  if(r.grantee==='PUBLIC')return r.is_grantable===false&&((phase==='empty'&&r.kind==='database'&&['CONNECT','TEMPORARY'].includes(r.privilege_type))||(r.kind==='schema'&&r.schema==='public'&&r.privilege_type==='USAGE'));
  if(t.operatorRole&&r.kind==='database'&&r.grantee===t.schemaOwner&&r.privilege_type==='CREATE'&&r.is_grantable===false)return true;
  if(r.grantee===t.migrationRole)return r.kind==='database'&&r.privilege_type==='CONNECT'&&r.is_grantable===false;
  if(r.grantee!==t.runtimeRole||r.is_grantable!==false)return false;
  if(r.kind==='database')return r.privilege_type==='CONNECT';
  if(r.kind==='schema')return SCHEMAS.includes(r.schema)&&r.privilege_type==='USAGE';
  if(r.kind==='relation')return TABLE_PRIVILEGES[r.schema+'.'+r.object]?.table.includes(r.privilege_type)===true;
  if(r.kind==='column'){const [table,column]=r.object.split('.');return r.privilege_type==='UPDATE'&&TABLE_PRIVILEGES[r.schema+'.'+table]?.updateColumns.includes(column)===true;}
  return false;
 }),'unexpected PUBLIC/foreign/direct object privilege or grant option');
 if(t.providerDatabaseRole)checks(['CONNECT','CREATE','TEMPORARY'].every(p=>snapshot.aclEntries.filter(r=>r.kind==='database'&&r.object===t.database&&r.owner===expectedDatabaseOwner(t)&&r.grantee===t.providerDatabaseRole&&r.privilege_type===p&&r.is_grantable===false).length===1),'exact preserved provider database ACL rows missing/duplicate');
 const digest=descriptorDigest(snapshot),expected=phase==='empty'?m.expectedEmptyCatalogDigest:m.expectedInstalledCatalogDigest;
 checks(digest===expected,'full catalog descriptor differs from independently reviewed pin');
 return Object.freeze({phase,status:phase==='empty'?'ELIGIBLE_EMPTY_TARGET_NOT_ACTIVATION_READY':'PINNED_INSTALLED_CATALOG_AND_EFFECTIVE_PRIVILEGES_MATCH',catalogDigest:digest,manifestDigest:manifestDigest(m),queriesComplete:true,activationAuthorized:false});
}
/** Future explicitly authorized read-only executor, already inside READ ONLY.
 * A local permit is a confinement check, never a replacement for human authority.
 * No pg import/connect/SQL execution occurs until a caller supplies execute.
 */
export async function runReadOnlyPreflight({manifest,phase='empty',authorization,execute,clock=Date.now}={}){
 return collectReadOnlyCatalog({manifest,phase,authorization,execute,clock,collectOnly:false});
}
/** Initial collection never approves its own descriptor: a different review must
 * freeze expectedEmpty/InstalledCatalogDigest before runReadOnlyPreflight can pass.
 */
export async function collectReadOnlyCatalog({manifest,phase='empty',authorization,execute,clock=Date.now,collectOnly=true}={}){
 const plan=createCatalogPlan(manifest,{phase,collectOnly});
 checks(typeof execute==='function'&&typeof clock==='function','explicit read-only executor/clock required');
 const scope=collectOnly?'READ_ONLY_TARGET_CATALOG_COLLECTION':'READ_ONLY_TARGET_PREFLIGHT',digest=sha256(canonical(plan.manifest));
 const originalStart=Date.parse(authorization?.notBefore),originalEnd=Date.parse(authorization?.expiresAt);
 const check=()=>{const now=clock(),start=Date.parse(authorization?.notBefore),end=Math.min(originalEnd,Date.parse(authorization?.expiresAt));checks(authorization?.scope===scope&&authorization.manifestDigest===digest&&start===originalStart&&Number.isFinite(now)&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&end-start<=900000&&now>=start&&now<end,'separate finite read-only execution authority absent/expired');};
 check();const snapshot={},roleObservations=[];
 for(const q of plan.queries){check();const result=await execute(q.sql,q.params,q.name,Object.freeze({requiredCurrentRole:q.requiredCurrentRole,requiredSessionRole:q.requiredSessionRole,restoreCurrentRole:q.restoreCurrentRole,roleContextSql:q.roleContextSql}));check();
  const evidence=result?.roleEvidence;
  const actual=(c,role)=>c?.current_role===role&&c.session_role===q.requiredSessionRole&&c.transaction_read_only==='on';
  checks(actual(evidence?.before,q.requiredCurrentRole)&&actual(evidence?.after,q.requiredCurrentRole)&&actual(evidence?.restored,q.restoreCurrentRole),'actual per-query role/read-only/restoration evidence absent or mismatched for '+q.name);
  roleObservations.push(Object.freeze({name:q.name,before:Object.freeze({...evidence.before}),after:Object.freeze({...evidence.after}),restored:Object.freeze({...evidence.restored})}));
  checks(result?.complete===true&&Array.isArray(result.rows)&&Number.isSafeInteger(result.rowCount)&&result.rowCount===result.rows.length,'partial/forbidden catalog result '+q.name);snapshot[q.name]=result.rows;
  if(q.name==='identity'){const i=result.rows[0],t=plan.manifest.target;checks(result.rows.length===1&&i.database===t.database&&i.role===t.migrationRole&&i.session_role===(t.operatorRole||t.migrationRole)&&i.database_owner===expectedDatabaseOwner(t)&&t.serverAddresses.includes(i.server_address)&&i.server_port===t.serverPort&&i.transaction_read_only==='on','wrong actual target/read-only context');}
 }
 return Object.freeze({report:collectOnly?Object.freeze({status:'COLLECTED_UNREVIEWED_NOT_ACCEPTANCE',catalogDigest:descriptorDigest(snapshot),activationAuthorized:false}):assertCatalogSnapshot(snapshot,plan.manifest,{phase}),snapshot,roleObservations:Object.freeze(roleObservations)});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2);checks(args.length===0||args.length===1&&args[0]==='--plan'||args.length===3&&['--plan','--render'].includes(args[0])&&args[1]==='--manifest','only --plan or --render --manifest FILE is supported; there is no execute command');
  const manifest=args.length===3?readManifest(args[2]):UNSELECTED_MANIFEST;
  if(!manifest.approved){console.log(JSON.stringify({status:'UNSELECTED_TARGET_PLAN_ONLY',manifest:UNSELECTED_MANIFEST,requiredCatalogCategories:Object.keys(CATALOG_QUERIES),connectionAttempted:false},null,2));}
  else if(args[0]==='--render'){console.log(renderAdditiveDdl(manifest).sql);}
  else{const plan=createCatalogPlan(manifest);console.log(JSON.stringify({status:'SELECTED_TARGET_PLAN_ONLY',manifest:plan.manifest,connectionInstructions:plan.connectionInstructions,queries:plan.queries,connectionAttempted:false},null,2));}
 }catch{console.error('Rematch target preparation refused invalid/unapproved input.');process.exitCode=1;}
}
