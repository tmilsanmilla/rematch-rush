// Source-bound, additive money/league activation. No connection or execution on
// import. The same transaction compares protected catalogs and private auth rows
// inside the database; only digests/boolean receipts leave it. No admin bootstrap.
import {CATALOG_QUERIES,HISTORY_SQL} from './target-catalog.mjs';
import {GAME_TARGET,GAME_PRIVILEGES,gameDefinition} from './game-extension.mjs';
import {createHash} from 'node:crypto';
const quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const array=xs=>'ARRAY['+xs.map(quote).join(',')+']::text[]';
const schemas=['rematch_pixel','rematch_pixel_first','rematch_pixel_ongoing'];
const roles=[GAME_TARGET.schemaOwner,GAME_TARGET.migrationRole,GAME_TARGET.runtimeRole,GAME_TARGET.operatorRole];
const hash=x=>createHash('sha256').update(x).digest('hex');
const requireValue=(ok,message)=>{if(!ok)throw Error('Game activation: '+message);};
function query(sql,selected=schemas){return sql.replaceAll('$1',quote(GAME_TARGET.runtimeRole)).replaceAll('$2',array(roles)).replaceAll('$3',array(selected));}
function rows(sql,strip=''){return `(SELECT COALESCE(jsonb_agg(${strip?'to_jsonb(q)-'+quote(strip):'to_jsonb(q)'} ORDER BY to_jsonb(q)::text),'[]'::jsonb) FROM (${sql}) q)`;}
export function protectedCatalogSql(){
 const entries=Object.entries(CATALOG_QUERIES).flatMap(([key,sql])=>[quote(key),rows(query(sql),key==='functions'?'internal_fk_builtin':'')]);
 entries.push("'histories'",rows(HISTORY_SQL),"'eventTriggers'",rows("SELECT evtname,evtevent,evtenabled,evtfoid::regprocedure::text AS function FROM pg_event_trigger ORDER BY evtname"));
 return 'jsonb_build_object('+entries.join(',')+')';
}
const dataCapture=variable=>`${variable}:='{}'::jsonb; FOR item IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(${array(schemas)}) AND c.relkind='r' ORDER BY 1,2 LOOP EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM %I.%I t',item.nspname,item.relname) INTO row_data; ${variable}:=${variable}||jsonb_build_object(item.nspname||'.'||item.relname,row_data); END LOOP;`;
const shapeKeys=['namespaces','relations','columns','constraints','indexes','policies','viewsRules','aclEntries','effectiveTables','effectiveColumns'];
export function gameShapeSql(){return 'jsonb_build_object('+shapeKeys.flatMap(key=>[quote(key),`(SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY to_jsonb(q)::text),'[]'::jsonb) FROM (${query(CATALOG_QUERIES[key],['rematch_game'])})q WHERE COALESCE(to_jsonb(q)->>'schema',to_jsonb(q)->>'nspname')='rematch_game')`]).join(',')+')';}
export function gameActivationPlan({phase,startsAt,expectedCatalogSha256=null,expectedShapeSha256=null,reviewed=false}={}){
 requireValue(reviewed===true,'review required');requireValue(['rehearsal','apply'].includes(phase),'explicit phase required');
 requireValue(new Date(Date.parse(startsAt)).toISOString()===startsAt,'exact UTC stage start required');
 if(phase==='apply')for(const pin of [expectedCatalogSha256,expectedShapeSha256])requireValue(/^[a-f0-9]{64}$/.test(pin||''),'rehearsed catalog/shape pins required');
 else requireValue(expectedCatalogSha256===null&&expectedShapeSha256===null,'rehearsal must establish its own pins');
 const definition=gameDefinition(),grants=Object.entries(GAME_PRIVILEGES).map(([table,rights])=>`GRANT ${rights.join(',')} ON rematch_game.${table} TO ${GAME_TARGET.runtimeRole};`).join('\n');
 const ddl=`CREATE SCHEMA rematch_game AUTHORIZATION ${GAME_TARGET.schemaOwner}; SET LOCAL ROLE ${GAME_TARGET.schemaOwner};\n${definition.definition.replace('CREATE SCHEMA rematch_game;','')}\nINSERT INTO rematch_game.schema_meta VALUES(true,1,${quote(definition.sha256)});\nINSERT INTO rematch_game.league_stages VALUES('stage-1',${quote(startsAt)}::timestamptz,${quote(startsAt)}::timestamptz+interval '14 days');\nGRANT USAGE ON SCHEMA rematch_game TO ${GAME_TARGET.runtimeRole};\n${grants}\nSET CONSTRAINTS ALL IMMEDIATE; SET LOCAL ROLE ${GAME_TARGET.operatorRole};`;
 requireValue(!ddl.includes('$rematch_ddl$'),'unexpected delimiter');
 const allowedPrivileges=Object.entries(GAME_PRIVILEGES).flatMap(([table,rights])=>rights.map(right=>`(${quote(table)},${quote(right)})`)).join(',');
 const sql=`DO $rematch_activation$
DECLARE before_catalog jsonb; after_catalog jsonb; before_data jsonb; after_data jsonb; row_data jsonb; item record; part record; extra jsonb; allowed boolean; fk_ids oid[]; trigger_ids oid[]; trigger_names text[]; fk_functions text[]; protected_hash text; shape_hash text; shape jsonb; missing integer;
BEGIN
 IF current_database()<>'rematch_pixel' OR current_user<>'neondb_owner' OR inet_server_port()<>5432 OR current_setting('server_version_num')::int<170000 THEN RAISE EXCEPTION 'REMATCH_GAME_WRONG_TARGET_ROLE'; END IF;
 IF to_regnamespace('rematch_game') IS NOT NULL THEN RAISE EXCEPTION 'REMATCH_GAME_ALREADY_PRESENT'; END IF;
 IF EXISTS(SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D') THEN RAISE EXCEPTION 'REMATCH_GAME_UNREVIEWED_EVENT_TRIGGER'; END IF;
 IF (SELECT migration_hash FROM rematch_pixel.schema_meta WHERE singleton) IS DISTINCT FROM '${GAME_TARGET.baseHistory}' OR (SELECT migration_hash FROM rematch_pixel_first.schema_meta WHERE singleton) IS DISTINCT FROM '890b4bac1b5da8d3913170fa1eda5b266e6dbf7caa9538178e32c0cbc92e5bea' OR (SELECT migration_hash FROM rematch_pixel_ongoing.schema_meta WHERE singleton) IS DISTINCT FROM 'fe0665de3fd1587ff51755f3a1c5b34381ff5f49351fa7059433592f323549c8' OR (SELECT base_history FROM rematch_pixel_first.schema_meta WHERE singleton) IS DISTINCT FROM '${GAME_TARGET.baseHistory}' OR (SELECT base_history FROM rematch_pixel_ongoing.schema_meta WHERE singleton) IS DISTINCT FROM '${GAME_TARGET.baseHistory}' OR (SELECT first_history FROM rematch_pixel_ongoing.schema_meta WHERE singleton) IS DISTINCT FROM '890b4bac1b5da8d3913170fa1eda5b266e6dbf7caa9538178e32c0cbc92e5bea' THEN RAISE EXCEPTION 'REMATCH_GAME_AUTH_HISTORY_DRIFT'; END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname=ANY(${array(roles.slice(0,3))}))<>3 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=ANY(${array(roles.slice(0,3))}) AND (rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls OR rolcanlogin IS DISTINCT FROM (rolname='rematch_pixel_runtime'))) THEN RAISE EXCEPTION 'REMATCH_GAME_ROLE_DRIFT'; END IF;
 FOR item IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(${array(schemas)}) AND c.relkind='r' ORDER BY 1,2 LOOP EXECUTE format('LOCK TABLE %I.%I IN SHARE MODE NOWAIT',item.nspname,item.relname); END LOOP;
 before_catalog:=${protectedCatalogSql()}; ${dataCapture('before_data')}
 protected_hash:=encode(sha256(convert_to(before_catalog::text,'UTF8')),'hex');
 ${phase==='apply'?`IF protected_hash<>${quote(expectedCatalogSha256)} THEN RAISE EXCEPTION 'REMATCH_GAME_BASELINE_DRIFT'; END IF;`:''}
 BEGIN
  EXECUTE $rematch_ddl$${ddl}$rematch_ddl$;
  SELECT array_agg(k.oid ORDER BY k.oid) INTO fk_ids FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class rc ON rc.oid=k.confrelid JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE n.nspname='rematch_game' AND k.contype='f' AND rn.nspname=ANY(${array(schemas)});
  IF cardinality(fk_ids) IS DISTINCT FROM 8 OR EXISTS(SELECT 1 FROM pg_constraint k WHERE k.oid=ANY(fk_ids) AND k.confrelid<>'rematch_pixel.accounts'::regclass) THEN RAISE EXCEPTION 'REMATCH_GAME_UNEXPECTED_AUTH_DEPENDENCY'; END IF;
  SELECT array_agg(t.oid),array_agg(t.tgname::text) INTO trigger_ids,trigger_names FROM pg_trigger t WHERE t.tgconstraint=ANY(fk_ids) AND t.tgisinternal;
  SELECT array_agg(DISTINCT p.oid::regprocedure::text) INTO fk_functions FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_language l ON l.oid=p.prolang WHERE t.oid=ANY(trigger_ids) AND p.pronamespace='pg_catalog'::regnamespace AND l.lanname='internal' AND p.prosrc LIKE 'RI_FKey_%';
  after_catalog:=${protectedCatalogSql()}; ${dataCapture('after_data')}
  IF before_data IS DISTINCT FROM after_data THEN RAISE EXCEPTION 'REMATCH_GAME_AUTH_ROWS_CHANGED'; END IF;
  FOR part IN SELECT key,value FROM jsonb_each(before_catalog) LOOP
   SELECT count(*) INTO missing FROM (SELECT value FROM jsonb_array_elements(part.value) EXCEPT SELECT value FROM jsonb_array_elements(after_catalog->part.key)) z;
   IF missing<>0 THEN RAISE EXCEPTION 'REMATCH_GAME_PROTECTED_CATALOG_CHANGED: %',part.key; END IF;
   FOR extra IN SELECT value FROM jsonb_array_elements(after_catalog->part.key) EXCEPT SELECT value FROM jsonb_array_elements(part.value) LOOP
    allowed:=COALESCE(extra->>'schema',extra->>'nspname')='rematch_game';
    IF part.key='dependencies' THEN allowed:=((extra->>'class'='pg_constraint' AND (extra->>'objid')::oid=ANY(fk_ids)) OR (extra->>'class'='pg_trigger' AND (extra->>'objid')::oid=ANY(trigger_ids))); END IF;
    IF part.key='triggers' THEN allowed:=extra->>'tgname'=ANY(trigger_names) AND (extra->>'tgisinternal')::boolean; END IF;
    IF part.key='functions' THEN allowed:=extra->>'schema'='pg_catalog' AND extra->>'identity'=ANY(fk_functions); END IF;
    IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'REMATCH_GAME_UNEXPECTED_CATALOG_ADDITION: %',part.key; END IF;
   END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM pg_class c WHERE c.relnamespace='rematch_game'::regnamespace AND c.relkind='r')<>10 OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='rematch_game'::regnamespace AND (c.relkind NOT IN('r','i') OR c.relowner<>'rematch_pixel_owner'::regrole OR c.relrowsecurity OR c.relforcerowsecurity)) THEN RAISE EXCEPTION 'REMATCH_GAME_RELATION_SHAPE'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='rematch_game'::regnamespace) OR EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='rematch_game'::regnamespace) OR EXISTS(SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class WHERE c.relnamespace='rematch_game'::regnamespace) OR EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='rematch_game'::regnamespace AND NOT t.tgisinternal) THEN RAISE EXCEPTION 'REMATCH_GAME_EXECUTABLE_ADDITION'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE c.relnamespace='rematch_game'::regnamespace AND c.relkind='r' AND (a.grantee NOT IN('rematch_pixel_owner'::regrole,'rematch_pixel_runtime'::regrole) OR a.grantee='rematch_pixel_runtime'::regrole AND a.is_grantable)) OR EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='rematch_game'::regnamespace AND a.attacl IS NOT NULL) THEN RAISE EXCEPTION 'REMATCH_GAME_UNREVIEWED_GRANT'; END IF;
  IF EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='rematch_game' AND (a.grantee NOT IN('rematch_pixel_owner'::regrole,'rematch_pixel_runtime'::regrole) OR a.grantee='rematch_pixel_runtime'::regrole AND a.is_grantable)) THEN RAISE EXCEPTION 'REMATCH_GAME_UNREVIEWED_SCHEMA_GRANT'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) right_name WHERE c.relnamespace='rematch_game'::regnamespace AND c.relkind='r' AND has_table_privilege('rematch_pixel_runtime',c.oid,right_name) IS DISTINCT FROM EXISTS(SELECT 1 FROM (VALUES ${allowedPrivileges}) permitted(table_name,privilege) WHERE permitted.table_name=c.relname AND permitted.privilege=right_name)) OR has_schema_privilege('rematch_pixel_runtime','rematch_game','CREATE') OR NOT has_schema_privilege('rematch_pixel_runtime','rematch_game','USAGE') THEN RAISE EXCEPTION 'REMATCH_GAME_EFFECTIVE_PRIVILEGE_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM rematch_game.admins) THEN RAISE EXCEPTION 'REMATCH_GAME_ADMIN_NOT_DEFERRED'; END IF;
  shape:=${gameShapeSql()}; shape_hash:=encode(sha256(convert_to(shape::text,'UTF8')),'hex');
  ${phase==='apply'?`IF shape_hash<>${quote(expectedShapeSha256)} THEN RAISE EXCEPTION 'REMATCH_GAME_INSTALLED_SHAPE_DRIFT'; END IF;`:"RAISE SQLSTATE 'RMG01' USING MESSAGE='REMATCH_GAME_REHEARSAL_ROLLBACK';"}
 EXCEPTION WHEN SQLSTATE 'RMG01' THEN
  IF ${phase==='apply'?'true':'false'} OR SQLERRM<>'REMATCH_GAME_REHEARSAL_ROLLBACK' THEN RAISE; END IF;
 END;
 ${phase==='rehearsal'?`IF to_regnamespace('rematch_game') IS NOT NULL OR before_catalog IS DISTINCT FROM ${protectedCatalogSql()} THEN RAISE EXCEPTION 'REMATCH_GAME_REHEARSAL_NOT_CLEAN'; END IF; ${dataCapture('after_data')} IF before_data IS DISTINCT FROM after_data THEN RAISE EXCEPTION 'REMATCH_GAME_REHEARSAL_DATA_CHANGED'; END IF;`:''}
 INSERT INTO pg_temp.rematch_game_activation_result VALUES(${quote(phase)},protected_hash,shape_hash,${quote(definition.sha256)},true,true,true,${quote(startsAt)}::timestamptz);
END $rematch_activation$;`;
 const statements=["SET LOCAL lock_timeout='3000ms'","SET LOCAL statement_timeout='25000ms'","SET LOCAL timezone='UTC'","SET LOCAL search_path=pg_catalog","SELECT pg_advisory_xact_lock(1919249761,1734438245)","CREATE TEMP TABLE rematch_game_activation_result(phase text,protected_catalog_sha256 text,game_shape_sha256 text,game_history text,auth_rows_preserved boolean,protected_catalog_preserved boolean,admin_deferred boolean,starts_at timestamptz) ON COMMIT DROP",sql,'SELECT * FROM pg_temp.rematch_game_activation_result'];
 return {phase,startsAt,definitionSha256:definition.sha256,statementSha256:hash(JSON.stringify(statements)),statements,productionWrites:phase==='apply',adminBootstrap:false,createsResources:false};
}
