-- Each user's own lists of tickets (lenzi, 2026-11-03: "the lists should be a relation to the user
-- itself"): the CRM's saved lists cannot be read with an access key, so each user makes theirs
-- here. A list is a name and a filter (modules/lists/filter.ts: whose tickets, which status, which
-- category or support group): a preference, no ticket. Ordered by position.
CREATE TABLE IF NOT EXISTS ticket_list (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  filter JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_ticket_list_user (user_id, position),
  CONSTRAINT fk_ticket_list_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- The users there are already start with the default lists (filter.ts, DEFAULT_LISTS); a user who
-- has lists keeps them, so running this again changes nothing.
INSERT INTO ticket_list (user_id, position, name, filter)
SELECT u.id, d.position, d.name, CAST(d.filter AS JSON)
  FROM users u
  JOIN (
    SELECT 0 AS position, 'My tickets' AS name, '{"owner":"me","status":"any"}' AS filter
    UNION ALL SELECT 1, 'My open tickets', '{"owner":"me","status":"open"}'
    UNION ALL SELECT 2, 'My closed tickets', '{"owner":"me","status":"closed"}'
    UNION ALL SELECT 3, 'Unassigned', '{"owner":"groups","status":"open"}'
    UNION ALL SELECT 4, 'All open tickets', '{"owner":"anyone","status":"open"}'
    UNION ALL SELECT 5, 'All tickets', '{"owner":"anyone","status":"any"}'
  ) d
 WHERE NOT EXISTS (SELECT 1 FROM ticket_list t WHERE t.user_id = u.id);
