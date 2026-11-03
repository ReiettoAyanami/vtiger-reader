-- 001_accounts: the users and their sign-in, as in substance-tracker (its migrations 008 and 010).
--
-- Better Auth's tables under the project's names and conventions (snake_case, numeric ids,
-- InnoDB, utf8mb4), mapped field by field in src/modules/identity/auth.ts; its SQL is ours, never
-- its own `migrate`. Millisecond timestamps (DATETIME(3)): the library writes JavaScript dates and
-- reads its rows back by them.
--
-- users            an app user: unique username (the address of their pages) and email (the
--                  library wants it unique), a role. Not a CRM user: the CRM account is linked
--                  separately (lenzi, 2026-11-03: "We're not gonna use the crm credentials as the
--                  credentials for the actual user in our app"). `name` and `image` are the
--                  library's, unused.
-- sessions         who is signed in where: 30 days, refreshed by use; `impersonated_by` while an
--                  administrator acts as the user.
-- accounts         how a user signs in: one `credential` row with the password hash.
-- verifications    the library's one-time tokens (unused today, its schema needs the table).
-- rate_limits      the sign-in counters per IP and path, so a restart does not reset them.
-- password_history the hashes of the passwords a user had: a new one must be none of them.
-- sign_in_failures wrong passwords in a row per user: after 5, each attempt waits 2 s, doubling up
--                  to 60 s, back to nothing at the first right one.
--
-- Safe to re-run: every table is created only when missing.

CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username        VARCHAR(30)   NOT NULL,                  -- [a-z0-9_-], 3-30, never changes
  email           VARCHAR(255)  NOT NULL,                  -- stored lowercase
  role            ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  banned          TINYINT(1)    NOT NULL DEFAULT 0,        -- blocked: no sign-in, no session
  ban_reason      VARCHAR(255)  NULL,                      -- the library's, unused
  ban_expires     DATETIME(3)   NULL,                      -- the library's, unused
  name            VARCHAR(100)  NOT NULL DEFAULT '',       -- the library's, always ''
  image           VARCHAR(500)  NULL,                      -- the library's, unused
  email_verified  TINYINT(1)    NOT NULL DEFAULT 0,        -- the library's, unused
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED  NOT NULL,
  token            VARCHAR(255)  NOT NULL,
  expires_at       DATETIME(3)   NOT NULL,
  ip_address       VARCHAR(45)   NULL,
  user_agent       TEXT          NULL,
  impersonated_by  INT UNSIGNED  NULL,                     -- the administrator acting as user_id
  created_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sessions_token (token),
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_impersonated_by (impersonated_by),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_sessions_impersonated_by FOREIGN KEY (impersonated_by) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS accounts (
  id                        INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id                   INT UNSIGNED  NOT NULL,
  account_id                VARCHAR(255)  NOT NULL,
  provider_id               VARCHAR(50)   NOT NULL,        -- 'credential'
  password                  VARCHAR(255)  NULL,            -- the hash, never the password
  access_token              TEXT          NULL,            -- the library's, unused
  refresh_token             TEXT          NULL,            -- the library's, unused
  id_token                  TEXT          NULL,            -- the library's, unused
  access_token_expires_at   DATETIME(3)   NULL,            -- the library's, unused
  refresh_token_expires_at  DATETIME(3)   NULL,            -- the library's, unused
  scope                     VARCHAR(255)  NULL,            -- the library's, unused
  created_at                DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at                DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_accounts_user (user_id),
  CONSTRAINT fk_accounts_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS verifications (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  identifier  VARCHAR(255)  NOT NULL,
  value       TEXT          NOT NULL,
  expires_at  DATETIME(3)   NOT NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_verifications_identifier (identifier)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS rate_limits (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `key`         VARCHAR(255)     NOT NULL,                 -- client IP + path
  count         INT UNSIGNED     NOT NULL,
  last_request  BIGINT UNSIGNED  NOT NULL,                 -- epoch milliseconds
  UNIQUE KEY uq_rate_limits_key (`key`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS password_history (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id        INT UNSIGNED  NOT NULL,
  password_hash  VARCHAR(255)  NOT NULL,
  created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),  -- when it stopped being the password
  KEY ix_password_history_user (user_id),
  CONSTRAINT fk_password_history_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS sign_in_failures (
  user_id          INT UNSIGNED  NOT NULL PRIMARY KEY,
  failures         INT UNSIGNED  NOT NULL,            -- wrong passwords in a row
  last_failure_at  DATETIME(3)   NOT NULL,
  CONSTRAINT fk_sign_in_failures_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
