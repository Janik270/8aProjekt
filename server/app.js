import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { projectRoot } from './database.js';
import { createCollaboration } from './collaboration.js';
import { installAccounts, saveOwnedWorkspace } from './accounts.js';
import { installTraffic } from './traffic.js';

const TOOL_TYPES = new Set(['whiteboard', 'writer']);
const MAX_CONTENT_LENGTH = 8 * 1024 * 1024;

function hashKey(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hasValidKey(storedHash, providedKey) {
  if (!providedKey) return false;
  const actual = Buffer.from(hashKey(providedKey));
  const expected = Buffer.from(storedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicWorkspace(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createApp(db, { serveFrontend = true } = {}) {
  const app = express();
  app.locals.collaboration = createCollaboration(db);
  const workspaceStreams = new Map();

  const broadcastWorkspace = (id, event, payload, close = false) => {
    const streams = workspaceStreams.get(id);
    if (!streams) return;
    const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const response of streams) {
      response.write(message);
      if (close) response.end();
    }
    if (close) workspaceStreams.delete(id);
  };

  app.disable('x-powered-by');
  app.use(express.json({ limit: '9mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  installAccounts(app, db, hasValidKey);
  installTraffic(app, db, { hashKey, hasValidKey });
  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', database: 'connected' });
  });
  app.get('/api/site', (_req, res) => {
    const settings = db.prepare(`
      SELECT project_name AS projectName, school_name AS schoolName,
        class_name AS className, welcome_text AS welcomeText
      FROM site_settings WHERE id = 1
    `).get();
    if (!settings) throw new Error('Site settings are missing.');
    res.json({ ...settings });
  });
  app.get('/api/workspaces/:id/events', (req, res) => {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Dieser Arbeitsbereich wurde nicht gefunden.' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const streams = workspaceStreams.get(row.id) || new Set();
    streams.add(res);
    workspaceStreams.set(row.id, streams);
    res.write(`retry: 1000\nevent: workspace\ndata: ${JSON.stringify(publicWorkspace(row))}\n\n`);
    const heartbeat = setInterval(() => res.write(': verbunden\n\n'), 20_000);
    heartbeat.unref();
    req.on('close', () => {
      clearInterval(heartbeat);
      streams.delete(res);
      if (streams.size === 0) workspaceStreams.delete(row.id);
    });
  });
  app.post('/api/workspaces', (req, res) => {
    const type = typeof req.body?.type === 'string' ? req.body.type : '';
    if (!TOOL_TYPES.has(type)) return res.status(400).json({ error: 'Unbekanntes Werkzeug.' });
    const id = randomUUID();
    const editKey = randomBytes(24).toString('base64url');
    const now = new Date().toISOString();
    const title = type === 'whiteboard' ? 'Unbenanntes Whiteboard' : 'Unbenanntes Dokument';
    const content = type === 'whiteboard'
      ? JSON.stringify({ elements: [], appState: { viewBackgroundColor: '#f8f9fc' }, files: {} })
      : '<h1>Gemeinsam losschreiben</h1><p>Tippe hier, um euer Dokument zu beginnen …</p>';
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO workspaces (id, type, title, content, edit_key_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, type, title, content, hashKey(editKey), now, now);
      saveOwnedWorkspace(db, req.user, id, editKey, now);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json({ id, type, title, editKey, createdAt: now, updatedAt: now });
  });
  app.get('/api/workspaces/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Dieser Arbeitsbereich wurde nicht gefunden.' });
    res.json(publicWorkspace(row));
  });
  app.put('/api/workspaces/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Dieser Arbeitsbereich wurde nicht gefunden.' });
    if (!hasValidKey(row.edit_key_hash, req.get('x-edit-key'))) {
      return res.status(403).json({ error: 'Dieser Link erlaubt nur das Ansehen.' });
    }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : row.title;
    const content = typeof req.body?.content === 'string' ? req.body.content : row.content;
    if (!title || title.length > 120 || content.length > MAX_CONTENT_LENGTH) {
      return res.status(400).json({ error: 'Titel oder Inhalt ist ungültig.' });
    }
    if (row.y_state && content !== row.content) {
      return res.status(409).json({ error: 'Dieses Projekt wird live bearbeitet. Bitte verwende den Editor.' });
    }
    app.locals.collaboration.rename(row.id, title);
    const updatedAt = new Date().toISOString();
    db.prepare('UPDATE workspaces SET title = ?, content = ?, updated_at = ? WHERE id = ?')
      .run(title, content, updatedAt, row.id);
    const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(row.id);
    broadcastWorkspace(row.id, 'workspace', publicWorkspace(updated));
    res.json({ id: row.id, title, updatedAt });
  });
  app.delete('/api/workspaces/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Dieser Arbeitsbereich wurde nicht gefunden.' });
    if (!hasValidKey(row.edit_key_hash, req.get('x-edit-key'))) {
      return res.status(403).json({ error: 'Zum Löschen wird der Bearbeitungslink benötigt.' });
    }
    app.locals.collaboration.remove(row.id);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(row.id);
    broadcastWorkspace(row.id, 'deleted', { id: row.id }, true);
    res.status(204).end();
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Diese Schnittstelle gibt es noch nicht.' });
  });

  const frontendPath = join(projectRoot, 'dist');
  if (serveFrontend && existsSync(join(frontendPath, 'index.html'))) {
    app.use(express.static(frontendPath));
    app.get('/', (_req, res) => res.sendFile(join(frontendPath, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('8a API läuft. Entwicklung: http://localhost:5173 · Für die fertige Website zuerst npm run build ausführen.'));
  }
  app.use((error, _req, res, _next) => {
    console.error('Serverfehler:', error.message);
    res.status(500).json({ error: 'Die Daten konnten gerade nicht geladen werden. Bitte versuche es noch einmal.' });
  });
  return app;
}
