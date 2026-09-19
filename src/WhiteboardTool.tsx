import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, exportToBlob, loadFromBlob, reconcileElements, restoreElements, serializeAsJSON } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { Eye, Share2 } from 'lucide-react';
import type { Workspace } from './types';
import { CollaborationBar, useLiveSession, useLiveTitle, type Presence } from './LiveWorkspace';
import ShareDialog from './ShareDialog';

type Props = { initial: Workspace; editKey?: string; theme: string; onTitle: (title: string) => void };

export default function WhiteboardTool({ initial, editKey, theme, onTitle }: Props) {
  const session = useLiveSession();
  const [title, updateTitle] = useLiveTitle(onTitle);
  const [shareOpen, setShareOpen] = useState(false);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [readyApi, setReadyApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const initializedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  const elementsMap = session.doc.getMap<ExcalidrawElement>('elements');
  const filesMap = session.doc.getMap<BinaryFiles[string]>('files');
  const stateMap = session.doc.getMap('appState');
  const lastElements = useRef(new Map([...elementsMap.entries()]));
  const readOnly = !editKey;

  // Excalidraw mutates elements during dragging; keep Yjs values and comparison snapshots detached.
  const sceneElements = () => structuredClone([...elementsMap.values()]).sort((a, b) => {
    const left = `${a.index || ''}:${a.id}`, right = `${b.index || ''}:${b.id}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const [initialData] = useState(() => ({ elements: sceneElements(), appState: stateMap.toJSON(), files: filesMap.toJSON() }));

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

  useEffect(() => {
    if (!readyApi) return;
    const applyScene = (_update: Uint8Array, origin: unknown) => {
      if (origin !== session) return;
      const remote = sceneElements();
      lastElements.current = new Map(remote.map(element => [element.id, { ...element }]));
      const api = readyApi;
      // Keep a locally active drag/text edit when another participant sends a scene update.
      const elements = reconcileElements(api.getSceneElementsIncludingDeleted(), restoreElements(remote, null) as unknown as Parameters<typeof reconcileElements>[1], api.getAppState());
      api.addFiles([...filesMap.values()]);
      api.updateScene({ elements, appState: { ...api.getAppState(), ...stateMap.toJSON() }, captureUpdate: CaptureUpdateAction.NEVER });
    };
    const applyPresence = () => {
      const collaborators: AppState['collaborators'] = new Map();
      for (const [id, raw] of session.awareness.getStates()) {
        if (id === session.doc.clientID) continue;
        const state = raw as Presence;
        if (!state.user) continue;
        collaborators.set(String(id) as Parameters<typeof collaborators.set>[0], {
          username: state.user.name, pointer: state.pointer, button: state.button,
          selectedElementIds: state.selectedElementIds,
          color: { background: state.user.color, stroke: state.user.color },
        });
      }
      apiRef.current?.updateScene({ collaborators });
    };
    session.doc.on('update', applyScene);
    session.addEventListener('presence', applyPresence);
    applyScene(new Uint8Array(), session);
    initializedRef.current = true;
    applyPresence();
    return () => { initializedRef.current = false; session.doc.off('update', applyScene); session.removeEventListener('presence', applyPresence); };
  }, [session, readyApi]);

  const onChange = (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    if (readOnly || !initializedRef.current) return;
    const cleanState = { viewBackgroundColor: appState.viewBackgroundColor, gridSize: appState.gridSize, gridStep: appState.gridStep, gridModeEnabled: appState.gridModeEnabled };
    session.doc.transact(() => {
      for (const element of elements) {
        const previous = lastElements.current.get(element.id);
        if (!previous || previous.version !== element.version || previous.versionNonce !== element.versionNonce || previous.index !== element.index) elementsMap.set(element.id, structuredClone(element));
      }
      // Excalidraw's reset/import can remove elements instead of returning tombstones.
      const ids = new Set(elements.map(element => element.id));
      for (const [id, element] of lastElements.current) {
        if (!ids.has(id) && !element.isDeleted) elementsMap.set(id, { ...element, isDeleted: true, version: element.version + 1 });
      }
      for (const [id, file] of Object.entries(files)) if (filesMap.get(id)?.dataURL !== file.dataURL) filesMap.set(id, file);
      for (const [key, value] of Object.entries(cleanState)) if (stateMap.get(key) !== value) stateMap.set(key, value);
    });
    lastElements.current = new Map(elements.map(element => [element.id, { ...element }]));
    if (JSON.stringify(session.awareness.getLocalState()?.selectedElementIds) !== JSON.stringify(appState.selectedElementIds)) session.awareness.setLocalStateField('selectedElementIds', appState.selectedElementIds);
  };

  return <div className="tool-screen">
    <input ref={fileInputRef} className="visually-hidden" type="file" accept=".excalidraw,application/json" tabIndex={-1} onChange={event => void openFile(event.target.files?.[0])} />
    <div className="tool-commandbar">
      <div className="tool-title-wrap">
        <span className="tool-mark whiteboard-mark">✦</span>
        <div><span className="tool-label">WHITEBOARD</span><input aria-label="Whiteboard-Titel" value={title} onChange={event => updateTitle(event.target.value)} readOnly={readOnly} /></div>
      </div>
      <div className="tool-actions">
        {readOnly && <span className="save-status"><Eye size={15} /> Nur ansehen</span>}
        <button className="primary-button compact" onClick={() => setShareOpen(true)}><Share2 size={16} /> Teilen</button>
      </div>
    </div>
    <CollaborationBar />
    {readOnly && <div className="readonly-banner"><Eye size={16} /> Du siehst dieses Whiteboard schreibgeschützt. Bitte um einen Bearbeitungslink, um mitzuzeichnen.</div>}
    <div className="whiteboard-canvas">
      <Excalidraw
        excalidrawAPI={api => { apiRef.current = api; setReadyApi(api); }}
        initialData={initialData}
        onChange={onChange}
        isCollaborating
        onPointerUpdate={({ pointer, button }) => session.awareness.setLocalState({ ...session.awareness.getLocalState(), pointer, button })}
        viewModeEnabled={readOnly}
        theme={theme === 'dark' ? 'dark' : 'light'}
        langCode="de-DE"
        UIOptions={{ canvasActions: { changeViewBackgroundColor: false, clearCanvas: false, export: false, loadScene: false, saveToActiveFile: false, toggleTheme: false, saveAsImage: false } }}
      />
    </div>
    <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} type="whiteboard" id={initial.id} editKey={editKey} title={title} />
  </div>;
}
