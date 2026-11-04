-- vtiger-reader's database (plan 7.3): SQLite, one file in the user's profile folder. It holds the
-- profile's preferences only: nothing of the CRM (decision of 2026-11-03).
-- Times are ISO 8601 text in UTC ('2026-11-04T10:00:00.000Z'), except the notification marks,
-- which are the CRM's own times ('2026-11-04 10:00:00', UTC). Booleans are 0 / 1.
-- This one script replaces the MySQL migrations 001-008 of the server version.

-- The app's profiles: one, made at the first start (plan 7.1).
CREATE TABLE users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE user_settings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users (id),
  language    TEXT    NOT NULL DEFAULT 'en',
  timezone    TEXT    NOT NULL DEFAULT 'Europe/Rome',
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The profile's own CRM account: the access key sealed with the app's key.
CREATE TABLE crm_link (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL UNIQUE REFERENCES users (id),
  crm_url            TEXT    NOT NULL,
  crm_username       TEXT    NOT NULL,
  access_key_sealed  TEXT    NOT NULL,
  crm_user_id        TEXT    NOT NULL,
  linked_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at      TEXT    NULL,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Which attachments are a logo or a photo, by the image's fingerprints.
CREATE TABLE image_mark (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id),
  exact_hash  TEXT    NOT NULL,
  dhash       TEXT    NOT NULL,
  ratio       REAL    NOT NULL,
  mark        TEXT    NOT NULL CHECK (mark IN ('logo', 'photo')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, exact_hash)
);

-- The profile's own lists of tickets (a filter over the CRM), and which ones notify.
CREATE TABLE ticket_list (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id),
  position    INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  filter      TEXT    NOT NULL CHECK (json_valid(filter)),
  notify      INTEGER NOT NULL DEFAULT 0 CHECK (notify IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ix_ticket_list_user ON ticket_list (user_id, position);

-- The AI: the profile's providers (keys sealed), which model does which task, what was used.
CREATE TABLE ai_provider (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id),
  kind        TEXT    NOT NULL CHECK (kind IN ('anthropic', 'openai', 'gemini', 'openai-compatible', 'ollama', 'claude-code')),
  label       TEXT    NOT NULL,
  base_url    TEXT    NULL,
  key_sealed  TEXT    NULL,
  key_hint    TEXT    NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ix_ai_provider_user ON ai_provider (user_id);

CREATE TABLE ai_task_model (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users (id),
  task         TEXT    NOT NULL CHECK (task IN ('default', 'summary', 'reply', 'photos', 'history', 'question')),
  provider_id  INTEGER NOT NULL REFERENCES ai_provider (id) ON DELETE CASCADE,
  model        TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, task)
);

CREATE TABLE ai_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users (id),
  day         TEXT    NOT NULL,
  kind        TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  task        TEXT    NOT NULL,
  calls       INTEGER NOT NULL DEFAULT 0,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, day, kind, model, task)
);

-- Notifications: the switch, how far the checks have looked, when the bell was last opened.
CREATE TABLE notification_state (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users (id),
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  watermark     TEXT    NULL,
  bell_seen_at  TEXT    NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
