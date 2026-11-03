-- 002_user_settings: one row per user, their preferences for the interface.
--
-- This database holds users and their preferences, never what the CRM already holds (lenzi,
-- 2026-11-03: "we should never store informations that are already stored in the DB", "We just
-- store users preferences"). Later steps add their own per-user tables (the CRM link, AI providers
-- and models, image marks, push subscriptions), each with user_id.
--
-- language  the interface's language: 'en' only for now, a per-user choice later.
-- timezone  the IANA zone the CRM's times are shown in.
--
-- Safe to re-run: created only when missing.

CREATE TABLE IF NOT EXISTS user_settings (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED  NOT NULL,
  language    VARCHAR(10)   NOT NULL DEFAULT 'en',
  timezone    VARCHAR(64)   NOT NULL DEFAULT 'Europe/Rome',
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_user_settings_user (user_id),
  CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
