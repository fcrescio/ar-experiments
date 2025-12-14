const SESSION_KEY = 'xrnotes-session-id';

function generateSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(16).slice(2);
}

export function initSessionLabel(targetId) {
  const existing = localStorage.getItem(SESSION_KEY);
  const sessionId = existing || generateSessionId();
  if (!existing) localStorage.setItem(SESSION_KEY, sessionId);
  const el = document.getElementById(targetId);
  if (el) el.textContent = `Session: ${sessionId}`;
  return sessionId;
}
