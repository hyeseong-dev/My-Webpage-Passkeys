-- Only demonstration accounts and fabricated private records are stored here.
CREATE TABLE IF NOT EXISTS passkey_accounts (
  id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  webauthn_user_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS passkey_credentials (
  id TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES passkey_accounts(id) ON DELETE CASCADE,
  name VARCHAR(64) NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL CHECK (counter >= 0),
  transports JSONB NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL,
  backed_up BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS passkey_credentials_account_idx ON passkey_credentials(account_id);

CREATE TABLE IF NOT EXISTS passkey_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES passkey_accounts(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES passkey_credentials(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passkey_sessions_account_idx ON passkey_sessions(account_id);
CREATE INDEX IF NOT EXISTS passkey_sessions_expiry_idx ON passkey_sessions(expires_at);

-- A proposed new account exists only in a short-lived challenge until verified.
CREATE TABLE IF NOT EXISTS passkey_challenges (
  token_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('registration', 'authentication')),
  account_id UUID,
  user_id TEXT,
  display_name TEXT,
  credential_name VARCHAR(64),
  session_hash TEXT,
  origin TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passkey_challenges_expiry_idx ON passkey_challenges(expires_at);

CREATE TABLE IF NOT EXISTS passkey_private_items (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES passkey_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  position SMALLINT NOT NULL
);
CREATE INDEX IF NOT EXISTS passkey_private_items_owner_idx ON passkey_private_items(account_id);

CREATE TABLE IF NOT EXISTS passkey_rate_limits (
  bucket_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (bucket_hash, window_start)
);
