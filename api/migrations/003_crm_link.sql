-- Each user's own CRM account (plan 2.2): the CRM's address (set from the interface, not .env:
-- lenzi, 2026-11-03), the username and the access key they gave when linking it, the key sealed
-- with ENCRYPTION_KEY (shared/secret-box.ts, context "crm_link:<user id>"), never sent back to the
-- browser. One per user; unlinking deletes the row.
--
-- crm_user_id is the CRM's id of that account (e.g. 19x5), as the login answered: "assigned to me".
-- Nothing else of the CRM is stored here.
CREATE TABLE IF NOT EXISTS crm_link (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  crm_url VARCHAR(255) NOT NULL,
  crm_username VARCHAR(100) NOT NULL,
  access_key_sealed VARCHAR(255) NOT NULL,
  crm_user_id VARCHAR(32) NOT NULL,
  linked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_crm_link_user (user_id),
  CONSTRAINT fk_crm_link_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
