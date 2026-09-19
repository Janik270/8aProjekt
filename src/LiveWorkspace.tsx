import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import type { Workspace } from './types';
import { updateRememberedWorkspace } from './workspaces';

const colors = ['#7c3aed', '#2563eb', '#dc2626', '#059669', '#c2410c', '#be185d'];
const encode = (data: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 8192) binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
  return btoa(binary);
};
const decode = (data: string) => Uint8Array.from(atob(data), char => char.charCodeAt(0));
export type Presence = { user?: { name: string; color: string }; pointer?: { x: number; y: number; tool: 'pointer' | 'laser' }; button?: 'up' | 'down'; selectedElementIds?: Record<string, true> };

export class LiveSession extends EventTarget {
  doc = new Y.Doc();
  awareness = new Awareness(this.doc);
  status: 'connecting' | 'live' | 'saving' | 'offline' | 'error' | 'deleted' = 'connecting';
  ready = false;
  canEdit = false;
  name: string;
  color = colors[this.doc.clientID % colors.length];
  private socket?: WebSocket;
  private retry?: number;
  private stopped = false;
  private synced = false;
  private sequence = 0;
  private accountName = (event: Event) => this.setName((event as CustomEvent<string>).detail);

  constructor(readonly initial: Workspace, readonly editKey?: string) {
    super();
    let name = '';
    try { name = localStorage.getItem('8a-display-name') || ''; } catch { /* Storage may be unavailable. */ }
    this.name = name || `Gast ${String(this.doc.clientID).slice(-4)}`;
    this.awareness.setLocalStateField('user', { name: this.name, color: this.color });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== this && this.editKey) {
        this.sequence++;
        this.setStatus(this.synced ? 'saving' : 'offline');
        if (this.synced) this.send({ type: 'update', data: encode(update), sequence: this.sequence });
      }
    });
    this.awareness.on('update', (_changes: unknown, origin: unknown) => {
      if (origin !== this && this.synced) this.sendPresence();
      this.dispatchEvent(new Event('presence'));
    });
    window.addEventListener('8a:account-name', this.accountName);
    this.connect();
  }
  private send(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
  private sendPresence() {
    this.send({ type: 'awareness', data: encode(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) });
  }
  private setStatus(status: LiveSession['status']) {
    this.status = status;
    this.dispatchEvent(new Event('status'));
  }
  private connect() {
    const url = new URL(`/api/workspaces/${encodeURIComponent(this.initial.id)}/live`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => this.send({ type: 'join', clientID: this.doc.clientID, editKey: this.editKey });
    socket.onmessage = event => {
      if (this.stopped) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'sync') {
          // Preserve and resend operations created while disconnected.
          const remote = new Y.Doc();
          Y.applyUpdate(remote, decode(message.data));
          Y.applyUpdate(this.doc, decode(message.data), this);
          const pending = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(remote));
          remote.destroy();
          this.canEdit = message.canEdit;
          this.synced = true;
          this.ready = true;
          if (this.canEdit) {
            this.sequence++;
            this.setStatus('saving');
            this.send({ type: 'update', data: encode(pending), sequence: this.sequence });
          } else this.setStatus('live');
          this.sendPresence();
        } else if (message.type === 'update') Y.applyUpdate(this.doc, decode(message.data), this);
        else if (message.type === 'awareness') applyAwarenessUpdate(this.awareness, decode(message.data), this);
        else if (message.type === 'saved' && message.sequence === this.sequence) {
          this.setStatus('live');
          updateRememberedWorkspace({ ...this.initial, title: String(this.doc.getMap('meta').get('title') || this.initial.title), updatedAt: new Date().toISOString() }, this.editKey);
        }
      } catch { this.setStatus('error'); }
    };
    socket.onclose = event => {
      this.synced = false;
      removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()].filter(id => id !== this.doc.clientID), this);
      if (this.stopped) return;
      if (event.code >= 4000) {
        this.canEdit = false;
        this.setStatus(event.code === 4004 ? 'deleted' : 'error');
        return;
      }
      this.setStatus('offline');
      this.retry = window.setTimeout(() => this.connect(), 1000);
    };
    socket.onerror = () => socket.close();
  }
  setName(value: string) {
    this.name = value.trim().slice(0, 40) || `Gast ${String(this.doc.clientID).slice(-4)}`;
    try { localStorage.setItem('8a-display-name', this.name); } catch { /* Keep the name for this session. */ }
    this.awareness.setLocalStateField('user', { name: this.name, color: this.color });
  }
  destroy() {
    this.stopped = true;
    window.removeEventListener('8a:account-name', this.accountName);
    window.clearTimeout(this.retry);
    this.awareness.setLocalState(null);
    this.socket?.close();
    this.awareness.destroy();
    this.doc.destroy();
  }
}

const Context = createContext<LiveSession | null>(null);
export function useLiveSession() {
  const session = useContext(Context);
  if (!session) throw new Error('Missing live workspace');
  return session;
}

export default function LiveWorkspace({ initial, editKey, children }: { initial: Workspace; editKey?: string; children: ReactNode }) {
  const [session, setSession] = useState<LiveSession | null>(null);
  const [status, setStatus] = useState<LiveSession['status']>('connecting');
  useEffect(() => {
    const live = new LiveSession(initial, editKey);
    setSession(live);
    const update = () => setStatus(live.status);
    live.addEventListener('status', update);
    return () => { live.removeEventListener('status', update); live.destroy(); };
    // Title updates must not reconnect a workspace.
  }, [initial.id, editKey]);
  if (status === 'deleted') return <div className="center-state"><h2>Dieses Projekt wurde gelöscht.</h2><a href="#start">Zurück zu den Tools</a></div>;
  if (!session?.ready || status === 'error') return <div className="center-state"><h2>{status === 'error' ? 'Die Live-Verbindung wurde abgelehnt. Bitte prüfe deinen Link und lade die Seite neu.' : status === 'offline' ? 'Verbindung unterbrochen. Wir verbinden dich wieder …' : 'Live-Verbindung wird aufgebaut …'}</h2></div>;
  return <Context.Provider value={session}>{children}</Context.Provider>;
}

export function useLiveTitle(onTitle: (title: string) => void) {
  const session = useLiveSession();
  const meta = session.doc.getMap<string>('meta');
  const [title, setTitle] = useState(meta.get('title') || session.initial.title);
  useEffect(() => {
    const update = () => { const value = meta.get('title') || session.initial.title; setTitle(value); onTitle(value); };
    meta.observe(update);
    return () => meta.unobserve(update);
  }, [meta, onTitle, session.initial.title]);
  return [title, (value: string) => {
    setTitle(value);
    if (session.canEdit && value.trim()) meta.set('title', value.slice(0, 120));
  }] as const;
}

export function CollaborationBar() {
  const session = useLiveSession();
  const [, update] = useState(0);
  const [name, setName] = useState(session.name);
  useEffect(() => {
    const refresh = () => update(value => value + 1);
    session.addEventListener('status', refresh);
    session.addEventListener('presence', refresh);
    return () => { session.removeEventListener('status', refresh); session.removeEventListener('presence', refresh); };
  }, [session]);
  const labels = { connecting: 'Verbindet …', live: 'Live verbunden', saving: 'Speichert …', offline: 'Offline · verbindet erneut …', error: 'Verbindungsfehler · bitte neu laden', deleted: 'Dieses Projekt wurde gelöscht' };
  const people = [...session.awareness.getStates()] as [number, Presence][];
  return <div className="collaboration-bar">
    <label className="display-name">Dein Name<input aria-label="Dein Name" value={name} maxLength={40} onChange={event => { setName(event.target.value); session.setName(event.target.value); }} onBlur={() => setName(session.name)} /></label>
    <span className={`live-status ${session.status}`} role="status"><span />{labels[session.status]}</span>
    <div className="participants" aria-label="Teilnehmende">{people.filter(([, state]) => state.user).map(([id, state]) => <span className="participant" key={id} style={{ borderColor: /^#[0-9a-f]{6}$/i.test(state.user!.color) ? state.user!.color : '#7c3aed' }}>{state.user!.name}{id === session.doc.clientID ? ' (du)' : ''}</span>)}</div>
  </div>;
}
