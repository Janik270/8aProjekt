import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, QrCode, Users } from 'lucide-react';
import QRCode from 'qrcode';
import type { TrafficColor } from './types';
import {
  createTrafficRoom, joinTrafficRoom, loadTrafficRoom, loadTrafficStatus, loadTrafficStudent,
  setTrafficColor, studentUrl, subscribeTraffic,
} from './traffic';
import type { StudentIdentity, TrafficRoom, TrafficStatus } from './traffic';

const colors: Array<{ value: TrafficColor; label: string; help: string }> = [
  { value: 'red', label: 'Rot', help: 'Ich brauche Hilfe' },
  { value: 'yellow', label: 'Gelb', help: 'Ich bin unsicher' },
  { value: 'green', label: 'Grün', help: 'Alles verstanden' },
];

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Das hat gerade nicht geklappt.';
}

export function TrafficStartPage() {
  const [className, setClassName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const room = await createTrafficRoom(className);
      window.location.hash = `ampel/${room.id}?key=${encodeURIComponent(room.teacherKey)}`;
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  };
  const join = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!clean) return setError('Bitte gib den Klassencode ein.');
    window.location.hash = `ampel/${clean}`;
  };

  return <section className="traffic-start" aria-labelledby="traffic-heading">
    <div className="page-heading traffic-heading"><div><span className="eyebrow">AMPEL-TOOL</span><h1 id="traffic-heading">Wie läuft eure Gruppenarbeit?</h1><p>Erstelle eine Klasse für deine Übersicht oder tritt mit einem Klassencode bei.</p></div></div>
    {error && <p className="traffic-error" role="alert">{error}</p>}
    <div className="traffic-choice-grid">
      <form className="traffic-choice-card teacher-choice" onSubmit={create}>
        <span className="traffic-choice-icon"><Users size={27} /></span><span className="eyebrow">FÜR LEHRKRÄFTE</span><h2>Klasse erstellen</h2><p>Du erhältst einen QR-Code und siehst die Ampelfarben aller Schülerinnen und Schüler live.</p>
        <label>Klassenname<input value={className} onChange={event => setClassName(event.target.value)} maxLength={60} placeholder="z. B. Mathematik 8a" required /></label>
        <button className="primary-button" disabled={busy}>{busy ? 'Wird erstellt …' : 'Klasse erstellen'}<ArrowRight size={17} /></button>
      </form>
      <form className="traffic-choice-card student-choice" onSubmit={join}>
        <span className="traffic-choice-icon"><QrCode size={27} /></span><span className="eyebrow">FÜR SCHÜLER</span><h2>Klasse beitreten</h2><p>Scanne den QR-Code oder gib den sechsstelligen Code deiner Klasse ein.</p>
        <label>Klassencode<input className="traffic-code-input" value={code} onChange={event => setCode(event.target.value)} maxLength={6} placeholder="ABC123" autoCapitalize="characters" required /></label>
        <button className="secondary-button">Beitreten<ArrowRight size={17} /></button>
      </form>
    </div>
  </section>;
}

export function TrafficTeacherPage({ roomId, teacherKey }: { roomId: string; teacherKey: string }) {
  const [status, setStatus] = useState<TrafficStatus | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const url = studentUrl(roomId);
  const refresh = useCallback(async () => {
    try { setStatus(await loadTrafficStatus(roomId, teacherKey)); setError(''); }
    catch (caught) { setError(message(caught)); }
  }, [roomId, teacherKey]);

  useEffect(() => { void refresh(); return subscribeTraffic(roomId, () => void refresh()); }, [refresh, roomId]);
  useEffect(() => { QRCode.toDataURL(url, { width: 320, margin: 2, color: { dark: '#17233c', light: '#ffffff' } }).then(setQr).catch(() => setQr('')); }, [url]);

  const copy = async () => {
    await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  };
  const counts = colors.map(color => ({ ...color, count: status?.students.filter(student => student.color === color.value).length || 0 }));

  return <section className="traffic-teacher" aria-labelledby="teacher-heading">
    <div className="traffic-teacher-head"><div><span className="eyebrow">LIVE-ÜBERSICHT</span><h1 id="teacher-heading">{status?.name || 'Klasse wird geladen …'}</h1><p>{status ? `${status.students.length} ${status.students.length === 1 ? 'Person' : 'Personen'} beigetreten` : 'Verbindung wird hergestellt'}</p></div><div className="traffic-code"><span>Klassencode</span><strong>{roomId}</strong></div></div>
    {error && <p className="traffic-error" role="alert">{error}</p>}
    <div className="traffic-teacher-layout">
      <aside className="traffic-join-card"><span className="eyebrow">BEITRETEN</span><h2>QR-Code scannen</h2><p>Zeige diesen Code der Klasse. Der Link öffnet nur die schlichte Schüleransicht.</p>{qr ? <img src={qr} alt={`QR-Code für die Klasse ${status?.name || roomId}`} /> : <span className="qr-placeholder" />}
        <button className="secondary-button" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Link kopiert' : 'Beitrittslink kopieren'}</button>
      </aside>
      <div className="traffic-overview">
        <div className="traffic-summary">{counts.map(item => <div className={`traffic-count ${item.value}`} key={item.value}><span className="traffic-light-dot" /><strong>{item.count}</strong><small>{item.label}</small></div>)}</div>
        {!status ? <div className="traffic-empty"><span className="loader" /><p>Übersicht wird geladen …</p></div> : status.students.length === 0 ? <div className="traffic-empty"><Users size={34} /><h2>Noch niemand beigetreten</h2><p>Die ersten Namen erscheinen hier automatisch.</p></div> : <div className="student-grid">{status.students.map(student => <article className={`student-status ${student.color || 'none'}`} key={student.id}><div className="student-color"><span className="student-bulb" />{student.color ? <span>{colors.find(color => color.value === student.color)?.label}</span> : <span>Noch keine Auswahl</span>}</div><strong>{student.name}</strong></article>)}</div>}
      </div>
    </div>
  </section>;
}

function identityKey(roomId: string) { return `8a-traffic-student:${roomId}`; }
function readIdentity(roomId: string): StudentIdentity | null {
  try { const value = JSON.parse(localStorage.getItem(identityKey(roomId)) || 'null'); return value?.id && value?.studentKey && value?.name ? value : null; }
  catch { return null; }
}

export function TrafficStudentPage({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<TrafficRoom | null>(null);
  const [identity, setIdentity] = useState<StudentIdentity | null>(() => readIdentity(roomId));
  const [name, setName] = useState('');
  const [color, setColor] = useState<TrafficColor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadTrafficRoom(roomId).then(setRoom).catch(caught => setError(message(caught))); }, [roomId]);
  useEffect(() => {
    if (!identity) return;
    loadTrafficStudent(roomId, identity).then(student => setColor(student.color)).catch(() => {
      localStorage.removeItem(identityKey(roomId)); setIdentity(null); setColor(null);
    });
  }, [identity, roomId]);

  const join = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const joined = await joinTrafficRoom(roomId, name);
      const next = { id: joined.id, name: joined.name, studentKey: joined.studentKey };
      localStorage.setItem(identityKey(roomId), JSON.stringify(next)); setIdentity(next); setColor(joined.color);
    } catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  };
  const choose = async (next: TrafficColor) => {
    if (!identity || busy) return;
    setBusy(true); setError('');
    try { const updated = await setTrafficColor(roomId, identity, next); setColor(updated.color); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(false); }
  };

  return <main className="traffic-student-page">
    <section className="traffic-student-card">
      <div className="traffic-student-title"><span className="mini-traffic"><i /><i /><i /></span><div><span>{room?.name || 'Ampel'}</span><small>KLASSENCODE {roomId}</small></div></div>
      {error && <p className="traffic-error" role="alert">{error}</p>}
      {!identity ? <form className="traffic-name-form" onSubmit={join}><h1>Wie heißt du?</h1><p>Gib deinen Namen ein, um der Klasse beizutreten.</p><label>Name<input value={name} onChange={event => setName(event.target.value)} maxLength={40} autoComplete="name" autoFocus placeholder="Dein Name" required /></label><button disabled={busy}>{busy ? 'Einen Moment …' : 'Weiter'}<ArrowRight size={19} /></button></form> : <div className="traffic-select"><p className="traffic-greeting">Hallo <strong>{identity.name}</strong></p><h1>Wie läuft es gerade?</h1><div className="traffic-buttons">{colors.map(item => <button key={item.value} className={`${item.value} ${color === item.value ? 'selected' : ''}`} onClick={() => void choose(item.value)} disabled={busy} aria-pressed={color === item.value}><span className="student-pick-light">{color === item.value && <Check size={32} />}</span><span className="traffic-button-copy"><strong>{item.label}</strong><small>{item.help}</small></span></button>)}</div>{color && <p className="traffic-saved"><Check size={18} /> Deine Auswahl ist gespeichert.</p>}</div>}
    </section>
  </main>;
}
