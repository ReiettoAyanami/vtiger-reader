-- Claude Code with the user's own Claude subscription as an AI provider (lenzi, 2026-11-03): its key
-- is the long-lived token its owner made with `claude setup-token` (modules/ai/claude-code.ts).
ALTER TABLE ai_provider
  MODIFY kind ENUM('anthropic', 'openai', 'gemini', 'openai-compatible', 'ollama', 'claude-code') NOT NULL;
