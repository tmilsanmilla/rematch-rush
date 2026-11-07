import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TABLE_PRIVILEGES,TABLE_OPERATIONS,COLUMN_OPERATIONS,SCHEMAS,SCHEMA_SQL,SCHEMA_DEFINITION_SHA256,deriveHistories,canonical,sha256} from './ops/target-contract.mjs';
import {UNSELECTED_MANIFEST,validateManifest,manifestDigest} from './ops/target-manifest.mjs';
import {renderAdditiveDdl} from './ops/target-ddl.mjs';
import {CATALOG_QUERIES} from './ops/target-catalog.mjs';
import {createCatalogPlan,descriptorDigest,assertCatalogSnapshot,runReadOnlyPreflight,collectReadOnlyCatalog} from './ops/target-preflight.mjs';

// Catalog response models only: no SQL parser, driver, socket or DB connection.
const target={host:'synthetic-target.invalid',port:5432,database:'synthetic_rematch',projectId:'synthetic-project',branchId:'synthetic-branch',schemaOwner:'synthetic_owner',migrationRole:'synthetic_migrator',runtimeRole:'synthetic_runtime',serverAddresses:['192.0.2.10'],serverPort:5432};
const role=name=>({rolname:name,rolsuper:false,rolinherit:false,rolcreaterole:false,rolcreatedb:false,rolcanlogin:true,rolreplication:false,rolbypassrls:false,rolconfig:null});
const namespace=(name,owner)=>({nspname:name,owner,acl:null,runtime_usage:true,runtime_create:false,runtime_usage_grantable:false,runtime_create_grantable:false});
function emptySnapshot(){
 const s=Object.fromEntries(Object.keys(CATALOG_QUERIES).map(k=>[k,[]]));
 s.identity=[{database:target.database,role:target.migrationRole,session_role:target.migrationRole,server_address:'192.0.2.10',server_port:5432,server_version_num:170010,transaction_read_only:'on',database_owner:target.schemaOwner,database_acl:null}];
 s.roles=[target.schemaOwner,target.migrationRole,target.runtimeRole].map(role);
 s.memberships=[{member:target.migrationRole,role:target.schemaOwner,admin_option:false,inherit_option:false,set_option:true}];
 s.namespaces=[namespace('public','pg_database_owner')];
 s.effectiveDatabase=['CONNECT','CREATE','TEMP'].map(privilege=>({privilege,allowed:privilege!=='CREATE',grantable:false}));
 s.aclEntries=[{kind:'schema',schema:'public',object:'public',owner:'pg_database_owner',grantee:'PUBLIC',privilege_type:'USAGE',is_grantable:false}];
 return s;
}
function installedSnapshot(){
 const s=emptySnapshot();
 s.namespaces.push(...SCHEMAS.map(n=>namespace(n,target.schemaOwner)));
 s.effectiveDatabase.find(x=>x.privilege==='TEMP').allowed=false;
 s.defaultAcls=[{role:target.schemaOwner,schema:'*',defaclobjtype:'f',grantee:target.schemaOwner,privilege_type:'EXECUTE',is_grantable:false,acl:'synthetic-owner-only'}];
 for(const [key,p]of Object.entries(TABLE_PRIVILEGES)){
  const [schema,relname]=key.split('.');
  s.relations.push({schema,relname,relkind:'r',owner:target.schemaOwner,relpersistence:'p',relrowsecurity:false,relforcerowsecurity:false,relreplident:'d',reloptions:null,acl:'synthetic-reviewed'});
  s.aclEntries.push({kind:'relation',schema,object:relname,owner:target.schemaOwner,grantee:target.schemaOwner,privilege_type:'SELECT',is_grantable:false});
  for(const privilege of TABLE_OPERATIONS)s.effectiveTables.push({schema,relname,privilege,allowed:p.table.includes(privilege),grantable:false});
  const body=SCHEMA_SQL.split('CREATE TABLE '+key+' (')[1].split('\n);')[0];
  const names=[...body.matchAll(/^  ([a-z_]+) (?:text|boolean|integer|uuid|bigint|timestamptz)/gm)].map(m=>m[1]);
  names.forEach((attname,index)=>{
   s.columns.push({schema,relname,attname,attnum:index+1,type:'synthetic-reviewed-type',attnotnull:true,attidentity:'',attgenerated:'',collation:'synthetic',default_expression:null,acl:null});
   for(const privilege of COLUMN_OPERATIONS)s.effectiveColumns.push({schema,relname,attname,privilege,allowed:p.table.includes(privilege)||privilege==='UPDATE'&&p.updateColumns.includes(attname),grantable:false});
  });
 }
 s.constraints=[{schema:'rematch_pixel',relname:'bindings',conname:'synthetic-fk',convalidated:true,conkey:[1,2,3],confkey:[1,2,3],definition:'FOREIGN KEY (issuer, subject, account_id)'}];
 s.indexes=[{schema:'rematch_pixel',relname:'bindings',indisvalid:true,indisready:true,indkey:'1 2 3',definition:'synthetic reviewed ordered index'}];
 s.enrollmentPolicy=[{singleton:true,enabled:false,generation:null,lock_tag:0}];
 s.histories=[{kind:'base',singleton:true,contract_version:1,migration_hash:deriveHistories(target).base,base_history:null},{kind:'first',singleton:true,contract_version:1,migration_hash:deriveHistories(target).first,base_history:deriveHistories(target).base},{kind:'ongoing',singleton:true,contract_version:1,migration_hash:deriveHistories(target).ongoing,base_history:deriveHistories(target).base,first_history:deriveHistories(target).first}];
 return s;
}
function manifest(snapshot=emptySnapshot(),phase='empty',selectedTarget=target){
 const m={...UNSELECTED_MANIFEST,approved:true,target:{...selectedTarget},endpointBindingEvidenceSha256:sha256('synthetic reviewed endpoint correspondence'),histories:deriveHistories(selectedTarget),expectedEmptyCatalogDigest:descriptorDigest(phase==='empty'?snapshot:emptySnapshot()),expectedInstalledCatalogDigest:phase==='installed'?descriptorDigest(snapshot):null};
 m.renderedDdlSha256=renderAdditiveDdl(m).sha256;
 return m;
}
const permit=m=>({scope:'READ_ONLY_TARGET_PREFLIGHT',manifestDigest:manifestDigest(m),notBefore:new Date(1000).toISOString(),expiresAt:new Date(61000).toISOString()});
function modeledExecutor(snapshot,change){const calls=[];return{calls,execute:async(sql,params,name,roleSpec)=>{calls.push({sql,params,name,roleSpec});const context=role=>({current_role:role,session_role:roleSpec.requiredSessionRole,transaction_read_only:'on'});const result={rows:structuredClone(snapshot[name]),rowCount:snapshot[name].length,complete:true,roleEvidence:{before:context(roleSpec.requiredCurrentRole),after:context(roleSpec.requiredCurrentRole),restored:context(roleSpec.restoreCurrentRole)}};return change?change(result,name):result;}};}

test('unselected handoff has no target, connection, credential, history or approval',()=>{
 assert.equal(UNSELECTED_MANIFEST.target,null);assert.equal(UNSELECTED_MANIFEST.approved,false);assert.equal(UNSELECTED_MANIFEST.histories,null);
 assert.throws(()=>createCatalogPlan(UNSELECTED_MANIFEST));assert.throws(()=>renderAdditiveDdl(UNSELECTED_MANIFEST));
});
test('complete render-only target binds project/branch/database/roles/schema definition without self-referential history',()=>{
 const m=manifest(),r=renderAdditiveDdl(m);
 assert.equal(r.executionAuthorized,false);assert.equal(r.sha256,m.renderedDdlSha256);
 assert.equal(m.schemaDefinitionSha256,SCHEMA_DEFINITION_SHA256);
 assert.notEqual(m.histories.base,'086a080ccdb16a5d5186016563eb06ec007d55e1850079ae409c9b445f71f54c');
 for(const field of ['database','projectId','branchId','runtimeRole','schemaOwner'])assert.notDeepEqual(deriveHistories({...target,[field]:target[field]+'_changed'}),m.histories);
 assert.match(r.sql,/inet_server_addr\(\) IS NULL OR inet_server_port\(\) IS NULL/);
 assert.match(r.sql,/ALTER DEFAULT PRIVILEGES FOR ROLE "synthetic_owner" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,"synthetic_runtime"/);
 assert.match(r.sql,/GRANT UPDATE\("created_at"\) ON TABLE "rematch_pixel"\."accounts"/);
 assert.doesNotMatch(r.sql,/CREATE (?:ROLE|DATABASE)|DROP |IF NOT EXISTS|ON CONFLICT|UPDATE rematch_pixel|INSERT INTO rematch_pixel\.(?:accounts|bindings|sessions|attempts)/i);
});
for(const patch of [{approved:false},{target:null},{histories:{base:'a'.repeat(64),first:'b'.repeat(64)}},{schemaDefinitionSha256:'c'.repeat(64)},{endpointBindingEvidenceSha256:null},{expectedEmptyCatalogDigest:null}])test('manifest refuses absent/mismatched handoff pin '+Object.keys(patch)[0],()=>assert.throws(()=>validateManifest({...manifest(),...patch})));
test('renderedDDL hash correspondence is required by both plan and direct snapshot assertion',()=>{
 const s=emptySnapshot(),m={...manifest(s),renderedDdlSha256:'d'.repeat(64)};
 assert.throws(()=>createCatalogPlan(m));assert.throws(()=>assertCatalogSnapshot(s,m));
});
test('catalog plans retain full ordered definitions, raw/default ACL and actual effective privilege checks',()=>{
 const p=createCatalogPlan(manifest());
 assert.equal(p.queries.length,Object.keys(CATALOG_QUERIES).length);
 for(const q of p.queries){assert.match(q.sql,/SELECT \$1::text AS runtime_role,\$2::text\[\] AS selected_roles,\$3::text\[\] AS selected_schemas/);assert.equal(q.params.length,3);assert.doesNotMatch(q.sql,/\bLIMIT\b|\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\s+(?:TABLE|SCHEMA|ROLE|DATABASE|FROM|INTO)\b/i);}
 for(const token of ['pg_get_viewdef','pg_get_ruledef','pg_get_triggerdef','pg_get_functiondef','pg_get_expr','pg_get_constraintdef','pg_get_indexdef','pg_auth_members','set_option','aclexplode','pg_default_acl','has_column_privilege','MAINTAIN','WITH GRANT OPTION'])assert.ok(p.queries.some(q=>q.sql.includes(token)),token);
 assert.equal(descriptorDigest({foreignKeyColumns:['issuer','subject']} )===descriptorDigest({foreignKeyColumns:['subject','issuer']}),false);
});
test('a complete modeled read-only empty-target preflight returns planning eligibility, not activation',async()=>{
 const s=emptySnapshot(),m=manifest(s),e=modeledExecutor(s);
 const r=await runReadOnlyPreflight({manifest:m,execute:e.execute,authorization:permit(m),clock:()=>2000});
 assert.equal(r.report.status,'ELIGIBLE_EMPTY_TARGET_NOT_ACTIVATION_READY');assert.equal(r.report.activationAuthorized,false);assert.equal(e.calls.length,Object.keys(CATALOG_QUERIES).length);
});
for(const change of [(r)=>({...r,complete:false}),(r)=>({...r,rowCount:r.rowCount+1}),(r)=>({...r,rows:undefined})])test('partial or forbidden catalog result never becomes zero usage/empty schema '+String(change),async()=>{
 const s=emptySnapshot(),m=manifest(s),e=modeledExecutor(s,change);
 await assert.rejects(runReadOnlyPreflight({manifest:m,execute:e.execute,authorization:permit(m),clock:()=>2000}));
});
test('missing or expired execution permit refuses before injected executor is called',async()=>{
 const s=emptySnapshot(),m=manifest(s),e=modeledExecutor(s);
 for(const authorization of [undefined,{...permit(m),scope:'WRITE'},{...permit(m),manifestDigest:'f'.repeat(64)},permit(m)])await assert.rejects(runReadOnlyPreflight({manifest:m,execute:e.execute,authorization,clock:()=>61000}));
 assert.equal(e.calls.length,0);
});
test('complete modeled installed descriptors and exact effective rights pass without nativeSQL claims',()=>{
 const s=installedSnapshot(),m=manifest(s,'installed');
 assert.equal(assertCatalogSnapshot(s,m,{phase:'installed'}).activationAuthorized,false);
});
const cases={
 'wrong database':s=>s.identity[0].database='another_game',
 'Unix socket NULL address':s=>s.identity[0].server_address=null,
 'writable transaction':s=>s.identity[0].transaction_read_only='off',
 'runtime owner':s=>s.relations[0].owner=target.runtimeRole,
 'runtime superuser':s=>s.roles.find(r=>r.rolname===target.runtimeRole).rolsuper=true,
 'NOINHERIT membership still permits SET ROLE':s=>s.memberships.push({member:target.runtimeRole,role:target.schemaOwner,inherit_option:false,set_option:true}),
 'runtime TEMP':s=>s.effectiveDatabase.find(r=>r.privilege==='TEMP').allowed=true,
 'schema CREATE':s=>s.namespaces.find(r=>r.nspname==='rematch_pixel').runtime_create=true,
 'table MAINTAIN':s=>s.effectiveTables.find(r=>r.privilege==='MAINTAIN').allowed=true,
 'protected column UPDATE':s=>s.effectiveColumns.find(r=>r.relname==='bindings'&&r.attname==='account_id'&&r.privilege==='UPDATE').allowed=true,
 'column grant option':s=>s.effectiveColumns[0].grantable=true,
 'PUBLIC table SELECT hidden by same runtime SELECT':s=>s.aclEntries.push({kind:'relation',schema:'rematch_pixel',object:'accounts',owner:target.schemaOwner,grantee:'PUBLIC',privilege_type:'SELECT',is_grantable:false}),
 'foreign table reader':s=>s.aclEntries.push({kind:'relation',schema:'rematch_pixel',object:'accounts',owner:target.schemaOwner,grantee:'unapproved_reader',privilege_type:'SELECT',is_grantable:false}),
 'global owner PUBLIC defaults':s=>s.defaultAcls.push({role:target.schemaOwner,schema:'*',defaclobjtype:'r',grantee:'PUBLIC',privilege_type:'SELECT',is_grantable:false}),
 'implicit unremoved global function PUBLIC default':s=>s.defaultAcls=[],
 'invalid constraint':s=>s.constraints[0].convalidated=false,
 'invalid index':s=>s.indexes[0].indisvalid=false,
 'hidden trigger':s=>s.triggers.push({tgisinternal:false}),
 'RLS policy':s=>s.policies.push({polname:'unexpected'}),
 'view rule':s=>s.viewsRules.push({view_definition:'SELECT secret WHERE false'}),
 'incomplete privilege rows':s=>s.effectiveTables.pop(),
 'wrong history':s=>s.histories[0].migration_hash='e'.repeat(64),
};
for(const [name,mutate]of Object.entries(cases))test('installed preflight rejects '+name+' even if caller tries pinning that descriptor',()=>{
 const s=installedSnapshot();mutate(s);const m=manifest(s,'installed');assert.throws(()=>assertCatalogSnapshot(s,m,{phase:'installed'}));
});
for(const [name,mutate]of Object.entries({'swappedFKcolumns':s=>s.constraints[0].conkey.reverse(),'ordered index changed':s=>s.indexes[0].indkey='2 1 3','changed default':s=>s.columns[0].default_expression='unreviewed()','changed function/trigger source':s=>s.dependencies.push({object:'trigger',reference:'different-body'})}))test('full reviewed digest detects '+name,()=>{
 const s=installedSnapshot(),m=manifest(s,'installed');mutate(s);assert.throws(()=>assertCatalogSnapshot(s,m,{phase:'installed'}));
});
test('CLI exposes plan/render only and contains no driver/connection/execute command',async()=>{
 const source=await readFile(new URL('./ops/target-preflight.mjs',import.meta.url),'utf8');
 assert.match(source,/only --plan or --render --manifest FILE/);assert.doesNotMatch(source,/from ['"]pg['"]|new Pool|\.connect\(/);
 assert.equal(canonical({x:[1,2]})===canonical({x:[2,1]}),false);
});

test('initial read-only collection cannot approve its own unpinned descriptor',async()=>{
 const s=emptySnapshot(),m={...manifest(s),expectedEmptyCatalogDigest:null},e=modeledExecutor(s);
 const authorization={...permit(manifest(s)),scope:'READ_ONLY_TARGET_CATALOG_COLLECTION',manifestDigest:sha256(canonical(validateManifest(m,{requireCatalogDigest:false})))};
 const r=await collectReadOnlyCatalog({manifest:m,execute:e.execute,authorization,clock:()=>2000});
 assert.equal(r.report.status,'COLLECTED_UNREVIEWED_NOT_ACCEPTANCE');assert.equal(r.report.activationAuthorized,false);
 assert.throws(()=>assertCatalogSnapshot(s,m));
});
test('wrong actual identity stops collection before reading any additional catalogs',async()=>{
 const s=emptySnapshot(),m=manifest(s);s.identity[0].database='different_db';const e=modeledExecutor(s);
 await assert.rejects(runReadOnlyPreflight({manifest:m,execute:e.execute,authorization:permit(m),clock:()=>2000}));assert.equal(e.calls.length,1);
});
test('exact captured internal pg_catalog FK builtin is allowed but user lookalikes never are',()=>{
 const good=installedSnapshot();good.functions.push({schema:'pg_catalog',proname:'RI_FKey_check_ins',owner:'postgres',internal_fk_builtin:true,runtime_execute:true,runtime_execute_grantable:false,definition:'synthetic pinned builtin'});
 assert.equal(assertCatalogSnapshot(good,manifest(good,'installed'),{phase:'installed'}).activationAuthorized,false);
 for(const patch of [{schema:'public'},{proname:'custom_user_function'},{internal_fk_builtin:false}]){const bad=structuredClone(good);Object.assign(bad.functions[0],patch);assert.throws(()=>assertCatalogSnapshot(bad,manifest(bad,'installed'),{phase:'installed'}));}
});

test('raw schema definition file is non-applicable until selected render strips its abort guard',()=>{assert.match(SCHEMA_SQL,/BEGIN;[\s\S]*RAISE EXCEPTION 'REMATCH_SELECT_AND_RENDER_TARGET_FIRST'/);assert.match(SCHEMA_SQL,/ROLLBACK;\s*$/);assert.doesNotMatch(renderAdditiveDdl(manifest()).sql,/REMATCH_SELECT_AND_RENDER_TARGET_FIRST/);});

const noLoginTarget={...target,operatorRole:'synthetic_operator'};
function noLoginSnapshot(phase='empty'){
 const s=phase==='empty'?emptySnapshot():installedSnapshot();s.identity[0].session_role=noLoginTarget.operatorRole;s.identity[0].server_version_num=180006;
 s.roles.find(r=>r.rolname===target.schemaOwner).rolcanlogin=false;s.roles.find(r=>r.rolname===target.migrationRole).rolcanlogin=false;s.roles.push(role(noLoginTarget.operatorRole));
 s.memberships.push({member:noLoginTarget.operatorRole,role:target.migrationRole,admin_option:false,inherit_option:false,set_option:true});
 if(phase==='installed'){const h=deriveHistories(noLoginTarget);for(const r of s.histories){r.migration_hash=h[r.kind];if(r.kind!=='base')r.base_history=h.base;if(r.kind==='ongoing')r.first_history=h.first;}}
 return s;
}
test('explicit bootstrap session can assume exact NOLOGIN migrator then owner without a migrator password',()=>{
 const s=noLoginSnapshot(),m=manifest(s,'empty',noLoginTarget),r=renderAdditiveDdl(m),plan=createCatalogPlan(m);
 assert.match(r.sql,/SET LOCAL ROLE "synthetic_migrator";[\s\S]*current_user<>'synthetic_migrator' OR session_user<>'synthetic_operator'/);
 assert.match(r.sql,/REMATCH_ROLE_AUTHORITY_MISMATCH/);assert.match(r.sql,/SET LOCAL ROLE "synthetic_owner"/);
 assert.ok(r.sql.indexOf('SET LOCAL ROLE "synthetic_migrator"')<r.sql.indexOf('CREATE SCHEMA rematch_pixel'));
 assert.equal(assertCatalogSnapshot(s,m).activationAuthorized,false);assert.ok(plan.queries[0].params[1].includes('synthetic_operator'));
 assert.notDeepEqual(deriveHistories(noLoginTarget),deriveHistories(target));assert.match(plan.connectionInstructions,/session_user=synthetic_operator/);
});
test('NOLOGIN installed catalog retains exact privilege mapping and three derived histories',()=>{
 const s=noLoginSnapshot('installed');assert.equal(assertCatalogSnapshot(s,manifest(s,'installed',noLoginTarget),{phase:'installed'}).activationAuthorized,false);
});
for(const [label,mutate]of Object.entries({
 'wrong bootstrap session':s=>s.identity[0].session_role='different_operator',
 'owner can login':s=>s.roles.find(r=>r.rolname===target.schemaOwner).rolcanlogin=true,
 'migrator can login':s=>s.roles.find(r=>r.rolname===target.migrationRole).rolcanlogin=true,
 'migration bypass':s=>s.roles.find(r=>r.rolname===target.migrationRole).rolbypassrls=true,
 'runtime inheritance':s=>s.roles.find(r=>r.rolname===target.runtimeRole).rolinherit=true,
 'runtime config':s=>s.roles.find(r=>r.rolname===target.runtimeRole).rolconfig=['transaction_read_only=on'],
 'missing operator record':s=>s.roles=s.roles.filter(r=>r.rolname!==noLoginTarget.operatorRole),
 'operator NOLOGIN':s=>s.roles.find(r=>r.rolname===noLoginTarget.operatorRole).rolcanlogin=false,
 'missing operator SET':s=>s.memberships=s.memberships.filter(r=>r.member!==noLoginTarget.operatorRole),
 'inherited operator edge':s=>s.memberships.find(r=>r.member===noLoginTarget.operatorRole).inherit_option=true,
 'owner administration edge':s=>s.memberships.find(r=>r.member===target.migrationRole).admin_option=true,
 'runtime membership':s=>s.memberships.push({member:target.runtimeRole,role:'pg_read_all_data',admin_option:false,inherit_option:false,set_option:true}),
}))test('NOLOGIN plan rejects '+label+' even under caller-repinned descriptor',()=>{
 const s=noLoginSnapshot();mutate(s);assert.throws(()=>assertCatalogSnapshot(s,manifest(s,'empty',noLoginTarget)));
});
test('bootstrap operator cannot be wildcarded, omitted from a required mapping, or alias an app role',()=>{
 for(const operatorRole of ['',null,target.runtimeRole,target.migrationRole,'operator;RESET ROLE'])assert.throws(()=>deriveHistories({...target,operatorRole}));
 const s=noLoginSnapshot();assert.throws(()=>assertCatalogSnapshot(s,manifest(s,'empty',target)));
});

const providerTarget={...noLoginTarget,databaseOwner:noLoginTarget.operatorRole,bootstrapAdminGrantor:'cloud_admin',serverAddresses:['169.254.254.254/32']};
function providerSnapshot(phase='empty'){
 const s=noLoginSnapshot(phase);s.identity[0].database_owner=providerTarget.operatorRole;s.identity[0].schema_owner_create=true;s.identity[0].server_address='169.254.254.254/32';
 for(const r of s.memberships)r.grantor=providerTarget.operatorRole;
 for(const role of [target.schemaOwner,target.migrationRole,target.runtimeRole])s.memberships.push({member:providerTarget.operatorRole,role,grantor:'cloud_admin',admin_option:true,inherit_option:false,set_option:false});
 s.aclEntries.push({kind:'database',schema:null,object:target.database,owner:providerTarget.operatorRole,grantee:target.schemaOwner,privilege_type:'CREATE',is_grantable:false});
 if(phase==='installed'){const h=deriveHistories(providerTarget);for(const r of s.histories){r.migration_hash=h[r.kind];if(r.kind!=='base')r.base_history=h.base;if(r.kind==='ongoing')r.first_history=h.first;}}
 return s;
}
test('actual provider-shaped split keeps bootstrap DB ownership, CREATE-only schema owner, and exact admin-only grantor',()=>{
 const s=providerSnapshot(),m=manifest(s,'empty',providerTarget),sql=renderAdditiveDdl(m).sql;
 assert.equal(assertCatalogSnapshot(s,m).activationAuthorized,false);
 const operator=sql.indexOf('SET LOCAL ROLE "synthetic_operator"'),dbRevoke=sql.indexOf('REVOKE ALL ON DATABASE'),owner=sql.indexOf('SET LOCAL ROLE "synthetic_owner"');
 assert.ok(operator>=0&&operator<dbRevoke&&dbRevoke<owner);assert.match(sql,/grantor\.rolname='cloud_admin'/);assert.match(sql,/169\.254\.254\.254\/32/);assert.doesNotMatch(sql,/ALTER DATABASE.*OWNER/i);
 const installed=providerSnapshot('installed');assert.equal(assertCatalogSnapshot(installed,manifest(installed,'installed',providerTarget),{phase:'installed'}).activationAuthorized,false);
});
for(const [label,mutate]of Object.entries({
 'wrong bootstrap grantor':s=>s.memberships.find(r=>r.admin_option).grantor='neon_superuser',
 'foreign bootstrap member':s=>s.memberships.find(r=>r.admin_option).member='foreign_admin',
 'bootstrap inherits app role':s=>s.memberships.find(r=>r.admin_option).inherit_option=true,
 'bootstrap SET app role':s=>s.memberships.find(r=>r.admin_option).set_option=true,
 'missing original admin row':s=>s.memberships.pop(),
 'duplicate original admin row':s=>s.memberships.push({...s.memberships.at(-1)}),
 'runtime member of parent':s=>s.memberships.push({member:target.runtimeRole,role:'pg_read_all_data',grantor:'cloud_admin',admin_option:true,inherit_option:false,set_option:false}),
 'schema owner lacks CREATE':s=>s.identity[0].schema_owner_create=false,
 'unexpected database owner':s=>s.identity[0].database_owner='foreign_owner',
 'new app role parent':s=>s.memberships.push({member:target.schemaOwner,role:'pg_read_all_data',grantor:'cloud_admin',admin_option:false,inherit_option:false,set_option:true}),
}))test('provider-shaped plan rejects '+label+' even with caller-repinned descriptor',()=>{const s=providerSnapshot();mutate(s);assert.throws(()=>assertCatalogSnapshot(s,manifest(s,'empty',providerTarget)));});
test('exact server host masks are allowed but network ranges and invalid addresses are refused',()=>{
 for(const value of ['169.254.254.254/32','192.0.2.10','2001:db8::1/128'])assert.doesNotThrow(()=>deriveHistories({...target,serverAddresses:[value]}));
 for(const value of ['169.254.254.254/24','169.254.254.254/0','2001:db8::1/64','169.254.254.254/32/0','999.1.1.1','any'])assert.throws(()=>deriveHistories({...target,serverAddresses:[value]}));
 for(const patch of [{databaseOwner:'different'},{bootstrapAdminGrantor:target.runtimeRole},{bootstrapAdminGrantor:'cloud_admin;RESET ROLE'}])assert.throws(()=>deriveHistories({...providerTarget,...patch}));
 assert.notDeepEqual(deriveHistories(providerTarget),deriveHistories({...providerTarget,bootstrapAdminGrantor:'another_trusted_role'}));
});

const actualProviderTarget={...providerTarget,providerDatabaseRole:'neon_superuser'};
function preservedProviderSnapshot(phase='empty'){
 const s=providerSnapshot(phase);for(const p of ['CONNECT','CREATE','TEMPORARY'])s.aclEntries.push({kind:'database',schema:null,object:target.database,owner:actualProviderTarget.operatorRole,grantee:'neon_superuser',privilege_type:p,is_grantable:false});
 if(phase==='installed'){const h=deriveHistories(actualProviderTarget);for(const r of s.histories){r.migration_hash=h[r.kind];if(r.kind!=='base')r.base_history=h.base;if(r.kind==='ongoing')r.first_history=h.first;}}
 return s;
}
test('exact existing provider DB grants can remain without giving runtime CREATE or memberships',()=>{
 for(const phase of ['empty','installed']){const s=preservedProviderSnapshot(phase);assert.equal(assertCatalogSnapshot(s,manifest(s,phase,actualProviderTarget),{phase}).activationAuthorized,false);}
});
for(const [label,mutate]of Object.entries({
 'different provider reader':s=>s.aclEntries.find(r=>r.grantee==='neon_superuser').grantee='foreign_reader',
 'provider grant option':s=>s.aclEntries.find(r=>r.grantee==='neon_superuser').is_grantable=true,
 'provider schema grant':s=>s.aclEntries.push({kind:'schema',schema:'public',object:'public',owner:'pg_database_owner',grantee:'neon_superuser',privilege_type:'USAGE',is_grantable:false}),
 'provider privilege missing':s=>s.aclEntries=s.aclEntries.filter(r=>!(r.grantee==='neon_superuser'&&r.privilege_type==='CREATE')),
 'provider privilege duplicate':s=>s.aclEntries.push({...s.aclEntries.find(r=>r.grantee==='neon_superuser')}),
}))test('preserved provider baseline refuses '+label+' even with caller-repinned descriptor',()=>{const s=preservedProviderSnapshot();mutate(s);assert.throws(()=>assertCatalogSnapshot(s,manifest(s,'empty',actualProviderTarget)));});

test('installed capture uses owner ONLY for history/policy then records migration role restoration',async()=>{
 const s=installedSnapshot(),m=manifest(s,'installed'),e=modeledExecutor(s),r=await runReadOnlyPreflight({manifest:m,phase:'installed',execute:e.execute,authorization:permit(m),clock:()=>2000});
 assert.equal(r.roleObservations.length,20);
 for(const q of e.calls){assert.equal(q.roleSpec.requiredCurrentRole,['histories','enrollmentPolicy'].includes(q.name)?target.schemaOwner:target.migrationRole);assert.equal(q.roleSpec.restoreCurrentRole,target.migrationRole);assert.match(q.roleSpec.roleContextSql,/current_user.*session_user.*transaction_read_only/);}
 assert.equal(r.snapshot.identity[0].role,target.migrationRole,'Identity remains the actual catalog migrator');
});
for(const [label,patch]of Object.entries({
 'missing role receipt':r=>delete r.roleEvidence,
 'history read as migrator':r=>r.roleEvidence.before.current_role=target.migrationRole,
 'history read as bootstrap':r=>r.roleEvidence.after.current_role='synthetic_bootstrap',
 'wrong session user':r=>r.roleEvidence.before.session_role='different_operator',
 'owner left active':r=>r.roleEvidence.restored.current_role=target.schemaOwner,
 'writable history read':r=>r.roleEvidence.after.transaction_read_only='off',
}))test('installed collector rejects '+label+' without claiming native role proof',async()=>{
 const s=installedSnapshot(),m=manifest(s,'installed'),e=modeledExecutor(s,(r,name)=>{if(name==='histories')patch(r);return r;});
 await assert.rejects(runReadOnlyPreflight({manifest:m,phase:'installed',execute:e.execute,authorization:permit(m),clock:()=>2000}));
});
