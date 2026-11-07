-- DISPOSABLE LOCAL TEST FIXTURE ONLY. NOT A PRODUCTION MIGRATION.
-- Additional contract only; leave the accepted bound-return fixture unchanged.
DO $local_only$
BEGIN
  IF current_database() !~ '^rematch_pixel_test_[a-f0-9]+$' OR inet_server_addr() IS NULL
     OR inet_server_addr() NOT IN ('127.0.0.1'::inet,'::1'::inet)
  THEN RAISE EXCEPTION 'REMATCH_LOCAL_FIXTURE_ONLY'; END IF;
END $local_only$;
CREATE SCHEMA rematch_pixel_first;
CREATE TABLE rematch_pixel_first.schema_meta (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  contract_version integer NOT NULL CHECK(contract_version=1),
  migration_hash text NOT NULL CHECK(migration_hash ~ '^[a-f0-9]{64}$'),
  base_history text NOT NULL CHECK(base_history ~ '^[a-f0-9]{64}$')
);
-- Semantic fixture identifiers only; not production migration approval.
INSERT INTO rematch_pixel_first.schema_meta VALUES(true,1,
  'eb007d0be98e106faa1dea876eae94362ae4d15bf8290ec8c9f37be0d889e9f1',
  '086a080ccdb16a5d5186016563eb06ec007d55e1850079ae409c9b445f71f54c');
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
REVOKE ALL ON SCHEMA rematch_pixel_first FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA rematch_pixel_first FROM PUBLIC;
