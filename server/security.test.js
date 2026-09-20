import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.js';
import { openDatabase } from './database.js';
import { cleanupExpiredData } from './maintenance.js';
import { hasAllowedWebSocketOrigin } from './security.js';

async function fixture(t, options = {}) {
  const db = openDatabase(':memory:');
  const app = createApp(db, { serveFrontend: false, ...options });
  const server = createServer(app);
  const closeLive = app.locals.collaboration.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    closeLive();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  return { db, base };
}

test('security headers and same-origin protection are active', async t => {
  const { base } = await fixture(t);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(health.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(health.headers.get('permissions-policy'), /camera=\(\)/);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');

  const foreignWrite = await fetch(`${base}/api/workspaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://angreifer.example' },
    body: JSON.stringify({ type: 'writer' }),
  });
  assert.equal(foreignWrite.status, 403);
});

test('WebSocket origin checks work behind HTTPS reverse proxies', () => {
  const request = (headers, remoteAddress = '127.0.0.1') => ({ headers, socket: { remoteAddress } });
  assert.equal(hasAllowedWebSocketOrigin(request({ origin: 'https://tools.example.de', host: 'tools.example.de' })), true);
  assert.equal(hasAllowedWebSocketOrigin(request({
    origin: 'https://tools.example.de',
    host: '127.0.0.1:3001',
    'x-forwarded-host': 'tools.example.de',
    'x-forwarded-proto': 'https',
  })), true);
  assert.equal(hasAllowedWebSocketOrigin(request({
    origin: 'https://tools.example.de', host: 'tools.example.de', 'x-forwarded-proto': 'http',
  })), false);
  assert.equal(hasAllowedWebSocketOrigin(request({ origin: 'https://angreifer.example', host: 'tools.example.de' })), false);
  assert.equal(hasAllowedWebSocketOrigin(request({ origin: 'keine-url', host: 'tools.example.de' })), false);
});

test('route rate limits reject bot bursts without blocking normal requests', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'scool-security-ideas-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { base } = await fixture(t, {
    ideasFile: join(directory, 'ideen.txt'),
    securityOptions: { ideaLimit: 2, writeLimit: 100, apiLimit: 1_000 },
  });
  const sendIdea = message => fetch(`${base}/api/ideas`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }),
  });
  assert.equal((await sendIdea('Erste Idee')).status, 201);
  assert.equal((await sendIdea('Zweite Idee')).status, 201);
  const limited = await sendIdea('Bot-Idee');
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /Zu viele Anfragen/);
});

test('registration and failed-login bursts are limited independently', async t => {
  const registration = await fixture(t, {
    securityOptions: { registerLimit: 2, writeLimit: 100, apiLimit: 1_000 },
  });
  const register = (base, username) => fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'Sicheres-Passwort-2026' }),
  });
  assert.equal((await register(registration.base, 'Klasse Eins')).status, 201);
  assert.equal((await register(registration.base, 'Klasse Zwei')).status, 201);
  assert.equal((await register(registration.base, 'Klasse Drei')).status, 429);

  const login = await fixture(t, {
    securityOptions: { loginAccountLimit: 2, loginIpLimit: 100, registerLimit: 100, writeLimit: 100, apiLimit: 1_000 },
  });
  assert.equal((await register(login.base, 'Lehrkraft')).status, 201);
  const injection = await fetch(`${login.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: "' OR 1=1 --", password: 'Sicheres-Passwort-2026' }),
  });
  assert.equal(injection.status, 401);
  assert.equal(login.db.prepare('SELECT count(*) AS count FROM users').get().count, 1);
  const wrongLogin = () => fetch(`${login.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Lehrkraft', password: 'Falsches-Passwort' }),
  });
  assert.equal((await wrongLogin()).status, 401);
  assert.equal((await wrongLogin()).status, 401);
  assert.equal((await wrongLogin()).status, 429);
});

test('thirty students behind one school IP can join a traffic room concurrently', async t => {
  const { base } = await fixture(t);
  const roomResponse = await fetch(`${base}/api/traffic-rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Klasse mit 30 Geräten' }),
  });
  assert.equal(roomResponse.status, 201);
  const room = await roomResponse.json();
  const joins = await Promise.all(Array.from({ length: 30 }, (_, index) => fetch(`${base}/api/traffic-rooms/${room.id}/students`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `Kind ${index + 1}` }),
  })));
  assert.deepEqual([...new Set(joins.map(response => response.status))], [201]);
  const status = await fetch(`${base}/api/traffic-rooms/${room.id}/status`, { headers: { 'x-teacher-key': room.teacherKey } });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).students.length, 30);
});

test('SSE connections have per-IP and total concurrency limits', async t => {
  const { base } = await fixture(t, { liveConnectionOptions: { maxPerIp: 2, maxTotal: 2 } });
  const workspace = await fetch(`${base}/api/workspaces`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'writer' }),
  }).then(response => response.json());
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = await fetch(`${base}/api/workspaces/${workspace.id}/events`, { signal: firstController.signal });
  const second = await fetch(`${base}/api/workspaces/${workspace.id}/events`, { signal: secondController.signal });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const rejected = await fetch(`${base}/api/workspaces/${workspace.id}/events`);
  assert.equal(rejected.status, 429);
  firstController.abort();
  secondController.abort();
});

test('oversized JSON is rejected before it reaches a route', async t => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}/api/ideas`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x'.repeat(5 * 1024 * 1024) }),
  });
  assert.equal(response.status, 413);
});

test('maintenance removes expired data but retains account projects', () => {
  const db = openDatabase(':memory:');
  const now = new Date('2026-09-20T12:00:00.000Z');
  const old = '2025-01-01T00:00:00.000Z';
  try {
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run('user-1', 'Archiv', 'salt:hash', old);
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run('expired', 'user-1', old, old);
    const insertWorkspace = db.prepare(`
      INSERT INTO workspaces (id, type, title, content, edit_key_hash, created_at, updated_at)
      VALUES (?, 'writer', ?, '<p>alt</p>', 'hash', ?, ?)
    `);
    insertWorkspace.run('anonymous-old', 'Anonym', old, old);
    insertWorkspace.run('saved-old', 'Gespeichert', old, old);
    db.prepare("INSERT INTO account_workspaces (user_id, workspace_id, role, edit_key, added_at) VALUES ('user-1', 'saved-old', 'owner', 'key', ?)").run(old);
    db.prepare("INSERT INTO traffic_rooms (id, name, teacher_key_hash, created_at, updated_at) VALUES ('ABC234', 'Alt', 'hash', ?, ?)").run(old, old);
    db.prepare("INSERT INTO security_usage (kind, subject_hash, window_start, count) VALUES ('idea', 'ip', ?, 1)").run(now.getTime() - 3 * 24 * 60 * 60 * 1_000);

    const result = cleanupExpiredData(db, { now, workspaceRetentionDays: 180, trafficRetentionHours: 48 });
    assert.deepEqual(result, { sessions: 1, trafficRooms: 1, workspaces: 1, usageBuckets: 1 });
    assert.equal(db.prepare('SELECT count(*) AS count FROM workspaces WHERE id = ?').get('anonymous-old').count, 0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM workspaces WHERE id = ?').get('saved-old').count, 1);
  } finally {
    db.close();
  }
});
