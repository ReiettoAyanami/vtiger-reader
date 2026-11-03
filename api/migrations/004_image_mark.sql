-- A user's marks on images (plan 3.7): "this is a logo" (a signature image, set aside) or "this is
-- a photo" (shown, even when the rule took it for a logo). Per user (lenzi, 2026-11-03: "an
-- individual thing"). Saved as fingerprints, never the image: the sha256 of the bytes, a 64-bit
-- difference hash (16 hex digits) and the width / height ratio, so that the same picture, resized
-- or re-encoded in another mail, follows the mark.
CREATE TABLE IF NOT EXISTS image_mark (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  exact_hash CHAR(64) NOT NULL,
  dhash CHAR(16) NOT NULL,
  ratio DECIMAL(10, 4) NOT NULL,
  mark ENUM('logo', 'photo') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_image_mark_user_hash (user_id, exact_hash),
  CONSTRAINT fk_image_mark_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
