/**
 * Модульное хранилище последней открытой ACP-сессии.
 * Переживает remount ChatPage (переключения страниц) — connect() вместо
 * session/new делает session/load(lastSid), история replay'ится, список
 * субагентов (listSubagents по parentId) не «теряется».
 */
export const chatSession = { lastSid: null as string | null };
