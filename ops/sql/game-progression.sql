-- UNRENDERED ADDITIVE TEMPLATE. Never run this file directly.
BEGIN;
DO $unselected$ BEGIN RAISE EXCEPTION 'REMATCH_REVIEW_GAME_TARGET_AND_BOOTSTRAP_FIRST'; END $unselected$;
-- BEGIN REMATCH GAME DEFINITION
CREATE SCHEMA rematch_game;
REVOKE ALL ON SCHEMA rematch_game FROM PUBLIC;
CREATE TABLE rematch_game.schema_meta(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),contract_version integer NOT NULL CHECK(contract_version=1),migration_hash text NOT NULL CHECK(migration_hash ~ '^[a-f0-9]{64}$'));
CREATE TABLE rematch_game.profiles(account_id uuid PRIMARY KEY REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,money bigint NOT NULL DEFAULT 0 CHECK(money BETWEEN 0 AND 100000000),progress jsonb NOT NULL DEFAULT '{"unlocked":["none"],"characters":{},"dlsi":{},"equipped":"none"}' CHECK(jsonb_typeof(progress)='object'),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE rematch_game.matches(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES rematch_game.profiles(account_id) ON DELETE RESTRICT,format text NOT NULL,settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),character_id text NOT NULL,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),state text NOT NULL DEFAULT 'active' CHECK(state IN('active','finished','abandoned','opponent-left')),result_digest text,result jsonb,finished_at timestamptz,CHECK((state='active')=(finished_at IS NULL)));
CREATE UNIQUE INDEX one_active_game_per_account ON rematch_game.matches(account_id) WHERE state='active';
CREATE TABLE rematch_game.operations(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES rematch_game.profiles(account_id) ON DELETE RESTRICT,kind text NOT NULL,input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE rematch_game.league_stages(id text PRIMARY KEY CHECK(id='stage-1'),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,CHECK(ends_at=starts_at+interval '14 days'));
CREATE TABLE rematch_game.league_points(stage_id text NOT NULL REFERENCES rematch_game.league_stages(id) ON DELETE RESTRICT,account_id uuid NOT NULL REFERENCES rematch_game.profiles(account_id) ON DELETE RESTRICT,character_id text NOT NULL,points bigint NOT NULL DEFAULT 0 CHECK(points>=0),PRIMARY KEY(stage_id,account_id,character_id));
CREATE TABLE rematch_game.admins(account_id uuid PRIMARY KEY REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,added_by uuid REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE rematch_game.bans(account_id uuid PRIMARY KEY REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,version uuid NOT NULL UNIQUE,active boolean NOT NULL,until_at timestamptz,reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 400),created_by uuid NOT NULL REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE rematch_game.appeals(id uuid PRIMARY KEY,account_id uuid NOT NULL REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,ban_version uuid NOT NULL,message text NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),dismissed_at timestamptz,UNIQUE(account_id,ban_version));
CREATE TABLE rematch_game.admin_audit(id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,target_id uuid REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,action text NOT NULL,details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
REVOKE ALL ON ALL TABLES IN SCHEMA rematch_game FROM PUBLIC;
-- Renderer supplies the exact migration hash, 14-day start and reviewed runtime
-- role privileges. Initial admin is an operator-verified immutable account UUID,
-- NEVER a display-name predicate or an automatic first-login grant.
-- END REMATCH GAME DEFINITION
ROLLBACK;
