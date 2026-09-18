import { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw, exportToBlob, loadFromBlob, serializeAsJSON } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { Cloud, CloudOff, Eye, Share2 } from 'lucide-react';
import type { Workspace } from './types';
import { rememberWorkspace, saveWorkspace, subscribeWorkspace } from './workspaces';
import ShareDialog from './ShareDialog';

type Props = { initial: Workspace; editKey?: string; theme: string; onTitle: (title: string) => void };

export default function WhiteboardTool({ initial, editKey, theme, onTitle }: Props) {
  const [title, setTitle] = useState(initial.title);
  const [shareOpen, setShareOpen] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>(editKey ? 'saved' : 'saved');
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef(initial.content);
  const titleRef = useRef(initial.title);
  const updatedAtRef = useRef(initial.updatedAt);
  const timerRef = useRef<number | undefined>(undefined);
  const applyingRemoteRef = useRef(false);
  const readOnly = !editKey;

  const initialData = (() => {
    try { return JSON.parse(initial.content); } catch { return { elements: [], appState: {}, files: {} }; }
  })();

  const persist = useCallback(async (content = contentRef.current, nextTitle = titleRef.current) => {
    if (!editKey) return;
    setSaveState('saving');
    try {
      const result = await saveWorkspace(initial.id, editKey, nextTitle, content);
      updatedAtRef.current = result.updatedAt;
      rememberWorkspace({ ...initial, title: nextTitle, updatedAt: result.updatedAt }, editKey);
      setSaveState('saved');
    } catch { setSaveState('error'); }
  }, [editKey, initial]);

  const queueSave = useCallback((content?: string) => {
    if (content) contentRef.current = content;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void persist(), 180);
  }, [persist]);

  const downloadBlob = useCallback((blob: Blob, extension: string) => {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${titleRef.current.toLowerCase().replace(/[^a-z0-9äöü]+/gi, '-') || 'whiteboard'}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  }, []);

  const showToast = useCallback((message: string) => apiRef.current?.setToast({ message, duration: 2200 }), []);

  useEffect(() => {
    const handleAction = async (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      const api = apiRef.current;
      if (!api || !action) return;
      try {
        if (action === 'open') fileInputRef.current?.click();
        if (action === 'save') {
          const data = serializeAsJSON(api.getSceneElementsIncludingDeleted(), api.getAppState(), api.getFiles(), 'local');
          downloadBlob(new Blob([data], { type: 'application/vnd.excalidraw+json' }), 'excalidraw');
          showToast('Excalidraw-Datei gespeichert');
        }
        if (action === 'png') {
          const blob = await exportToBlob({ elements: api.getSceneElements(), appState: { ...api.getAppState(), exportBackground: true }, files: api.getFiles(), mimeType: 'image/png', exportPadding: 24 });
          downloadBlob(blob, 'png');
          showToast('PNG wurde exportiert');
        }
        if (action === 'center') {
          api.scrollToContent(api.getSceneElements(), { fitToViewport: true, animate: true, duration: 350 });
        }
        if (action === 'grid' && editKey) {
          api.updateScene({ appState: { gridModeEnabled: !api.getAppState().gridModeEnabled } });
          showToast(api.getAppState().gridModeEnabled ? 'Raster eingeblendet' : 'Raster ausgeblendet');
        }
        if (action === 'clear' && editKey && api.getSceneElements().length > 0 && window.confirm('Möchtest du wirklich die gesamte Zeichnung löschen?')) {
          api.resetScene();
          showToast('Whiteboard geleert');
        }
      } catch {
        showToast('Diese Aktion konnte nicht ausgeführt werden');
      }
    };
    window.addEventListener('8a:whiteboard-action', handleAction);
    return () => window.removeEventListener('8a:whiteboard-action', handleAction);
  }, [downloadBlob, editKey, showToast]);

  const openFile = async (file?: File) => {
    const api = apiRef.current;
    if (!api || !file || !editKey) return;
    try {
      const scene = await loadFromBlob(file, api.getAppState(), api.getSceneElements());
      api.updateScene({ elements: scene.elements, appState: scene.appState });
      if (scene.files) api.addFiles(Object.values(scene.files));
      showToast('Zeichnung geöffnet');
    } catch { showToast('Die Datei ist keine gültige Excalidraw-Zeichnung'); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  useEffect(() => {
    return subscribeWorkspace(initial.id, remote => {
      try {
        if (remote.updatedAt < updatedAtRef.current) return;
        updatedAtRef.current = remote.updatedAt;
        if (remote.content !== contentRef.current) {
          window.clearTimeout(timerRef.current);
          const parsed = JSON.parse(remote.content);
          contentRef.current = remote.content;
          applyingRemoteRef.current = true;
          apiRef.current?.updateScene({ elements: parsed.elements, appState: parsed.appState });
          if (parsed.files) apiRef.current?.addFiles(Object.values(parsed.files));
          requestAnimationFrame(() => { applyingRemoteRef.current = false; });
        }
        if (remote.title !== titleRef.current) { titleRef.current = remote.title; setTitle(remote.title); onTitle(remote.title); }
      } catch { /* A brief connection loss should not interrupt drawing. */ }
    });
  }, [initial.id, onTitle]);

  const onChange = (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    if (readOnly || applyingRemoteRef.current) return;
    const cleanState = { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize, gridStep: appState.gridStep, gridModeEnabled: appState.gridModeEnabled };
    const content = JSON.stringify({ elements, appState: cleanState, files });
    if (content !== contentRef.current) queueSave(content);
  };
  const updateTitle = (value: string) => {
    setTitle(value); titleRef.current = value; onTitle(value);
    if (value.trim()) queueSave();
  };

  return <div className="tool-screen">
    <input ref={fileInputRef} className="visually-hidden" type="file" accept=".excalidraw,application/json" tabIndex={-1} onChange={event => void openFile(event.target.files?.[0])} />
    <div className="tool-commandbar">
      <div className="tool-title-wrap">
        <span className="tool-mark whiteboard-mark">✦</span>
        <div><span className="tool-label">WHITEBOARD</span><input aria-label="Whiteboard-Titel" value={title} onChange={event => updateTitle(event.target.value)} readOnly={readOnly} /></div>
      </div>
      <div className="tool-actions">
        <span className={`save-status ${saveState}`} aria-live="polite">{readOnly ? <><Eye size={15} /> Nur ansehen</> : saveState === 'error' ? <><CloudOff size={15} /> Nicht gespeichert</> : <><Cloud size={15} /> {saveState === 'saving' ? 'Speichert …' : 'Gespeichert'}</>}</span>
        <button className="primary-button compact" onClick={() => setShareOpen(true)}><Share2 size={16} /> Teilen</button>
      </div>
    </div>
    {readOnly && <div className="readonly-banner"><Eye size={16} /> Du siehst dieses Whiteboard schreibgeschützt. Bitte um einen Bearbeitungslink, um mitzuzeichnen.</div>}
    <div className="whiteboard-canvas">
      <Excalidraw
        excalidrawAPI={api => { apiRef.current = api; }}
        initialData={initialData}
        onChange={onChange}
        viewModeEnabled={readOnly}
        theme={theme === 'dark' ? 'dark' : 'light'}
        langCode="de-DE"
        UIOptions={{ canvasActions: { changeViewBackgroundColor: false, clearCanvas: false, export: false, loadScene: false, saveToActiveFile: false, toggleTheme: false, saveAsImage: false } }}
      />
    </div>
    <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} type="whiteboard" id={initial.id} editKey={editKey} title={title} />
  </div>;
}
