import type { AppRoute, RecentWorkspace, ToolKind, Workspace } from './types';

const RECENT_KEY = '8a-recent-workspaces';

export function parseRoute(): AppRoute {
  const hash = window.location.hash.slice(1);
  if (hash === 'about') return { page: 'about' };
  const [path, query = ''] = hash.split('?');
  const [type, id] = path.split('/');
  if (type === 'whiteboard' || type === 'writer') {
    return { page: 'tool', type, id: id || undefined, editKey: new URLSearchParams(query).get('key') || undefined };
  }
  return { page: 'home' };
}

export function workspaceUrl(type: ToolKind, id: string, editKey?: string) {
  const base = `${window.location.origin}${window.location.pathname}#${type}/${id}`;
  return editKey ? `${base}?key=${encodeURIComponent(editKey)}` : base;
}

export function readRecents(): RecentWorkspace[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(value) ? value.slice(0, 8) : [];
  } catch { return []; }
}

export function rememberWorkspace(workspace: Pick<Workspace, 'id' | 'type' | 'title' | 'updatedAt'>, editKey?: string) {
  const next = [{ ...workspace, editKey }, ...readRecents().filter(item => item.id !== workspace.id)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event('recents-changed'));
}

export function forgetWorkspace(id: string) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(readRecents().filter(item => item.id !== id)));
  window.dispatchEvent(new Event('recents-changed'));
}

export async function createWorkspace(type: ToolKind) {
  const response = await fetch('/api/workspaces', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type }),
  });
  if (!response.ok) throw new Error('Arbeitsbereich konnte nicht erstellt werden.');
  return response.json() as Promise<Pick<Workspace, 'id' | 'type' | 'title' | 'createdAt' | 'updatedAt'> & { editKey: string }>;
}

export async function loadWorkspace(id: string) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(response.status === 404 ? 'Dieser Arbeitsbereich wurde nicht gefunden.' : 'Inhalt konnte nicht geladen werden.');
  return response.json() as Promise<Workspace>;
}

export function subscribeWorkspace(id: string, onWorkspace: (workspace: Workspace) => void, onDeleted?: () => void) {
  const source = new EventSource(`/api/workspaces/${encodeURIComponent(id)}/events`);
  source.addEventListener('workspace', event => {
    try { onWorkspace(JSON.parse((event as MessageEvent<string>).data) as Workspace); }
    catch { /* Ignore a malformed event and keep the live connection open. */ }
  });
  if (onDeleted) source.addEventListener('deleted', onDeleted);
  return () => source.close();
}

export async function saveWorkspace(id: string, editKey: string, title: string, content: string) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-edit-key': editKey },
    body: JSON.stringify({ title, content }),
  });
  if (!response.ok) throw new Error(response.status === 403 ? 'Der Bearbeitungslink ist ungültig.' : 'Änderungen konnten nicht gespeichert werden.');
  return response.json() as Promise<{ id: string; title: string; updatedAt: string }>;
}

export async function duplicateWorkspace(source: RecentWorkspace) {
  const original = await loadWorkspace(source.id);
  const created = await createWorkspace(original.type);
  const copyTitle = `Kopie von ${original.title}`.slice(0, 120);
  const saved = await saveWorkspace(created.id, created.editKey, copyTitle, original.content);
  const copy = { ...created, title: copyTitle, updatedAt: saved.updatedAt };
  rememberWorkspace(copy, created.editKey);
  return copy;
}

export async function deleteWorkspace(id: string, editKey: string) {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { 'x-edit-key': editKey },
  });
  if (!response.ok) throw new Error(response.status === 403 ? 'Zum Löschen wird der Bearbeitungslink benötigt.' : 'Projekt konnte nicht gelöscht werden.');
  forgetWorkspace(id);
}
