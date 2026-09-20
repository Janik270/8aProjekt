const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function cleanupExpiredData(db, {
  now = new Date(),
  workspaceRetentionDays = positiveInteger(process.env.WORKSPACE_RETENTION_DAYS, 180),
  trafficRetentionHours = positiveInteger(process.env.TRAFFIC_RETENTION_HOURS, 48),
} = {}) {
  const nowIso = now.toISOString();
  const workspaceCutoff = new Date(now.getTime() - workspaceRetentionDays * DAY).toISOString();
  const trafficCutoff = new Date(now.getTime() - trafficRetentionHours * HOUR).toISOString();
  const usageCutoff = now.getTime() - 2 * DAY;

  const sessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso).changes;
  const trafficRooms = db.prepare('DELETE FROM traffic_rooms WHERE updated_at < ?').run(trafficCutoff).changes;
  const workspaces = db.prepare(`
    DELETE FROM workspaces
    WHERE updated_at < ?
      AND NOT EXISTS (SELECT 1 FROM account_workspaces WHERE account_workspaces.workspace_id = workspaces.id)
  `).run(workspaceCutoff).changes;
  const usageBuckets = db.prepare('DELETE FROM security_usage WHERE window_start < ?').run(usageCutoff).changes;
  return { sessions, trafficRooms, workspaces, usageBuckets };
}

export function startMaintenance(db, { intervalMs = 6 * HOUR } = {}) {
  cleanupExpiredData(db);
  const timer = setInterval(() => {
    try { cleanupExpiredData(db); }
    catch (error) { console.error('Automatische Bereinigung fehlgeschlagen:', error.message); }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
