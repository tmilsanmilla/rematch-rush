-- DISPOSABLE LOCAL TEST FIXTURE ONLY. NOT A PRODUCTION MIGRATION.
-- Must be run on a loopback-only disposable database named rematch_pixel_test_[hex].
DO $local_only$
BEGIN
  IF current_database() !~ '^rematch_pixel_test_[a-f0-9]+$'
     OR inet_server_addr() IS NULL
     OR inet_server_addr() NOT IN ('127.0.0.1'::inet, '::1'::inet)
  THEN RAISE EXCEPTION 'REMATCH_LOCAL_FIXTURE_ONLY'; END IF;
END $local_only$;

CREATE SCHEMA rematch_pixel;
CREATE TABLE rematch_pixel.schema_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  contract_version integer NOT NULL CHECK(contract_version=1),
  migration_hash text NOT NULL CHECK(migration_hash ~ '^[a-f0-9]{64}$')
);
-- SHA256('rematch-pixel-bound-return-local-v1'); synthetic fixture history only.
INSERT INTO rematch_pixel.schema_meta(singleton,contract_version,migration_hash)
VALUES(true,1,'086a080ccdb16a5d5186016563eb06ec007d55e1850079ae409c9b445f71f54c');
CREATE TABLE rematch_pixel.accounts (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE rematch_pixel.bindings (
  issuer text NOT NULL,
  subject text NOT NULL,
  account_id uuid NOT NULL UNIQUE REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,
  floor_epoch bigint NOT NULL CHECK(floor_epoch BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(issuer,subject),
  UNIQUE(issuer,subject,account_id)
);
CREATE TABLE rematch_pixel.attempts (
  state_hash text PRIMARY KEY CHECK(state_hash ~ '^[a-f0-9]{64}$'),
  browser_hash text NOT NULL CHECK(browser_hash ~ '^[a-f0-9]{64}$'),
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  consumed_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  CHECK(expires_at>created_at)
);
CREATE TABLE rematch_pixel.sessions (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  issuer text NOT NULL,
  subject text NOT NULL,
  account_id uuid NOT NULL,
  attempt_state_hash text NOT NULL UNIQUE REFERENCES rematch_pixel.attempts(state_hash) ON DELETE RESTRICT,
  signed_epoch bigint NOT NULL CHECK(signed_epoch BETWEEN 0 AND 9007199254740991),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  FOREIGN KEY(issuer,subject,account_id) REFERENCES rematch_pixel.bindings(issuer,subject,account_id) ON DELETE RESTRICT,
  CHECK(expires_at>created_at)
);
REVOKE ALL ON SCHEMA rematch_pixel FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA rematch_pixel FROM PUBLIC;
