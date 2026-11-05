-- Claude Code runs with the login already on this computer (plan 4.3, 2026-11-05): the app keeps no
-- token for it. A token pasted under the old design is dropped here.
UPDATE ai_provider SET key_sealed = NULL, key_hint = NULL WHERE kind = 'claude-code';
