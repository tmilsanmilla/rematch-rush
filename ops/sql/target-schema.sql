-- UNRENDERED SOURCE TEMPLATE. Direct execution always aborts and rolls back.
BEGIN;
DO $unselected$ BEGIN RAISE EXCEPTION 'REMATCH_SELECT_AND_RENDER_TARGET_FIRST'; END $unselected$;
-- BEGIN REMATCH SCHEMA DEFINITION
-- Render-only schema definition for a separately selected EMPTY dedicated Rematch target.
-- No target, role, history or application row is supplied by this file.
CREATE SCHEMA rematch_pixel;
CREATE TABLE rematch_pixel.schema_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  contract_version integer NOT NULL CHECK(contract_version=1),
  migration_hash text NOT NULL CHECK(migration_hash ~ '^[a-f0-9]{64}$')
);
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
CREATE SCHEMA rematch_pixel_first;
CREATE TABLE rematch_pixel_first.schema_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  contract_version integer NOT NULL CHECK(contract_version=1),
  migration_hash text NOT NULL CHECK(migration_hash ~ '^[a-f0-9]{64}$'),
  base_history text NOT NULL CHECK(base_history ~ '^[a-f0-9]{64}$')
);
CREATE TABLE rematch_pixel_first.attempts (
  state_hash text PRIMARY KEY REFERENCES rematch_pixel.attempts(state_hash) ON DELETE CASCADE,
  target_account_id uuid NOT NULL UNIQUE,
  purpose text NOT NULL CHECK(purpose='create'),
  expected_subject text NOT NULL CHECK(expected_subject ~ '^[A-Za-z0-9_-]{1,255}$'),
  admission_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Proof receipts survive base-attempt cleanup. The global profile/receipt caps
-- bound their retention; preserving them never makes an expired proof usable.
CREATE TABLE rematch_pixel_first.receipts (
  proof_hash text PRIMARY KEY CHECK(proof_hash ~ '^[a-f0-9]{64}$'),
  state_hash text NOT NULL UNIQUE CHECK(state_hash ~ '^[a-f0-9]{64}$'),
  issuer text NOT NULL,
  subject text NOT NULL,
  target_account_id uuid NOT NULL UNIQUE REFERENCES rematch_pixel.accounts(id) ON DELETE RESTRICT,
  flow_hash text NOT NULL CHECK(flow_hash ~ '^[a-f0-9]{64}$'),
  proof_expires_at timestamptz NOT NULL,
  proof_issued_at timestamptz NOT NULL,
  proof_auth_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(issuer,subject),
  FOREIGN KEY(issuer,subject,target_account_id) REFERENCES rematch_pixel.bindings(issuer,subject,account_id) ON DELETE RESTRICT,
  CHECK(proof_expires_at>proof_issued_at AND proof_expires_at<=proof_issued_at+interval '30 seconds'),
  CHECK(proof_auth_time<=proof_issued_at AND proof_auth_time>=proof_issued_at-interval '90 seconds')
);
CREATE SCHEMA rematch_pixel_ongoing;
CREATE TABLE rematch_pixel_ongoing.schema_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  contract_version integer NOT NULL CHECK(contract_version=1),
  migration_hash text NOT NULL CHECK(migration_hash ~ '^[a-f0-9]{64}$'),
  base_history text NOT NULL CHECK(base_history ~ '^[a-f0-9]{64}$'),
  first_history text NOT NULL CHECK(first_history ~ '^[a-f0-9]{64}$')
);
CREATE TABLE rematch_pixel_ongoing.policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  generation uuid,
  lock_tag integer NOT NULL DEFAULT 0 CHECK(lock_tag=0),
  CHECK(generation IS NULL OR generation::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  CHECK(NOT enabled OR generation IS NOT NULL)
);
CREATE TABLE rematch_pixel_ongoing.discoveries (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  browser_hash text NOT NULL CHECK(browser_hash ~ '^[a-f0-9]{64}$'),
  discovery_state_hash text NOT NULL UNIQUE CHECK(discovery_state_hash ~ '^[a-f0-9]{64}$'),
  issuer text NOT NULL CHECK(issuer='https://pixel-pulse-websites.vercel.app/api/sso'),
  subject text NOT NULL,
  signed_epoch bigint NOT NULL CHECK(signed_epoch BETWEEN 0 AND 9007199254740991),
  identity_expires_at timestamptz NOT NULL,
  generation uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(extract(epoch FROM starts_at)::numeric % 300=0 AND window_end=starts_at+interval '300 seconds'),
  CHECK(expires_at>created_at AND expires_at<=window_end AND expires_at<=identity_expires_at AND created_at>=starts_at)
);
CREATE TABLE rematch_pixel_ongoing.flows (
  state_hash text PRIMARY KEY REFERENCES rematch_pixel.attempts(state_hash) ON DELETE CASCADE,
  purpose text NOT NULL CHECK(purpose IN('discovery','create')),
  generation uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  discovery_hash text REFERENCES rematch_pixel_ongoing.discoveries(token_hash) ON DELETE RESTRICT,
  target_account_id uuid,
  subject text,
  signed_epoch bigint CHECK(signed_epoch BETWEEN 0 AND 9007199254740991),
  identity_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(extract(epoch FROM starts_at)::numeric % 300=0 AND window_end=starts_at+interval '300 seconds'),
  CHECK(expires_at>created_at AND expires_at<=window_end AND created_at>=starts_at),
  CHECK((purpose='discovery' AND discovery_hash IS NULL AND target_account_id IS NULL AND subject IS NULL AND signed_epoch IS NULL AND identity_expires_at IS NULL) OR
        (purpose='create' AND discovery_hash IS NOT NULL AND target_account_id IS NOT NULL AND subject IS NOT NULL AND signed_epoch IS NOT NULL AND identity_expires_at IS NOT NULL AND expires_at<=identity_expires_at))
);
-- END REMATCH SCHEMA DEFINITION
ROLLBACK;
