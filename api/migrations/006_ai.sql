-- The AI help of each user (plan 4): their own providers, which model does which task, and how
-- much they used. Preferences and counters only: no ticket, no prompt, no answer is stored.

-- A provider the user has an account with (lenzi, 2026-11-03: "every user must be able to decide
-- which Provider to use"): its kind, a label, the address when the kind needs one, the API key
-- sealed with ENCRYPTION_KEY (context "ai_provider:<user id>"), never sent back to the browser.
CREATE TABLE IF NOT EXISTS ai_provider (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind ENUM('anthropic', 'openai', 'gemini', 'openai-compatible', 'ollama') NOT NULL,
  label VARCHAR(80) NOT NULL,
  base_url VARCHAR(255) NULL,
  key_sealed VARCHAR(1024) NULL,
  key_hint VARCHAR(8) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_ai_provider_user (user_id),
  CONSTRAINT fk_ai_provider_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Which model does which task ("and also what model for what"): one row per task, 'default' for
-- every task without its own. A provider deleted takes its rows with it.
CREATE TABLE IF NOT EXISTS ai_task_model (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  task ENUM('default', 'summary', 'reply', 'photos', 'history', 'question') NOT NULL,
  provider_id INT UNSIGNED NOT NULL,
  model VARCHAR(200) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_ai_task_model_user_task (user_id, task),
  CONSTRAINT fk_ai_task_model_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_ai_task_model_provider FOREIGN KEY (provider_id) REFERENCES ai_provider (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Tokens used, per user, day (UTC), provider kind, model and task (plan 4.7).
CREATE TABLE IF NOT EXISTS ai_usage (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  day DATE NOT NULL,
  kind VARCHAR(30) NOT NULL,
  model VARCHAR(200) NOT NULL,
  task VARCHAR(20) NOT NULL,
  calls INT UNSIGNED NOT NULL DEFAULT 0,
  tokens_in BIGINT UNSIGNED NOT NULL DEFAULT 0,
  tokens_out BIGINT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_ai_usage (user_id, day, kind, model, task),
  CONSTRAINT fk_ai_usage_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
