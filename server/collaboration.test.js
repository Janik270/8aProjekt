import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import { openDatabase } from './database.js';
import { createApp } from './app.js';

async function fixture(t, type = 'writer', appOptions = {}) {
  const db = openDatabase(':memory:');
  const app = createApp(db, { serveFrontend: false, ...appOptions });
  const server = createServer(app);
  const closeLive = app.locals.collaboration.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const workspace = await fetch(`${base}/api/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type }) }).then(response => response.json());
  const clients = [];
  t.after(async () => {
    for (const client of clients) { client.ws.terminate(); client.awareness.destroy(); client.doc.destroy(); }
    closeLive();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const connect = async editKey => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/workspaces/${workspace.id}/live`);
    const messages = [];
    let resolveSync;
    const synced = new Promise(resolve => { resolveSync = resolve; });
    ws.on('message', raw => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
      if (message.type === 'sync' || message.type === 'update') Y.applyUpdate(doc, Buffer.from(message.data, 'base64'));
      if (message.type === 'awareness') applyAwarenessUpdate(awareness, Buffer.from(message.data, 'base64'), ws);
      if (message.type === 'sync') resolveSync();
    });
    const client = { ws, doc, awareness, messages, send: message => ws.send(JSON.stringify(message)) };
    clients.push(client);
    await once(ws, 'open');
    client.send({ type: 'join', clientID: doc.clientID, editKey });
    await synced;
    return client;
  };
  return { db, base, workspace, connect };
}

async function eventually(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(predicate(), 'Expected live state did not arrive');
}

test('concurrent text operations merge, persist and initialize new clients only once', async t => {
  const { workspace, connect, db } = await fixture(t);
  const [alice, bob] = await Promise.all([connect(workspace.editKey), connect(workspace.editKey)]);
  const original = alice.doc.getXmlFragment('default').toString();
  assert.equal(bob.doc.getXmlFragment('default').toString(), original);
  const updates = [];
  for (const [client, text] of [[alice, 'Apfel'], [bob, 'Birne']]) {
    const vector = Y.encodeStateVector(client.doc);
    const paragraph = client.doc.getXmlFragment('default').get(1);
    paragraph.get(0).insert(0, text);
    updates.push([client, Y.encodeStateAsUpdate(client.doc, vector)]);
  }
  for (const [client, update] of updates) client.send({ type: 'update', data: Buffer.from(update).toString('base64'), sequence: 1 });
  await eventually(() => [alice, bob].every(client => /Apfel/.test(client.doc.getXmlFragment('default').toString()) && /Birne/.test(client.doc.getXmlFragment('default').toString())));
  const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspace.id);
  assert.match(row.content, /Apfel/);
  assert.match(row.content, /Birne/);
  const restored = new Y.Doc();
  Y.applyUpdate(restored, row.y_state);
  assert.equal(restored.getXmlFragment('default').toString(), alice.doc.getXmlFragment('default').toString());
  restored.destroy();
  const late = await connect();
  assert.equal(late.doc.getXmlFragment('default').toString(), bob.doc.getXmlFragment('default').toString());
  assert.equal(late.doc.getXmlFragment('default').length, 2);
});

test('view-only sockets cannot write document updates', async t => {
  const { connect, db, workspace } = await fixture(t);
  const viewer = await connect();
  const before = db.prepare('SELECT content FROM workspaces WHERE id = ?').get(workspace.id).content;
  viewer.doc.getMap('meta').set('title', 'Verbotene Änderung');
  const closed = once(viewer.ws, 'close');
  viewer.send({ type: 'update', data: Buffer.from(Y.encodeStateAsUpdate(viewer.doc)).toString('base64') });
  const [code] = await closed;
  assert.equal(code, 4003);
  const row = db.prepare('SELECT title, content FROM workspaces WHERE id = ?').get(workspace.id);
  assert.equal(row.title, workspace.title);
  assert.equal(row.content, before);
});

test('presence names update live and disappear on disconnect; deletion closes the room', async t => {
  const { connect, workspace, base } = await fixture(t);
  const alice = await connect(workspace.editKey);
  const bob = await connect();
  const announce = name => {
    alice.awareness.setLocalStateField('user', { name, color: '#2563eb' });
    alice.send({ type: 'awareness', data: Buffer.from(encodeAwarenessUpdate(alice.awareness, [alice.doc.clientID])).toString('base64') });
  };
  announce('Anna');
  await eventually(() => bob.awareness.getStates().get(alice.doc.clientID)?.user?.name === 'Anna');
  announce('Annalena');
  await eventually(() => bob.awareness.getStates().get(alice.doc.clientID)?.user?.name === 'Annalena');
  alice.ws.close();
  await eventually(() => !bob.awareness.getStates().has(alice.doc.clientID));
  const closed = once(bob.ws, 'close');
  await fetch(`${base}/api/workspaces/${workspace.id}`, { method: 'DELETE', headers: { 'x-edit-key': workspace.editKey } });
  assert.equal((await closed)[0], 4004);
});

test('whiteboard updates merge separate shapes and persist deletion tombstones', async t => {
  const { connect, workspace, db } = await fixture(t, 'whiteboard');
  const [alice, bob] = await Promise.all([connect(workspace.editKey), connect(workspace.editKey)]);
  for (const [client, id] of [[alice, 'a'], [bob, 'b']]) {
    const vector = Y.encodeStateVector(client.doc);
    client.doc.getMap('elements').set(id, { id, index: `a${id}`, isDeleted: false });
    client.send({ type: 'update', data: Buffer.from(Y.encodeStateAsUpdate(client.doc, vector)).toString('base64') });
  }
  await eventually(() => alice.doc.getMap('elements').size === 2 && bob.doc.getMap('elements').size === 2);
  const vector = Y.encodeStateVector(alice.doc);
  alice.doc.getMap('elements').set('a', { id: 'a', index: 'aa', isDeleted: true });
  alice.send({ type: 'update', data: Buffer.from(Y.encodeStateAsUpdate(alice.doc, vector)).toString('base64') });
  await eventually(() => bob.doc.getMap('elements').get('a').isDeleted);
  const scene = JSON.parse(db.prepare('SELECT content FROM workspaces WHERE id = ?').get(workspace.id).content);
  assert.equal(scene.elements.filter(element => !element.isDeleted).length, 1);
});

test('thirty live clients from one school IP can collaborate simultaneously', async t => {
  const { connect } = await fixture(t);
  const clients = await Promise.all(Array.from({ length: 30 }, () => connect()));
  assert.equal(clients.length, 30);
  assert.ok(clients.every(client => client.ws.readyState === WebSocket.OPEN));
});

test('excess WebSocket connections from one IP are rejected before upgrade', async t => {
  const { connect, base, workspace } = await fixture(t, 'writer', {
    collaborationOptions: { maxConnectionsPerIp: 2, maxConnectionsTotal: 20 },
  });
  await Promise.all([connect(), connect()]);
  const excess = new WebSocket(`${base.replace('http', 'ws')}/api/workspaces/${workspace.id}/live`);
  const status = await new Promise((resolve, reject) => {
    excess.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    excess.once('open', () => reject(new Error('Excess WebSocket was unexpectedly accepted')));
    excess.once('error', reject);
  });
  assert.equal(status, 429);
});

test('oversized Yjs updates are rejected before persistence', async t => {
  const { connect, workspace, db } = await fixture(t, 'writer', { collaborationOptions: { maxUpdateBytes: 256 } });
  const editor = await connect(workspace.editKey);
  const before = db.prepare('SELECT y_state FROM workspaces WHERE id = ?').get(workspace.id).y_state;
  const vector = Y.encodeStateVector(editor.doc);
  editor.doc.getMap('oversized').set('payload', 'x'.repeat(2_000));
  const closed = once(editor.ws, 'close');
  editor.send({ type: 'update', data: Buffer.from(Y.encodeStateAsUpdate(editor.doc, vector)).toString('base64') });
  assert.equal((await closed)[0], 4009);
  const after = db.prepare('SELECT y_state FROM workspaces WHERE id = ?').get(workspace.id).y_state;
  assert.deepEqual(after, before);
});
