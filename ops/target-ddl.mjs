import {validateManifest} from './target-manifest.mjs';
import {SCHEMA_SQL,SCHEMAS,TABLE_PRIVILEGES,sha256,reject,expectedDatabaseOwner} from './target-contract.mjs';
const id=value=>'"'+value.replaceAll('"','""')+'"';
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const qualified=value=>value.split('.').map(id).join('.');
const schemaBody=SCHEMA_SQL.split('-- BEGIN REMATCH SCHEMA DEFINITION\n')[1]?.split('-- END REMATCH SCHEMA DEFINITION\n')[0];
if(!schemaBody)reject('schema source template markers changed');
/** Render only. This module has no driver, execute, role provisioning or apply path. */
export function renderAdditiveDdl(input){
 const m=validateManifest(input,{requireDdlDigest:false,requireCatalogDigest:false}),t=m.target;
 const operatorOwnsDb=t.operatorRole&&expectedDatabaseOwner(t)===t.operatorRole;
 const databaseAcl=[`REVOKE ALL ON DATABASE ${id(t.database)} FROM PUBLIC,${id(t.runtimeRole)};`,`GRANT CONNECT ON DATABASE ${id(t.database)} TO ${id(t.runtimeRole)},${id(t.migrationRole)};`];
 const publicAcl=`REVOKE CREATE ON SCHEMA public FROM PUBLIC,${id(t.runtimeRole)};`;
 const adminEdge=t.bootstrapAdminGrantor?`member.rolname=${literal(t.operatorRole)} AND granted.rolname IN(${[t.schemaOwner,t.migrationRole,t.runtimeRole].map(literal).join(',')}) AND grantor.rolname=${literal(t.bootstrapAdminGrantor)} AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option`:'false';
 const sql=[
  '-- REVIEWED TARGET-SPECIFIC PLAN ONLY. NEVER auto-apply. Requires separate SQL/role/target authority.',
  '-- Only an EMPTY dedicated database with all three Rematch namespaces absent is eligible. No data backfill or account creation.',
  'BEGIN;',
  'SET LOCAL search_path=pg_catalog;',
  ...(t.operatorRole?[`SET LOCAL ROLE ${id(t.migrationRole)};`]:[]),
  `DO $rematch_target$ BEGIN IF current_database()<>${literal(t.database)} OR current_user<>${literal(t.migrationRole)} OR session_user<>${literal(t.operatorRole||t.migrationRole)} OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>${literal(expectedDatabaseOwner(t))} OR inet_server_addr() IS NULL OR inet_server_port() IS NULL OR inet_server_port()<>${t.serverPort} OR NOT(inet_server_addr()::text=ANY(ARRAY[${t.serverAddresses.map(literal).join(',')}])) THEN RAISE EXCEPTION 'REMATCH_TARGET_MISMATCH'; END IF;`,
  `IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('rematch_pixel','rematch_pixel_first','rematch_pixel_ongoing')) OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('r','p','v','m','S','f')) THEN RAISE EXCEPTION 'REMATCH_NONEMPTY_TARGET'; END IF; END $rematch_target$;`,
  ...(t.operatorRole?[`DO $rematch_roles$ BEGIN
    IF (SELECT count(*) FROM pg_roles WHERE rolname IN(${[t.schemaOwner,t.migrationRole,t.runtimeRole].map(literal).join(',')}) AND NOT rolsuper AND NOT rolinherit AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND COALESCE(cardinality(rolconfig),0)=0)<>3
      OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN(${[t.schemaOwner,t.migrationRole].map(literal).join(',')}) AND rolcanlogin)
      OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${literal(t.runtimeRole)} AND rolcanlogin)
      OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles grantor ON grantor.oid=m.grantor WHERE member.rolname=${literal(t.runtimeRole)} OR granted.rolname=${literal(t.runtimeRole)} AND NOT(${adminEdge}))
    THEN RAISE EXCEPTION 'REMATCH_ROLE_AUTHORITY_MISMATCH'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles granted ON granted.oid=m.roleid WHERE member.rolname=${literal(t.migrationRole)} AND granted.rolname=${literal(t.schemaOwner)} AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option)
    THEN RAISE EXCEPTION 'REMATCH_OWNER_ASSUMPTION_MISMATCH'; END IF;
    END $rematch_roles$;`]:[]),
  ...(operatorOwnsDb?[`SET LOCAL ROLE ${id(t.operatorRole)};`,...databaseAcl,publicAcl,`SET LOCAL ROLE ${id(t.migrationRole)};`]:[]),
  `SET LOCAL ROLE ${id(t.schemaOwner)};`,
  // The owner must already own the dedicated database; the migrator must already
  // have separately reviewed SET ROLE ownership. No role is created here.
  ...(!operatorOwnsDb?databaseAcl:[]),
  schemaBody,
  `INSERT INTO rematch_pixel.schema_meta(singleton,contract_version,migration_hash) VALUES(true,1,${literal(m.histories.base)});`,
  `INSERT INTO rematch_pixel_first.schema_meta(singleton,contract_version,migration_hash,base_history) VALUES(true,1,${literal(m.histories.first)},${literal(m.histories.base)});`,
  `INSERT INTO rematch_pixel_ongoing.schema_meta(singleton,contract_version,migration_hash,base_history,first_history) VALUES(true,1,${literal(m.histories.ongoing)},${literal(m.histories.base)},${literal(m.histories.first)});`,
  'INSERT INTO rematch_pixel_ongoing.policy(singleton,enabled,generation) VALUES(true,false,NULL);',
  // Function EXECUTE has an implicit owner-global PUBLIC default. A per-schema
  // REVOKE cannot subtract it. This explicit future reviewed per-database plan
  // changes only this selected owner's defaults; it is not executed here.
  `ALTER DEFAULT PRIVILEGES FOR ROLE ${id(t.schemaOwner)} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,${id(t.runtimeRole)};`,
  ...SCHEMAS.flatMap(s=>[
   `REVOKE ALL ON SCHEMA ${id(s)} FROM PUBLIC,${id(t.runtimeRole)};`,
   `REVOKE ALL ON ALL TABLES IN SCHEMA ${id(s)} FROM PUBLIC,${id(t.runtimeRole)};`,
   `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${id(s)} FROM PUBLIC,${id(t.runtimeRole)};`,
   `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${id(s)} FROM PUBLIC,${id(t.runtimeRole)};`,
   `ALTER DEFAULT PRIVILEGES FOR ROLE ${id(t.schemaOwner)} IN SCHEMA ${id(s)} REVOKE ALL ON TABLES FROM PUBLIC,${id(t.runtimeRole)};`,
   `ALTER DEFAULT PRIVILEGES FOR ROLE ${id(t.schemaOwner)} IN SCHEMA ${id(s)} REVOKE ALL ON SEQUENCES FROM PUBLIC,${id(t.runtimeRole)};`,
   `ALTER DEFAULT PRIVILEGES FOR ROLE ${id(t.schemaOwner)} IN SCHEMA ${id(s)} REVOKE ALL ON FUNCTIONS FROM PUBLIC,${id(t.runtimeRole)};`,
   `GRANT USAGE ON SCHEMA ${id(s)} TO ${id(t.runtimeRole)};`,
  ]),
  ...Object.entries(TABLE_PRIVILEGES).flatMap(([table,p])=>[
   `GRANT ${p.table.join(',')} ON TABLE ${qualified(table)} TO ${id(t.runtimeRole)};`,
   ...(p.updateColumns.length?[`GRANT UPDATE(${p.updateColumns.map(id).join(',')}) ON TABLE ${qualified(table)} TO ${id(t.runtimeRole)};`]:[]),
  ]),
  // Existing public schema must not retain PUBLIC CREATE on this dedicated DB.
  ...(!operatorOwnsDb?[publicAcl]:[]),
  'COMMIT;',
 ].join('\n')+'\n';
 const digest=sha256(sql);
 if(m.renderedDdlSha256!==null&&m.renderedDdlSha256!==digest)reject('rendered DDL does not match its frozen hash');
 return Object.freeze({sql,sha256:digest,histories:m.histories,schemaDefinitionSha256:m.schemaDefinitionSha256,executionAuthorized:false});
}
