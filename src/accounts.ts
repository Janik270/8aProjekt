import type { AccountData } from './types';

async function jsonOrError(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Die Anfrage konnte nicht ausgeführt werden.');
  return body;
}

export async function loadAccount(): Promise<AccountData | null> {
  const response = await fetch('/api/account');
  if (response.status === 401) return null;
  return jsonOrError(response) as Promise<AccountData>;
}

export async function authenticate(mode: 'login' | 'register', username: string, password: string) {
  const response = await fetch(`/api/auth/${mode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return jsonOrError(response) as Promise<{ user: { id: string; username: string } }>;
}

export async function logout() {
  const response = await fetch('/api/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error('Abmelden ist gerade nicht möglich.');
}

export async function saveProjectToAccount(id: string, editKey?: string) {
  const response = await fetch(`/api/account/projects/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ editKey }),
  });
  return jsonOrError(response) as Promise<{ id: string; role: string; editKey?: string }>;
}

export async function removeProjectFromAccount(id: string) {
  const response = await fetch(`/api/account/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Das Projekt konnte nicht aus deinem Konto entfernt werden.');
}
