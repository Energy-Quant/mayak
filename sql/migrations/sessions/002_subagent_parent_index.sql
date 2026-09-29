-- Миграция 002: индекс для listSubagentChildren + пометка исторических сирот
-- Дата: 2026-09-29
-- Контекст: 37 sub_agent с parent_session_id=NULL (июнь 2026, до parent-трекинга).
-- Свежие субагенты пишутся с parent корректно (проверено 20260929_4 → 20260929_3).
-- Сироты НЕ восстанавливаются (родители утрачены) — помечаем description.

PRAGMA user_version = 2;

-- Индекс: путь listSubagentChildren(parent_session_id, session_type)
CREATE INDEX IF NOT EXISTS idx_sessions_parent_type
  ON sessions(parent_session_id, session_type)
  WHERE parent_session_id IS NOT NULL;

-- Пометка исторических сирот (не удаляем — это аудит)
UPDATE sessions
SET description = '[orphan:parent-unknown] ' || COALESCE(description, '')
WHERE session_type = 'sub_agent'
  AND parent_session_id IS NULL
  AND archived_at IS NULL
  AND (description IS NULL OR description NOT LIKE '[orphan%');
