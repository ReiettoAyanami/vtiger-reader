-- Notifications (plan 5): when a new ticket arrives, the users it is for hear of it. All
-- preferences and bookkeeping, nothing of the CRM: the tickets are read from the CRM each time.
--
-- ticket_list.notify      which of the user's own lists a new ticket must be in to notify them
--                         ("for me": plan 5.1-5.2). The lists that are "mine, open" and
--                         "unassigned, open" notify from the start.
-- notification_state      one row per user, made at their first check:
--   enabled               the master switch (on unless the user turns it off; no quiet hours:
--                         lenzi, 2026-11-03, "no time limits").
--   watermark             the newest createdtime of the user's CRM already looked at (the CRM's
--                         own UTC time, plan 2.1): the next check asks for tickets after it. NULL:
--                         the next check only sets it, without notifying (a new user, a user who
--                         just turned notifications on, is not sent the CRM's past).
--   bell_seen_at          the createdtime of the newest ticket the bell showed when its user last
--                         opened it: the bell lists the tickets after it (read from the CRM).
-- push_subscription       each browser / device a user allowed push notifications on (Web Push,
--                         RFC 8030): the push service's endpoint and the keys that encrypt for it.
--                         A dead one (the push service answers 404 / 410) goes.
-- push_vapid              the instance's own VAPID key pair (RFC 8292), made at the first start:
--                         the push services know the instance by it. The private key is sealed
--                         with ENCRYPTION_KEY.

-- MySQL has no ADD COLUMN IF NOT EXISTS: the column, and its starting values, only when missing
-- (run again, this changes nothing, not even a list the user turned off since).
SET @add_notify := (SELECT COUNT(*) = 0 FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ticket_list' AND COLUMN_NAME = 'notify');

SET @sql := IF(@add_notify, 'ALTER TABLE ticket_list ADD COLUMN notify BOOLEAN NOT NULL DEFAULT FALSE AFTER filter', 'DO 0');
PREPARE step FROM @sql;
EXECUTE step;
DEALLOCATE PREPARE step;

SET @sql := IF(@add_notify,
  'UPDATE ticket_list SET notify = TRUE
    WHERE JSON_UNQUOTE(JSON_EXTRACT(filter, ''$.status'')) = ''open''
      AND JSON_UNQUOTE(JSON_EXTRACT(filter, ''$.owner'')) IN (''me'', ''groups'')
      AND JSON_EXTRACT(filter, ''$.picks'') IS NULL',
  'DO 0');
PREPARE step FROM @sql;
EXECUTE step;
DEALLOCATE PREPARE step;

CREATE TABLE IF NOT EXISTS notification_state (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  watermark DATETIME NULL,
  bell_seen_at DATETIME NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_notification_state_user (user_id),
  CONSTRAINT fk_notification_state_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS push_subscription (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  endpoint VARCHAR(1000) NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_push_subscription_endpoint (endpoint_hash),
  KEY ix_push_subscription_user (user_id),
  CONSTRAINT fk_push_subscription_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS push_vapid (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  public_key VARCHAR(200) NOT NULL,
  private_key_sealed VARCHAR(500) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT ck_push_vapid_one CHECK (id = 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
