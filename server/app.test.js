import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.js';
import { createApp } from './app.js';

let db;
let server;
let baseUrl;
let ideasDirectory;
let ideasFile;

before(async () => {
  db = openDatabase(':memory:');
  ideasDirectory = mkdtempSync(join(tmpdir(), 'scool-tools-ideas-test-'));
  ideasFile = join(ideasDirectory, 'ideen.txt');
  server = createApp(db, { serveFrontend: false, ideasFile }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  if (db?.isOpen) db.close();
  if (ideasDirectory) rmSync(ideasDirectory, { recursive: true, force: true });
});

test('API returns the tool hub settings from SQLite', async () => {
  const response = await fetch(`${baseUrl}/api/site`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const site = await response.json();
  assert.equal(site.schoolName, 'Realschule Zusmarshausen');
  assert.equal(site.className, '8a');
  assert.equal(site.projectName, 'Scool Tools');
  assert.equal('modules' in site, false);
});

test('API reflects persisted content rather than a static response', async () => {
  db.prepare('UPDATE site_settings SET welcome_text = ? WHERE id = 1').run('Hallo aus der Datenbank!');
  const site = await fetch(`${baseUrl}/api/site`).then(response => response.json());
  assert.equal(site.welcomeText, 'Hallo aus der Datenbank!');
});

test('ideas can be submitted and are validated', async () => {
  const response = await fetch(`${baseUrl}/api/ideas`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Bitte ergänzt ein Quiz-Tool.' }),
  });
  assert.equal(response.status, 201);
  const saved = readFileSync(ideasFile, 'utf8');
  assert.match(saved, /^\[\d{4}-\d{2}-\d{2}T/);
  assert.match(saved, /Bitte ergänzt ein Quiz-Tool\.\n\n---/);

  const empty = await fetch(`${baseUrl}/api/ideas`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: '   ' }),
  });
  assert.equal(empty.status, 400);
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

test('traffic classes separate teacher and student access and persist live colors', async () => {
  const createdResponse = await fetch(`${baseUrl}/api/traffic-rooms`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Gruppenarbeit 8a' }),
  });
  assert.equal(createdResponse.status, 201);
  const room = await createdResponse.json();
  assert.match(room.id, /^[A-Z2-9]{6}$/);
  assert.ok(room.teacherKey);

  const publicRoom = await fetch(`${baseUrl}/api/traffic-rooms/${room.id}`).then(response => response.json());
  assert.deepEqual({ id: publicRoom.id, name: publicRoom.name }, { id: room.id, name: 'Gruppenarbeit 8a' });
  assert.equal(publicRoom.teacherKey, undefined);
  assert.equal((await fetch(`${baseUrl}/api/traffic-rooms/${room.id}/status`)).status, 403);

  const joinedResponse = await fetch(`${baseUrl}/api/traffic-rooms/${room.id}/students`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Mia' }),
  });
  assert.equal(joinedResponse.status, 201);
  const student = await joinedResponse.json();
  assert.ok(student.studentKey);
  assert.equal(student.color, null);

  const duplicateName = await fetch(`${baseUrl}/api/traffic-rooms/${room.id}/students`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'mia' }),
  });
  assert.equal(duplicateName.status, 409);
  const deniedColor = await fetch(`${baseUrl}/api/traffic-rooms/${room.id}/students/${student.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-student-key': 'falsch' },
    body: JSON.stringify({ color: 'green' }),
  });
  assert.equal(deniedColor.status, 403);

  const selected = await fetch(`${baseUrl}/api/traffic-rooms/${room.id}/students/${student.id}`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-student-key': student.studentKey },
    body: JSON.stringify({ color: 'yellow' }),
  });
  assert.equal(selected.status, 200);
  assert.equal((await selected.json()).color, 'yellow');

  const statusResponse = await fetch(`${baseUrl}/api/traffic-rooms/${room.id}/status`, {
    headers: { 'x-teacher-key': room.teacherKey },
  });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.students.length, 1);
  assert.deepEqual({ name: status.students[0].name, color: status.students[0].color }, { name: 'Mia', color: 'yellow' });
  assert.equal(status.students[0].studentKey, undefined);
});

test('accounts keep owned and explicitly saved projects available across devices', async () => {
  const register = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Projektbesitzer', password: 'sicheres-passwort' }),
  });
  assert.equal(register.status, 201);
  const ownerCookie = register.headers.get('set-cookie').split(';')[0];
  assert.match(register.headers.get('set-cookie'), /HttpOnly/);
  assert.match(register.headers.get('set-cookie'), /SameSite=Lax/);

  const created = await fetch(`${baseUrl}/api/workspaces`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ type: 'whiteboard' }),
  }).then(response => response.json());
  const ownerAccount = await fetch(`${baseUrl}/api/account`, { headers: { cookie: ownerCookie } }).then(response => response.json());
  assert.equal(ownerAccount.projects.length, 1);
  assert.equal(ownerAccount.projects[0].role, 'owner');
  assert.equal(ownerAccount.projects[0].editKey, created.editKey);

  const secondRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Projektgast', password: 'noch-sicherer' }),
  });
  const guestCookie = secondRegistration.headers.get('set-cookie').split(';')[0];
  await fetch(`${baseUrl}/api/workspaces/${created.id}`);
  let guestAccount = await fetch(`${baseUrl}/api/account`, { headers: { cookie: guestCookie } }).then(response => response.json());
  assert.equal(guestAccount.projects.length, 0, 'opening a share link must not save it to the account');

  const savedView = await fetch(`${baseUrl}/api/account/projects/${created.id}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: guestCookie }, body: '{}',
  });
  assert.equal(savedView.status, 201);
  guestAccount = await fetch(`${baseUrl}/api/account`, { headers: { cookie: guestCookie } }).then(response => response.json());
  assert.equal(guestAccount.projects[0].role, 'view');
  assert.equal(guestAccount.projects[0].editKey, null);

  await fetch(`${baseUrl}/api/account/projects/${created.id}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: guestCookie },
    body: JSON.stringify({ editKey: created.editKey }),
  });
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'projektGAST', password: 'noch-sicherer' }),
  });
  assert.equal(login.status, 200);
  const secondDeviceCookie = login.headers.get('set-cookie').split(';')[0];
  guestAccount = await fetch(`${baseUrl}/api/account`, { headers: { cookie: secondDeviceCookie } }).then(response => response.json());
  assert.equal(guestAccount.projects[0].role, 'edit');
  assert.equal(guestAccount.projects[0].editKey, created.editKey);

  const storedUser = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('Projektgast');
  assert.equal(storedUser.password_hash.includes('noch-sicherer'), false);
  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { cookie: secondDeviceCookie } });
  assert.equal(logout.status, 204);
  assert.equal((await fetch(`${baseUrl}/api/account`, { headers: { cookie: secondDeviceCookie } })).status, 401);
});

test('account validation rejects duplicate names and bad passwords', async () => {
  const duplicate = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'PROJEKTBESITZER', password: 'anderes-passwort' }),
  });
  assert.equal(duplicate.status, 409);
  const shortPassword = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Neuer Name', password: 'kurz' }),
  });
  assert.equal(shortPassword.status, 400);
  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Projektbesitzer', password: 'falsches-passwort' }),
  });
  assert.equal(badLogin.status, 401);
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
    assert.equal(persistentDb.prepare('PRAGMA user_version').get().user_version, 7);
  } finally {
    if (persistentDb?.isOpen) persistentDb.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
