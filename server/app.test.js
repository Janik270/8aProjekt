import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.js';
import { createApp } from './app.js';

let db;
let server;
let baseUrl;

before(async () => {
  db = openDatabase(':memory:');
  server = createApp(db, { serveFrontend: false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (db?.isOpen) db.close();
});

test('API returns the tool hub settings from SQLite', async () => {
  const response = await fetch(`${baseUrl}/api/site`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const site = await response.json();
  assert.equal(site.schoolName, 'Realschule Zusmarshausen');
  assert.equal(site.className, '8a');
  assert.equal(site.projectName, '8a Tools');
  assert.equal('modules' in site, false);
});

test('API reflects persisted content rather than a static response', async () => {
  db.prepare('UPDATE site_settings SET welcome_text = ? WHERE id = 1').run('Hallo aus der Datenbank!');
  const site = await fetch(`${baseUrl}/api/site`).then(response => response.json());
  assert.equal(site.welcomeText, 'Hallo aus der Datenbank!');
});

test('health check verifies database connection', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
});

test('workspaces can be created, viewed and only edited with their secret key', async () => {
  const createdResponse = await fetch(`${baseUrl}/api/workspaces`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'writer' }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.ok(created.id);
  assert.ok(created.editKey);

  const viewed = await fetch(`${baseUrl}/api/workspaces/${created.id}`).then(response => response.json());
  assert.equal(viewed.type, 'writer');
  assert.equal(viewed.editKey, undefined);

  const denied = await fetch(`${baseUrl}/api/workspaces/${created.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Nein' }),
  });
  assert.equal(denied.status, 403);
  const updated = await fetch(`${baseUrl}/api/workspaces/${created.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-edit-key': created.editKey }, body: JSON.stringify({ title: 'Unser Text', content: '<p>Hallo 8a</p>' }),
  });
  assert.equal(updated.status, 200);
  const final = await fetch(`${baseUrl}/api/workspaces/${created.id}`).then(response => response.json());
  assert.equal(final.title, 'Unser Text');
  assert.equal(final.content, '<p>Hallo 8a</p>');

  const deleteDenied = await fetch(`${baseUrl}/api/workspaces/${created.id}`, { method: 'DELETE' });
  assert.equal(deleteDenied.status, 403);
  const deleted = await fetch(`${baseUrl}/api/workspaces/${created.id}`, {
    method: 'DELETE', headers: { 'x-edit-key': created.editKey },
  });
  assert.equal(deleted.status, 204);
  assert.equal((await fetch(`${baseUrl}/api/workspaces/${created.id}`)).status, 404);
});

test('unknown API routes and invalid workspace types are rejected', async () => {
  const missing = await fetch(`${baseUrl}/api/missing`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);
  const invalid = await fetch(`${baseUrl}/api/workspaces`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'kalender' }),
  });
  assert.equal(invalid.status, 400);
});

test('database initialization preserves edits across restarts without duplicate seeds', () => {
  const directory = mkdtempSync(join(tmpdir(), '8a-db-test-'));
  const filename = join(directory, 'test.sqlite');
  let persistentDb;
  try {
    persistentDb = openDatabase(filename);
    persistentDb.prepare('UPDATE site_settings SET welcome_text = ? WHERE id = 1').run('Bleibt gespeichert');
    persistentDb.close();
    persistentDb = openDatabase(filename);
    assert.equal(persistentDb.prepare('SELECT welcome_text FROM site_settings').get().welcome_text, 'Bleibt gespeichert');
    assert.equal(persistentDb.prepare('SELECT count(*) AS count FROM workspaces').get().count, 0);
    assert.equal(persistentDb.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'modules'").get().count, 0);
    assert.equal(persistentDb.prepare('PRAGMA user_version').get().user_version, 2);
  } finally {
    if (persistentDb?.isOpen) persistentDb.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
