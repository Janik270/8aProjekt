import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Brush, Check, ChevronRight, CircleHelp, Copy, Download, ExternalLink,
  FileImage, FilePlus2, FileText, FileType2, FileUp, Focus, FolderOpen, Grid3X3, Heart, Home,
  Info, LayoutGrid, Menu, Moon, MoreVertical, PanelLeftClose, PanelLeftOpen, Plus,
  School, Sparkles, Sun, TimerReset, TrafficCone, Trash2, Users, WandSparkles, X,
} from 'lucide-react';
import type { AppRoute, RecentWorkspace, SiteData, ToolKind, Workspace } from './types';
import LiveWorkspace from './LiveWorkspace';
import AccountDialog from './AccountDialog';
import { loadAccount } from './accounts';
import type { AccountData } from './types';
import { TrafficStartPage, TrafficStudentPage, TrafficTeacherPage } from './TrafficTool';
import ToolPreview, { CreativeCollage } from './ToolPreview';
import FocusTimer from './FocusTimer';
import {
  createWorkspace, deleteWorkspace, duplicateWorkspace, forgetWorkspace, loadWorkspace,
  parseRoute, readRecents, rememberWorkspace, saveWorkspace, workspaceUrl,
} from './workspaces';

const WhiteboardTool = lazy(() => import('./WhiteboardTool'));
const WriterTool = lazy(() => import('./WriterTool'));

function readPreference(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function savePreference(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* storage can be unavailable */ } }

const toolInfo = {
  whiteboard: { name: 'Excalidraw', eyebrow: 'ZEICHNEN & PLANEN', description: 'Ideen skizzieren, Abläufe erklären und gemeinsam auf einer endlosen Fläche denken.', icon: Brush, color: 'indigo' },
  writer: { name: 'Group Writer', eyebrow: 'GEMEINSAM SCHREIBEN', description: 'Texte zusammen verfassen, formatieren und über einen Link direkt weitergeben.', icon: FileText, color: 'coral' },
} as const;

export default function App() {
  const [route, setRoute] = useState<AppRoute>(parseRoute);
  const [collapsed, setCollapsed] = useState(() => readPreference('8a-sidebar') === 'collapsed');
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 900px)').matches);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState(() => readPreference('8a-theme') || 'light');
  const [site, setSite] = useState<SiteData | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState<ToolKind | null>(null);
  const [recents, setRecents] = useState<RecentWorkspace[]>(readRecents);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const refreshAccount = useCallback(async () => { setAccount(await loadAccount()); }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#050505' : '#ffffff');
    savePreference('8a-theme', theme);
  }, [theme]);
  useEffect(() => { savePreference('8a-sidebar', collapsed ? 'collapsed' : 'expanded'); }, [collapsed]);
  useEffect(() => {
    const change = () => { setRoute(parseRoute()); setMobileOpen(false); window.scrollTo(0, 0); };
    addEventListener('hashchange', change); return () => removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    const media = matchMedia('(max-width: 900px)');
    const change = () => { setMobile(media.matches); setMobileOpen(false); };
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { fetch('/api/site').then(response => response.json()).then(setSite).catch(() => undefined); }, []);
  useEffect(() => { void refreshAccount().catch(() => setAccount(null)); }, [refreshAccount]);
  useEffect(() => {
    const update = () => setRecents(readRecents());
    addEventListener('recents-changed', update); addEventListener('storage', update);
    return () => { removeEventListener('recents-changed', update); removeEventListener('storage', update); };
  }, []);
  useEffect(() => {
    if (route.page !== 'tool' || !route.id) { setWorkspace(null); setLoadError(''); return; }
    let active = true; setWorkspace(null); setLoadError('');
    loadWorkspace(route.id).then(value => {
      if (!active) return;
      if (value.type !== route.type) throw new Error('Dieser Link gehört zu einem anderen Werkzeug.');
      setWorkspace(value);
    }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : 'Inhalt konnte nicht geladen werden.'); });
    return () => { active = false; };
  }, [route]);
  useEffect(() => {
    if (!mobile || !mobileOpen) return;
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileOpen(false); };
    addEventListener('keydown', onKey); return () => { document.body.style.overflow = old; removeEventListener('keydown', onKey); };
  }, [mobile, mobileOpen]);

  const openTool = useCallback(async (type: ToolKind) => {
    setCreating(type); setMobileOpen(false);
    try {
      const created = await createWorkspace(type);
      rememberWorkspace(created, created.editKey);
      await refreshAccount().catch(() => undefined);
      window.location.hash = `${type}/${created.id}?key=${encodeURIComponent(created.editKey)}`;
    } catch { setLoadError('Das neue Tool konnte gerade nicht geöffnet werden.'); }
    finally { setCreating(null); }
  }, [refreshAccount]);

  const runToolAction = (tool: ToolKind, action: string) => {
    window.dispatchEvent(new CustomEvent(`8a:${tool}-action`, { detail: { action } }));
    setMobileOpen(false);
  };

  if (route.page === 'traffic' && route.id && !route.teacherKey) {
    return <TrafficStudentPage key={route.id} roomId={route.id} />;
  }

  const currentName = route.page === 'home' ? 'Alle Tools' : route.page === 'about' ? 'Über das Projekt' : route.page === 'traffic' ? 'Ampel-Tool' : route.page === 'timer' ? 'Fokus-Timer' : toolInfo[route.type].name;
  const toolPage = route.page === 'tool';

  return <div className={`app ${collapsed ? 'sidebar-collapsed' : ''} ${mobileOpen ? 'sidebar-open' : ''} ${toolPage ? 'tool-active' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Zum Inhalt springen</a>
    {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} tabIndex={-1} aria-label="Menü schließen" />}
    <aside className="sidebar" id="sidebar" aria-label="Hauptnavigation" aria-hidden={mobile && !mobileOpen || undefined} inert={mobile && !mobileOpen}>
      <div className="sidebar-brand">
        <a className="brand" href="#start" onClick={() => setMobileOpen(false)}><span className="brand-mark">8a<span className="brand-dot">.</span></span><span className="brand-copy">8a Tools<span>GEMEINSAM KREATIV</span></span></a>
        <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Navigation schließen"><X size={20} /></button>
      </div>
      <div className="sidebar-school"><span className="school-icon"><School size={20} /></span><span className="sidebar-label">Realschule<span>Zusmarshausen</span></span></div>
      <nav className="navigation" aria-label="Seiten">
        <p className="nav-caption">ÜBERSICHT</p>
        <a className={`nav-item ${route.page === 'home' ? 'active' : ''}`} href="#start" aria-label="Alle Tools" title="Alle Tools" onClick={() => setMobileOpen(false)}><LayoutGrid size={20} /><span className="sidebar-label">Alle Tools</span><span className="active-indicator" /></a>
        <div className="nav-divider" />
        <p className="nav-caption">DEINE WERKZEUGE</p>
        <button className={`nav-item ${route.page === 'tool' && route.type === 'whiteboard' ? 'active' : ''}`} aria-label="Excalidraw" title="Excalidraw" onClick={() => void openTool('whiteboard')} disabled={creating !== null}><Brush size={20} /><span className="sidebar-label">Excalidraw</span><Plus size={15} className="nav-plus" /></button>
        <button className={`nav-item ${route.page === 'tool' && route.type === 'writer' ? 'active' : ''}`} aria-label="Group Writer" title="Group Writer" onClick={() => void openTool('writer')} disabled={creating !== null}><FileText size={20} /><span className="sidebar-label">Group Writer</span><Plus size={15} className="nav-plus" /></button>
        <a className={`nav-item ${route.page === 'traffic' ? 'active' : ''}`} href="#ampel" aria-label="Ampel-Tool" title="Ampel-Tool" onClick={() => setMobileOpen(false)}><TrafficCone size={20} /><span className="sidebar-label">Ampel-Tool</span><ChevronRight size={15} className="nav-plus" /></a>
        <a className={`nav-item ${route.page === 'timer' ? 'active' : ''}`} href="#fokus" aria-label="Fokus-Timer" title="Fokus-Timer" onClick={() => setMobileOpen(false)}><TimerReset size={20} /><span className="sidebar-label">Fokus-Timer</span><ChevronRight size={15} className="nav-plus" /></a>
        {route.page === 'tool' && route.type === 'whiteboard' && route.id && <>
          <div className="nav-divider" />
          <p className="nav-caption">WHITEBOARD-OPTIONEN</p>
          <button className="nav-item tool-option" onClick={() => void openTool('whiteboard')}><FilePlus2 size={19} /><span className="sidebar-label">Neue Zeichnung</span></button>
          <button className="nav-item tool-option" onClick={() => runToolAction('whiteboard', 'open')} disabled={!route.editKey}><FileUp size={19} /><span className="sidebar-label">Datei öffnen</span></button>
          <button className="nav-item tool-option" onClick={() => runToolAction('whiteboard', 'save')}><Download size={19} /><span className="sidebar-label">Excalidraw-Datei</span></button>
          <button className="nav-item tool-option" onClick={() => runToolAction('whiteboard', 'png')}><FileImage size={19} /><span className="sidebar-label">Als PNG exportieren</span></button>
          <button className="nav-item tool-option" onClick={() => runToolAction('whiteboard', 'center')}><Focus size={19} /><span className="sidebar-label">Zeichnung zentrieren</span></button>
          <button className="nav-item tool-option" onClick={() => runToolAction('whiteboard', 'grid')} disabled={!route.editKey}><Grid3X3 size={19} /><span className="sidebar-label">Raster umschalten</span></button>
          <button className="nav-item tool-option danger-option" onClick={() => runToolAction('whiteboard', 'clear')} disabled={!route.editKey}><Trash2 size={19} /><span className="sidebar-label">Alles löschen</span></button>
        </>}
        {route.page === 'tool' && route.type === 'writer' && route.id && <>
          <div className="nav-divider" />
          <p className="nav-caption">WRITER-OPTIONEN</p>
          <button className="nav-item tool-option" onClick={() => void openTool('writer')}><FilePlus2 size={19} /><span className="sidebar-label">Neues Dokument</span></button>
          <button className="nav-item tool-option" onClick={() => runToolAction('writer', 'open')} disabled={!route.editKey}><FileUp size={19} /><span className="sidebar-label">Text importieren</span></button>
          <button className="nav-item tool-option" onClick={() => runToolAction('writer', 'text')}><FileType2 size={19} /><span className="sidebar-label">Als Text exportieren</span></button>
          <button className="nav-item tool-option danger-option" onClick={() => runToolAction('writer', 'clear')} disabled={!route.editKey}><Trash2 size={19} /><span className="sidebar-label">Dokument leeren</span></button>
        </>}
        <div className="nav-divider" />
        <a className={`nav-item ${route.page === 'about' ? 'active' : ''}`} href="#about" aria-label="Unser Projekt" title="Unser Projekt" onClick={() => setMobileOpen(false)}><Users size={20} /><span className="sidebar-label">Unser Projekt</span></a>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><WandSparkles size={20} /><p>Vier Tools. Viele Ideen.<span>Einfach öffnen, loslegen und mit anderen teilen.</span></p></div>
        <a className="nav-item utility-nav" href="#about" onClick={() => setMobileOpen(false)}><CircleHelp size={19} /><span className="sidebar-label">Hilfe & Infos</span></a>
        <button className="nav-item utility-nav" aria-label={theme === 'light' ? 'Dunkles Design' : 'Helles Design'} title={theme === 'light' ? 'Dunkles Design' : 'Helles Design'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}<span className="sidebar-label">{theme === 'light' ? 'Dunkles Design' : 'Helles Design'}</span></button>
        <button className="class-profile account-profile" onClick={() => { setAccountOpen(true); setMobileOpen(false); void refreshAccount().catch(() => undefined); }} aria-label={account ? 'Meine Projekte und Konto öffnen' : 'Anmelden oder Konto erstellen'}><span className="class-avatar">{account ? account.user.username.slice(0, 2).toUpperCase() : '8a'}</span><span className="sidebar-label">{account ? account.user.username : 'Anmelden'}<span>{account ? `${account.projects.length} Projekte · auf allen Geräten` : 'Konto erstellen und Projekte speichern'}</span></span><FolderOpen size={16} className="profile-heart" /></button>
      </div>
    </aside>

    <div className="workspace" inert={mobile && mobileOpen}>
      <header className="topbar">
        <div className="breadcrumbs">
          <button className="icon-button menu-toggle" onClick={() => mobile ? setMobileOpen(!mobileOpen) : setCollapsed(!collapsed)} aria-controls="sidebar" aria-expanded={mobile ? mobileOpen : !collapsed} aria-label={mobile ? 'Navigation öffnen' : collapsed ? 'Navigation ausklappen' : 'Navigation einklappen'}>{mobile ? <Menu size={21} /> : collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button>
          <a href="#start" className="breadcrumb-school">8a Tools</a><ChevronRight size={14} className="breadcrumb-chevron" /><span>{currentName}</span>
        </div>
        <div className="header-end"><span className="school-label"><span className="status-dot" />Alles bereit</span><button className="header-avatar" onClick={() => { setAccountOpen(true); void refreshAccount().catch(() => undefined); }} aria-label="Konto öffnen">{account ? account.user.username.slice(0, 2).toUpperCase() : '8a'}</button></div>
      </header>

      <main id="main-content" tabIndex={-1} className={toolPage ? 'tool-main' : 'main-content'}>
        {route.page === 'home' && <HomePage site={site} recents={recents} creating={creating} openTool={openTool} username={account?.user.username} onAccount={() => setAccountOpen(true)} />}
        {route.page === 'about' && <AboutPage schoolName={site?.schoolName || 'Realschule Zusmarshausen'} />}
        {route.page === 'timer' && <FocusTimer />}
        {route.page === 'traffic' && (!route.id ? <TrafficStartPage /> : route.teacherKey ? <TrafficTeacherPage key={route.id} roomId={route.id} teacherKey={route.teacherKey} /> : null)}
        {route.page === 'tool' && (!route.id ? <EmptyTool type={route.type} creating={creating === route.type} onCreate={() => void openTool(route.type)} /> : loadError ? <ErrorState message={loadError} /> : workspace ?
          <Suspense fallback={<ToolLoading />}>
            <LiveWorkspace key={`${workspace.id}:${route.editKey || ''}`} initial={workspace} editKey={route.editKey}>
            {route.type === 'whiteboard'
              ? <WhiteboardTool initial={workspace} editKey={route.editKey} theme={theme} onTitle={title => setWorkspace(current => current ? { ...current, title } : current)} />
              : <WriterTool initial={workspace} editKey={route.editKey} onTitle={title => setWorkspace(current => current ? { ...current, title } : current)} />}
            </LiveWorkspace>
          </Suspense> : <ToolLoading />)}
      </main>
    </div>
    <AccountDialog
      open={accountOpen}
      account={account}
      current={workspace && route.page === 'tool' ? { id: workspace.id, type: workspace.type, title: workspace.title, editKey: route.editKey } : undefined}
      onClose={() => setAccountOpen(false)}
      onChanged={refreshAccount}
    />
  </div>;
}

function HomePage({ site, recents, creating, openTool, username, onAccount }: { site: SiteData | null; recents: RecentWorkspace[]; creating: ToolKind | null; openTool: (type: ToolKind) => Promise<void>; username?: string; onAccount: () => void }) {
  const [projectMenu, setProjectMenu] = useState<{ item: RecentWorkspace; x: number; y: number } | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);

  useEffect(() => {
    if (!projectMenu) return;
    const close = () => setProjectMenu(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    addEventListener('pointerdown', close); addEventListener('resize', close); addEventListener('keydown', onKey);
    return () => { removeEventListener('pointerdown', close); removeEventListener('resize', close); removeEventListener('keydown', onKey); };
  }, [projectMenu]);

  const showProjectMenu = (item: RecentWorkspace, x: number, y: number) => {
    setProjectMenu({ item, x: Math.max(8, Math.min(x, window.innerWidth - 248)), y: Math.max(8, Math.min(y, window.innerHeight - 375)) });
  };
  const runProjectAction = async (action: 'open' | 'duplicate' | 'copy' | 'rename' | 'remove' | 'delete') => {
    if (!projectMenu || projectBusy) return;
    const item = projectMenu.item;
    setProjectMenu(null);
    try {
      if (action === 'open') window.location.hash = workspaceUrl(item.type, item.id, item.editKey).split('#')[1];
      if (action === 'copy') await navigator.clipboard.writeText(workspaceUrl(item.type, item.id, item.editKey));
      if (action === 'remove') forgetWorkspace(item.id);
      if (action === 'duplicate') {
        setProjectBusy(true);
        const copy = await duplicateWorkspace(item);
        window.location.hash = workspaceUrl(copy.type, copy.id, copy.editKey).split('#')[1];
      }
      if (action === 'rename' && item.editKey) {
        const title = window.prompt('Neuer Projektname:', item.title)?.trim();
        if (title && title !== item.title) {
          setProjectBusy(true);
          const original = await loadWorkspace(item.id);
          const result = await saveWorkspace(item.id, item.editKey, title.slice(0, 120));
          rememberWorkspace({ ...original, title: title.slice(0, 120), updatedAt: result.updatedAt }, item.editKey);
        }
      }
      if (action === 'delete' && item.editKey && window.confirm(`„${item.title}“ wirklich endgültig löschen?`)) {
        setProjectBusy(true);
        await deleteWorkspace(item.id, item.editKey);
      }
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Die Aktion konnte nicht ausgeführt werden.'); }
    finally { setProjectBusy(false); }
  };

  return <>
    <div className="dashboard-welcome"><div><span className="eyebrow">DEIN DIGITALER KREATIVRAUM</span><p>{username ? `Schön, dass du da bist, ${username}.` : 'Gute Ideen entstehen zusammen.'}</p></div><span className="class-badge"><School size={15} /> Von der 8a. Für alle.</span></div>
    <section className="dashboard-hero">
      <div className="hero-copy"><span className="hero-tag"><Sparkles size={14} /> GEMEINSAM KREATIV</span><h1>Ideen brauchen<br /><span>den richtigen<br className="hero-title-break" /> Raum.</span></h1><p>{site?.welcomeText || 'Kreative Werkzeuge für Ideen, Gruppenarbeit und alles, was wir gemeinsam schaffen.'}</p><div className="hero-actions"><button className="primary-button" onClick={() => void openTool('whiteboard')} disabled={creating !== null}><Brush size={17} /> Whiteboard starten<ArrowUpRight size={16} /></button><button className="secondary-button" onClick={() => void openTool('writer')} disabled={creating !== null}><FileText size={17} /> Dokument starten</button></div><div className="hero-footnote"><Check size={14} /> Kostenlos. Direkt im Browser. Zusammen.</div></div>
      <CreativeCollage />
    </section>

    <section className="tools-section" aria-labelledby="tools-heading"><div className="section-heading"><div><span className="eyebrow">WERKZEUGE</span><h2 id="tools-heading">Was möchtest du heute machen?</h2><p>Ohne Anmeldung. Direkt im Browser. Bereit zum Teilen.</p></div><span className="section-chip"><span />4 Tools verfügbar</span></div>
      <div className="tool-grid">
        {(['whiteboard', 'writer'] as ToolKind[]).map((type, index) => {
          const info = toolInfo[type]; const Icon = info.icon;
          return <article className={`tool-card ${info.color}`} key={type}>
            <ToolPreview type={type} />
            <div className="tool-card-head"><span className="large-tool-icon"><Icon size={23} /></span><span className="tool-number">0{index + 1}</span></div>
            <span className="tool-eyebrow">{info.eyebrow}</span><h3>{info.name}</h3><p>{info.description}</p>
            <div className="tag-row">{type === 'whiteboard' ? <><span>Freihand</span><span>Diagramme</span><span>Export</span></> : <><span>Formatieren</span><span>Live-Sync</span><span>Export</span></>}</div>
            <button className="tool-launch" onClick={() => void openTool(type)} disabled={creating !== null}>{creating === type ? 'Wird geöffnet …' : `${info.name} öffnen`}<ArrowUpRight size={20} /></button>
          </article>;
        })}
        <article className="tool-card traffic-card"><ToolPreview type="traffic" /><div className="tool-card-head"><span className="large-tool-icon"><TrafficCone size={23} /></span><span className="tool-number">03</span></div><span className="tool-eyebrow">LIVE-FEEDBACK</span><h3>Ampel-Tool</h3><p>Die Stimmung oder den Lernstand einer ganzen Klasse auf einen Blick sehen.</p><div className="tag-row"><span>QR-Code</span><span>Live</span><span>Einfach</span></div><a className="tool-launch" href="#ampel">Ampel-Tool öffnen<ArrowUpRight size={20} /></a></article>
        <article className="tool-card timer-card"><ToolPreview type="timer" /><div className="tool-card-head"><span className="large-tool-icon"><TimerReset size={23} /></span><span className="tool-number">04</span></div><span className="tool-eyebrow">ZEIT IM BLICK</span><h3>Fokus-Timer</h3><p>Arbeitsphasen, Präsentationen und Pausen ruhig und sichtbar strukturieren.</p><div className="tag-row"><span>Fokus</span><span>Pausen</span><span>Signal</span></div><a className="tool-launch" href="#fokus">Fokus-Timer öffnen<ArrowUpRight size={20} /></a></article>
      </div>
    </section>

    {recents.length > 0 && <section className="recent-section"><div className="section-heading"><div><span className="eyebrow">ZU LETZT GEÖFFNET</span><h2>Weiterarbeiten</h2><p>Rechtsklick für weitere Projektaktionen.</p></div></div><div className="recent-list">{recents.slice(0, 4).map(item => { const Icon = item.type === 'whiteboard' ? Brush : FileText; const fullUrl = workspaceUrl(item.type, item.id, item.editKey); return <div key={item.id} className="recent-item" onContextMenu={event => { event.preventDefault(); showProjectMenu(item, event.clientX, event.clientY); }}>
      <a className="recent-main" href={`#${fullUrl.split('#')[1]}`}><span className={`recent-icon ${item.type}`}><Icon size={19} /></span><span><strong>{item.title}</strong><small>{item.type === 'whiteboard' ? 'Whiteboard' : 'Dokument'} · {new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(item.updatedAt))}</small></span></a>
      <button className="project-menu-trigger" aria-label={`Aktionen für ${item.title}`} onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); showProjectMenu(item, bounds.right - 210, bounds.bottom + 7); }}><MoreVertical size={17} /></button>
    </div>; })}</div></section>}
    {recents.length === 0 && <section className="workspace-invitation"><span className="invitation-icon"><FolderOpen size={26} /></span><div><span className="eyebrow">DEIN PLATZ FÜR PROJEKTE</span><h2>Heute anfangen. Morgen weitermachen.</h2><p>Mit einem Konto hast du deine gespeicherten Projekte auf allen Geräten dabei.</p></div><button className="secondary-button" onClick={onAccount}>{username ? 'Meine Projekte' : 'Deinen Bereich öffnen'}<ArrowRight size={17} /></button></section>}
    {projectMenu && <div className="project-context-menu" role="menu" aria-label={`Aktionen für ${projectMenu.item.title}`} style={{ left: projectMenu.x, top: projectMenu.y }} onPointerDown={event => event.stopPropagation()}>
      <div className="context-project"><span className={`recent-icon ${projectMenu.item.type}`}>{projectMenu.item.type === 'whiteboard' ? <Brush size={17} /> : <FileText size={17} />}</span><span><strong>{projectMenu.item.title}</strong><small>{projectMenu.item.type === 'whiteboard' ? 'Whiteboard' : 'Dokument'}</small></span></div>
      <div className="context-separator" />
      <button role="menuitem" onClick={() => void runProjectAction('open')}><ExternalLink size={16} /> Öffnen</button>
      <button role="menuitem" onClick={() => void runProjectAction('duplicate')}><FilePlus2 size={16} /> Duplizieren</button>
      <button role="menuitem" onClick={() => void runProjectAction('copy')}><Copy size={16} /> Link kopieren</button>
      {projectMenu.item.editKey && <button role="menuitem" onClick={() => void runProjectAction('rename')}><FileType2 size={16} /> Umbenennen</button>}
      <div className="context-separator" />
      <button role="menuitem" onClick={() => void runProjectAction('remove')}><X size={16} /> Aus Liste entfernen</button>
      {projectMenu.item.editKey && <button className="context-danger" role="menuitem" onClick={() => void runProjectAction('delete')}><Trash2 size={16} /> Endgültig löschen</button>}
    </div>}
    <footer className="footer"><span><strong>8a Tools</strong><span className="footer-separator">/</span>{site?.schoolName || 'Realschule Zusmarshausen'}</span><span>Von uns gemacht. Für uns gedacht.<Heart size={13} /></span></footer>
  </>;
}

function AboutPage({ schoolName }: { schoolName: string }) {
  return <><div className="page-heading"><div><span className="eyebrow">UNSER PROJEKT</span><h1>Werkzeuge, die Zusammenarbeit leichter machen.</h1><p>Von der 8a für alle, die gemeinsam Ideen entwickeln möchten.</p></div></div><section className="about-panel"><span className="hero-tag"><Users size={13} /> GEMEINSAM STATT ALLEIN</span><h2>Ein Ort. Viele Möglichkeiten.</h2><p>8a Tools bündelt freie, bewährte Werkzeuge in einem ruhigen und einheitlichen Design. Whiteboards und Dokumente lassen sich sofort erstellen, automatisch speichern und per Link oder QR-Code teilen.</p><div className="about-values"><article><Brush size={22} /><h3>Visuell denken</h3><p>Skizzen, Erklärungen und Abläufe auf einer freien Fläche.</p></article><article><FileText size={22} /><h3>Gemeinsam schreiben</h3><p>Texte im Team entwerfen, formatieren und exportieren.</p></article><article><Sparkles size={22} /><h3>Einfach teilen</h3><p>Bearbeitungs- oder Leselink passend zur Situation.</p></article></div><div className="project-notice"><Info size={21} /><p>Ein Klassenprojekt der 8a an der {schoolName}. Die integrierten Editoren basieren auf freien Open-Source-Projekten.</p></div><a href="#start" className="primary-button"><Home size={17} /> Zu den Tools</a></section></>;
}

function EmptyTool({ type, creating, onCreate }: { type: ToolKind; creating: boolean; onCreate: () => void }) { const Icon = toolInfo[type].icon; return <div className="center-state"><span className={`large-tool-icon ${toolInfo[type].color}`}><Icon size={32} /></span><h1>{toolInfo[type].name}</h1><p>{toolInfo[type].description}</p><button className="primary-button" onClick={onCreate} disabled={creating}><Plus size={18} /> {creating ? 'Wird erstellt …' : 'Neu erstellen'}</button></div>; }
function ToolLoading() { return <div className="center-state"><span className="loader" /><h2>Werkzeug wird vorbereitet …</h2></div>; }
function ErrorState({ message }: { message: string }) { return <div className="center-state"><span className="error-symbol">!</span><h1>Das hat nicht geklappt.</h1><p>{message}</p><a className="primary-button" href="#start">Zurück zu den Tools</a></div>; }
