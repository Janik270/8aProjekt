import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Eye, Link2, PenLine, X } from 'lucide-react';
import QRCode from 'qrcode';
import type { ToolKind } from './types';
import { workspaceUrl } from './workspaces';

type Props = { open: boolean; onClose: () => void; type: ToolKind; id: string; editKey?: string; title: string };

export default function ShareDialog({ open, onClose, type, id, editKey, title }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [allowEdit, setAllowEdit] = useState(Boolean(editKey));
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState('');
  const url = workspaceUrl(type, id, allowEdit ? editKey : undefined);

  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close(); }, [open]);
  useEffect(() => { setAllowEdit(Boolean(editKey)); }, [editKey, open]);
  useEffect(() => { void QRCode.toDataURL(url, { width: 420, margin: 2, color: { dark: '#273248', light: '#ffffff' } }).then(setQr); }, [url]);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const download = () => {
    const anchor = document.createElement('a');
    anchor.href = qr;
    anchor.download = `${title.toLowerCase().replace(/[^a-z0-9äöü]+/gi, '-') || 'scool-tool'}-qr.png`;
    anchor.click();
  };

  return <dialog ref={ref} className="share-dialog" onClose={onClose} onCancel={event => { event.preventDefault(); onClose(); }}>
    <button className="icon-button modal-x" onClick={onClose} aria-label="Teilen schließen"><X size={20} /></button>
    <span className="dialog-kicker"><Link2 size={15} /> GEMEINSAM ARBEITEN</span>
    <h2>Per Link oder QR-Code teilen</h2>
    <p>Alle mit diesem Link öffnen direkt {type === 'whiteboard' ? 'das Whiteboard' : 'das Dokument'}.</p>
    {editKey && <div className="permission-switch" role="group" aria-label="Berechtigung">
      <button className={!allowEdit ? 'active' : ''} onClick={() => setAllowEdit(false)}><Eye size={16} /> Nur ansehen</button>
      <button className={allowEdit ? 'active' : ''} onClick={() => setAllowEdit(true)}><PenLine size={16} /> Mitbearbeiten</button>
    </div>}
    <div className="share-body">
      <div className="qr-frame">{qr && <img src={qr} alt="QR-Code zum Arbeitsbereich" />}</div>
      <div className="share-actions">
        <label>Freigabelink</label>
        <div className="copy-field"><input value={url} readOnly aria-label="Freigabelink" /><button onClick={copy} aria-label="Link kopieren">{copied ? <Check size={18} /> : <Copy size={18} />}</button></div>
        <button className="secondary-button wide" onClick={download}><Download size={17} /> QR-Code herunterladen</button>
        <p className="share-hint">{allowEdit ? 'Mit diesem Link können andere Änderungen vornehmen.' : 'Dieser Link zeigt den Inhalt ohne Bearbeitungsrechte.'}</p>
      </div>
    </div>
  </dialog>;
}
