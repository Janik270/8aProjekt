import type { TrafficColor } from './types';

export type TrafficRoom = { id: string; name: string; createdAt: string };
export type TrafficStudent = {
  id: string;
  name: string;
  color: TrafficColor | null;
  joinedAt: string;
  updatedAt: string;
};
export type TrafficStatus = TrafficRoom & { students: TrafficStudent[] };
export type StudentIdentity = { id: string; name: string; studentKey: string };

async function apiError(response: Response, fallback: string) {
  try { return (await response.json()).error || fallback; }
  catch { return fallback; }
}

export function studentUrl(id: string) {
  return `${window.location.origin}${window.location.pathname}#ampel/${id}`;
}

export async function createTrafficRoom(name: string) {
  const response = await fetch('/api/traffic-rooms', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Die Klasse konnte nicht erstellt werden.'));
  return response.json() as Promise<TrafficRoom & { teacherKey: string }>;
}

export async function loadTrafficRoom(id: string) {
  const response = await fetch(`/api/traffic-rooms/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(await apiError(response, 'Die Klasse konnte nicht geladen werden.'));
  return response.json() as Promise<TrafficRoom>;
}

export async function loadTrafficStatus(id: string, teacherKey: string) {
  const response = await fetch(`/api/traffic-rooms/${encodeURIComponent(id)}/status`, {
    headers: { 'x-teacher-key': teacherKey },
  });
  if (!response.ok) throw new Error(await apiError(response, 'Die Übersicht konnte nicht geladen werden.'));
  return response.json() as Promise<TrafficStatus>;
}

export function subscribeTraffic(id: string, onChanged: () => void) {
  const source = new EventSource(`/api/traffic-rooms/${encodeURIComponent(id)}/events`);
  source.addEventListener('changed', onChanged);
  return () => source.close();
}

export async function joinTrafficRoom(id: string, name: string) {
  const response = await fetch(`/api/traffic-rooms/${encodeURIComponent(id)}/students`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Du konntest der Klasse nicht beitreten.'));
  return response.json() as Promise<TrafficStudent & { studentKey: string }>;
}

export async function loadTrafficStudent(roomId: string, identity: StudentIdentity) {
  const response = await fetch(`/api/traffic-rooms/${encodeURIComponent(roomId)}/students/${encodeURIComponent(identity.id)}`, {
    headers: { 'x-student-key': identity.studentKey },
  });
  if (!response.ok) throw new Error(await apiError(response, 'Deine Teilnahme wurde nicht gefunden.'));
  return response.json() as Promise<TrafficStudent>;
}

export async function setTrafficColor(roomId: string, identity: StudentIdentity, color: TrafficColor) {
  const response = await fetch(`/api/traffic-rooms/${encodeURIComponent(roomId)}/students/${encodeURIComponent(identity.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-student-key': identity.studentKey },
    body: JSON.stringify({ color }),
  });
  if (!response.ok) throw new Error(await apiError(response, 'Die Farbe konnte nicht gespeichert werden.'));
  return response.json() as Promise<TrafficStudent>;
}
