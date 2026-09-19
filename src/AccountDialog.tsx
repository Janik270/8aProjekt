import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Brush, Eye, FileText, FolderOpen, LogIn, LogOut, Save, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import type { AccountData, ToolKind } from './types';
import { authenticate, logout, removeProjectFromAccount, saveProjectToAccount } from './accounts';
import { workspaceUrl } from './workspaces';

type CurrentProject = { id: string; type: ToolKind; title: string; editKey?: string };
type Props = {
  open: boolean;
  account: AccountData | null;
  current?: CurrentProject;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export default function AccountDialog({ open, account, current, onClose, onChanged }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close(); }, [open]);
  useEffect(() => { if (open) setError(''); }, [open, mode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await authenticate(mode, username, password);
      localStorage.setItem('8a-display-name', result.user.username);
      window.dispatchEvent(new CustomEvent('8a:account-name', { detail: result.user.username }));
      setPassword('');
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Anmeldung fehlgeschlagen.'); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    setBusy(true); setError('');
    try { await logout(); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Abmelden fehlgeschlagen.'); }
    finally { setBusy(false); }
  };

  const storeCurrent = async () => {
    if (!current) return;
    setBusy(true); setError('');
    try { await saveProjectToAccount(current.id, current.editKey); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Speichern fehlgeschlagen.'); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setError('');
    try { await removeProjectFromAccount(id); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Entfernen fehlgeschlagen.'); }
    finally { setBusy(false); }
  };

  const openProject = (project: AccountData['projects'][number]) => {
    window.location.hash = workspaceUrl(project.type, project.id, project.editKey).split('#')[1];
    onClose();
  };

  const storedProject = current && account?.projects.find(project => project.id === current.id);
  const needsUpgrade = Boolean(storedProject?.role === 'view' && current?.editKey);
  const isStored = Boolean(storedProject && !needsUpgrade);

  return <dialog ref={ref} className="account-dialog" onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }}>
    <button className="icon-button modal-x" onClick={onClose} aria-label="Kontofenster schließen"><X size={20} /></button>
    {!account ? <>
      <span className="dialog-kicker"><ShieldCheck size={15} /> DEIN BEREICH</span>
      <h2>{mode === 'login' ? 'Bei deinem Konto anmelden' : 'Neues Konto erstellen'}</h2>
      <p>Deine gespeicherten Projekte sind danach auf jedem Gerät verfügbar.</p>
      <div className="permission-switch account-switch" role="tablist" aria-label="Kontoaktion">
        <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}><LogIn size={16} /> Anmelden</button>
        <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}><UserPlus size={16} /> Konto erstellen</button>
      </div>
      <form className="account-form" onSubmit={event => void submit(event)}>
        <label>Benutzername<input aria-label="Benutzername" autoComplete="username" minLength={3} maxLength={30} value={username} onChange={event => setUsername(event.target.value)} required /></label>
        <label>Passwort<input aria-label="Passwort" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy}>{mode === 'login' ? <><LogIn size={17} /> Anmelden</> : <><UserPlus size={17} /> Konto erstellen</>}</button>
      </form>
    </> : <>
      <div className="account-heading">
        <span className="account-avatar">{account.user.username.slice(0, 2).toUpperCase()}</span>
        <div><span className="dialog-kicker">ANGEMELDET ALS</span><h2>{account.user.username}</h2><p>{account.projects.length} {account.projects.length === 1 ? 'gespeichertes Projekt' : 'gespeicherte Projekte'}</p></div>
      </div>
      {current && <div className="save-current-project">
        <div><Save size={19} /><span><strong>{current.title}</strong><small>{isStored ? 'Dieses Projekt ist in deinem Konto gespeichert.' : needsUpgrade ? 'Bearbeitungsrecht für alle Geräte übernehmen.' : 'Auf allen deinen Geräten öffnen.'}</small></span></div>
        <button className="secondary-button" onClick={() => void storeCurrent()} disabled={busy || isStored}>{isStored ? 'Gespeichert' : needsUpgrade ? 'Berechtigung aktualisieren' : 'Im Konto speichern'}</button>
      </div>}
      <section className="account-projects" aria-labelledby="account-projects-title">
        <div className="account-projects-title"><div><span className="eyebrow">PROJEKTE</span><h3 id="account-projects-title">Meine Projekte</h3></div><FolderOpen size={21} /></div>
        {account.projects.length === 0 ? <div className="empty-account-projects"><FolderOpen size={27} /><p>Noch keine Projekte gespeichert.</p><span>Öffne oder erstelle ein Projekt und speichere es hier.</span></div> : <div className="account-project-list">{account.projects.map(project => {
          const Icon = project.type === 'whiteboard' ? Brush : FileText;
          return <article key={project.id}>
            <button className="account-project-main" onClick={() => openProject(project)}>
              <span className={`recent-icon ${project.type}`}><Icon size={18} /></span>
              <span><strong>{project.title}</strong><small>{project.type === 'whiteboard' ? 'Whiteboard' : 'Dokument'} · {project.role === 'view' ? 'Nur ansehen' : project.role === 'owner' ? 'Eigenes Projekt' : 'Mitbearbeiten'}</small></span>
            </button>
            <span className={`account-role ${project.role}`}>{project.role === 'view' ? <Eye size={13} /> : <Save size={13} />}{project.role === 'view' ? 'Lesen' : 'Bearbeiten'}</span>
            <button className="icon-button account-remove" aria-label={`${project.title} aus dem Konto entfernen`} onClick={() => void remove(project.id)} disabled={busy}><Trash2 size={16} /></button>
          </article>;
        })}</div>}
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="account-logout" onClick={() => void signOut()} disabled={busy}><LogOut size={16} /> Abmelden</button>
    </>}
  </dialog>;
}
