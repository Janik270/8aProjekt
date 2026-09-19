import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';
import { WebSocketServer, WebSocket } from 'ws';
import { generateJSON, generateHTML } from '@tiptap/html/server';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap';
import { createHash, timingSafeEqual } from 'node:crypto';

const extensions = [StarterKit.configure({ undoRedo: false })];
const schema = getSchema(extensions);
const encode = data => Buffer.from(data).toString('base64');
const decode = data => new Uint8Array(Buffer.from(data, 'base64'));
const send = (socket, message) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

export function createCollaboration(db) {
  const rooms = new Map();
  const getRoom = row => {
    if (rooms.has(row.id)) return rooms.get(row.id);
    row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(row.id);
    if (!row) throw new Error('Workspace deleted');
    let doc = new Y.Doc();
    if (row.y_state) Y.applyUpdate(doc, row.y_state);
    else {
      if (row.type === 'writer') {
        doc.destroy();
        doc = prosemirrorJSONToYDoc(schema, generateJSON(row.content, extensions), 'default');
      } else {
        const scene = JSON.parse(row.content);
        for (const element of scene.elements || []) doc.getMap('elements').set(element.id, element);
        for (const [id, file] of Object.entries(scene.files || {})) doc.getMap('files').set(id, file);
        for (const [key, value] of Object.entries(scene.appState || {})) doc.getMap('appState').set(key, value);
      }
      doc.getMap('meta').set('title', row.title);
      db.prepare('UPDATE workspaces SET y_state = ? WHERE id = ?').run(Y.encodeStateAsUpdate(doc), row.id);
    }
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    const room = { doc, awareness, sockets: new Set() };
    rooms.set(row.id, room);
    doc.on('update', update => {
      const title = String(doc.getMap('meta').get('title') || row.title).trim().slice(0, 120);
      const content = row.type === 'writer'
        ? generateHTML(yDocToProsemirrorJSON(doc, 'default'), extensions)
        : JSON.stringify({ elements: [...doc.getMap('elements').values()].sort((a, b) => {
          const left = `${a.index || ''}:${a.id}`, right = `${b.index || ''}:${b.id}`;
          return left < right ? -1 : left > right ? 1 : 0;
        }), appState: doc.getMap('appState').toJSON(), files: doc.getMap('files').toJSON() });
      db.prepare('UPDATE workspaces SET y_state = ?, title = ?, content = ?, updated_at = ? WHERE id = ?')
        .run(Y.encodeStateAsUpdate(doc), title, content, new Date().toISOString(), row.id);
      for (const socket of room.sockets) send(socket, { type: 'update', data: encode(update) });
    });
    awareness.on('update', ({ added, updated, removed }) => {
      const data = encode(encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
      for (const socket of room.sockets) send(socket, { type: 'awareness', data });
    });
    return room;
  };

  return {
    rename(id, title) {
      const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
      if (row?.y_state) {
        const room = getRoom(row);
        room.doc.getMap('meta').set('title', title);
        if (!room.sockets.size) { rooms.delete(id); room.awareness.destroy(); room.doc.destroy(); }
      }
    },
    remove(id) {
      const room = rooms.get(id);
      if (!room) return;
      for (const socket of room.sockets) socket.close(4004, 'Arbeitsbereich gelöscht');
      rooms.delete(id);
      room.awareness.destroy();
      room.doc.destroy();
    },
    attach(server) {
      const wss = new WebSocketServer({ noServer: true, maxPayload: 12 * 1024 * 1024 });
      server.on('upgrade', (request, socket, head) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        const match = /^\/api\/workspaces\/([^/]+)\/live$/.exec(path);
        if (!match) return socket.destroy();
        const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(match[1]);
        if (!row) return socket.destroy();
        wss.handleUpgrade(request, socket, head, ws => {
          let room;
          let clientID;
          let canEdit = false;
          const authTimeout = setTimeout(() => ws.close(4001, 'Anmeldung fehlt'), 10_000);
          ws.on('error', () => {});
          ws.on('pong', () => { ws.alive = true; });
          ws.alive = true;
          ws.on('message', raw => {
            try {
              const message = JSON.parse(raw.toString());
              if (!room) {
                if (message.type !== 'join' || !Number.isSafeInteger(message.clientID) || message.clientID < 0) throw new Error('Invalid join');
                if (message.editKey) {
                  const actual = createHash('sha256').update(String(message.editKey)).digest('hex');
                  canEdit = timingSafeEqual(Buffer.from(actual), Buffer.from(row.edit_key_hash));
                  if (!canEdit) return ws.close(4003, 'Ungültiger Bearbeitungslink');
                }
                room = getRoom(row);
                clientID = message.clientID;
                if ([...room.sockets].some(peer => peer.clientID === clientID)) return ws.close(4001, 'Doppelte Verbindung');
                ws.clientID = clientID;
                room.sockets.add(ws);
                clearTimeout(authTimeout);
                send(ws, { type: 'sync', data: encode(Y.encodeStateAsUpdate(room.doc)), canEdit });
                send(ws, { type: 'awareness', data: encode(encodeAwarenessUpdate(room.awareness, [...room.awareness.getStates().keys()])) });
              } else if (message.type === 'update') {
                if (!canEdit) return ws.close(4003, 'Nur ansehen');
                Y.applyUpdate(room.doc, decode(message.data), ws);
                send(ws, { type: 'saved', sequence: message.sequence });
              } else if (message.type === 'awareness') {
                const update = decode(message.data);
                if (update.length > 16_384) throw new Error('Presence too large');
                const decoder = decoding.createDecoder(update);
                if (decoding.readVarUint(decoder) !== 1 || decoding.readVarUint(decoder) !== clientID) throw new Error('Invalid presence owner');
                decoding.readVarUint(decoder); // Awareness clock.
                const state = JSON.parse(decoding.readVarString(decoder));
                if (state !== null) {
                  if (!state.user || typeof state.user.name !== 'string' || state.user.name.length > 40 || !/^#[0-9a-f]{6}$/i.test(state.user.color)) throw new Error('Invalid user');
                  if (state.pointer && (!Number.isFinite(state.pointer.x) || !Number.isFinite(state.pointer.y) || !['pointer', 'laser'].includes(state.pointer.tool))) throw new Error('Invalid pointer');
                  if (state.selectedElementIds && (typeof state.selectedElementIds !== 'object' || Object.values(state.selectedElementIds).some(value => value !== true))) throw new Error('Invalid selection');
                }
                applyAwarenessUpdate(room.awareness, update, ws);
              }
            } catch { ws.close(4002, 'Ungültige Nachricht'); }
          });
          ws.on('close', () => {
            clearTimeout(authTimeout);
            if (!room) return;
            room.sockets.delete(ws);
            removeAwarenessStates(room.awareness, [clientID], ws);
            if (!room.sockets.size && rooms.get(row.id) === room) {
              rooms.delete(row.id);
              room.awareness.destroy();
              room.doc.destroy();
            }
          });
        });
      });
      const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
          if (!ws.alive) ws.terminate();
          else { ws.alive = false; ws.ping(); }
        }
      }, 20_000);
      heartbeat.unref();
      server.on('close', () => { clearInterval(heartbeat); wss.close(); });
      return () => {
        clearInterval(heartbeat);
        for (const ws of wss.clients) ws.terminate();
      };
    },
  };
}
