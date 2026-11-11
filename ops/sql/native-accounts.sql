-- PREPARED ONLY. An exact operator target/catalog/role review is required.
-- Never execute this unrendered template against an application.
BEGIN;
DO $unselected$ BEGIN RAISE EXCEPTION 'REMATCH_NATIVE_TARGET_AND_PRIVILEGE_REVIEW_REQUIRED'; END $unselected$;
-- BEGIN REMATCH NATIVE DEFINITION
CREATE SCHEMA rematch_native;
REVOKE ALL ON SCHEMA rematch_native FROM PUBLIC;
CREATE TABLE rematch_native.schema_meta(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),migration_hash text NOT NULL CHECK(migration_hash~'^[a-f0-9]{64}$'));
CREATE TABLE rematch_native.bindings(issuer text NOT NULL,subject text NOT NULL,account_id uuid NOT NULL UNIQUE REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(issuer,subject),UNIQUE(issuer,subject,account_id));
CREATE TABLE rematch_native.browsers(browser_hash text PRIMARY KEY CHECK(browser_hash~'^[a-f0-9]{64}$'),flow_hash text NOT NULL CHECK(flow_hash~'^[a-f0-9]{64}$'),mode text NOT NULL CHECK(mode IN('login','create','claim')),generation bigint NOT NULL CHECK(generation>0),expires_at timestamptz NOT NULL,revoked_at timestamptz,consumed_at timestamptz);
CREATE TABLE rematch_native.sessions(token_hash text PRIMARY KEY CHECK(token_hash~'^[a-f0-9]{64}$'),issuer text NOT NULL,subject text NOT NULL,account_id uuid NOT NULL REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,revoked_at timestamptz,browser_hash text NOT NULL REFERENCES rematch_native.browsers(browser_hash) ON DELETE RESTRICT,browser_generation bigint NOT NULL,FOREIGN KEY(issuer,subject,account_id) REFERENCES rematch_native.bindings(issuer,subject,account_id) ON DELETE RESTRICT,CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes'));
REVOKE ALL ON ALL TABLES IN SCHEMA rematch_native FROM PUBLIC;
-- Runtime: USAGE schema; SELECT schema_meta; SELECT,INSERT bindings;
-- SELECT,INSERT and UPDATE(revoked_at) sessions; SELECT,INSERT,UPDATE browsers. No DELETE or table ownership.
-- Existing account/profile rows, Pixel bindings, roles and balances are untouched.
-- END REMATCH NATIVE DEFINITION
ROLLBACK;
