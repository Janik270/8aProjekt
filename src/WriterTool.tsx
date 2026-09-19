import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { Bold, Eye, Heading1, Heading2, Italic, List, ListOrdered, Minus, Redo2, Share2, Strikethrough, Undo2 } from 'lucide-react';
import type { Workspace } from './types';
import { CollaborationBar, useLiveSession, useLiveTitle } from './LiveWorkspace';
import ShareDialog from './ShareDialog';

type Props = { initial: Workspace; editKey?: string; onTitle: (title: string) => void };

export default function WriterTool({ initial, editKey, onTitle }: Props) {
  const session = useLiveSession();
  const [title, updateTitle] = useLiveTitle(onTitle);
  const [shareOpen, setShareOpen] = useState(false);
  const editKeyRef = useRef(editKey);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readOnly = !editKey;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: session.doc }),
      CollaborationCaret.configure({ provider: session, user: { name: session.name, color: session.color } }),
    ],
    editable: !readOnly,
    editorProps: { attributes: { class: 'writer-prose', 'aria-label': 'Gemeinsames Dokument' } },
  });

  useEffect(() => { editor?.setEditable(!readOnly); }, [editor, readOnly]);
  const downloadFile = (content: string, extension: string, mimeType: string) => {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
    anchor.download = `${title.toLowerCase().replace(/[^a-z0-9äöü]+/gi, '-') || 'dokument'}.${extension}`;
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
  };
  const importFile = async (file?: File) => {
    if (!file || !editor || !editKeyRef.current) return;
    const raw = await file.text();
    let html: string;
    if (/\.html?$/i.test(file.name) || file.type === 'text/html') {
      const document = new DOMParser().parseFromString(raw, 'text/html');
      document.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
      document.querySelectorAll('*').forEach(node => {
        for (const attribute of [...node.attributes]) {
          if (attribute.name.startsWith('on') || /^(javascript|data):/i.test(attribute.value)) node.removeAttribute(attribute.name);
        }
      });
      html = document.body.innerHTML;
    } else {
      const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      html = raw.split(/\n{2,}/).map(block => `<p>${escape(block).replaceAll('\n', '<br>')}</p>`).join('');
    }
    editor.commands.setContent(html || '<p></p>');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (!action) return;
      if (action === 'open') fileInputRef.current?.click();
      if (action === 'text') downloadFile(editor?.getText() || '', 'txt', 'text/plain');
      if (action === 'clear' && editor && editKeyRef.current && window.confirm('Möchtest du wirklich den gesamten Dokumentinhalt löschen?')) {
        editor.commands.clearContent();
      }
    };
    window.addEventListener('8a:writer-action', handleAction);
    return () => window.removeEventListener('8a:writer-action', handleAction);
  }, [editor, title]);

  const ToolButton = ({ label, active = false, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) =>
    <button className={active ? 'active' : ''} aria-label={label} title={label} onClick={onClick} disabled={readOnly}>{children}</button>;

  return <div className="tool-screen writer-screen">
    <input ref={fileInputRef} className="visually-hidden" type="file" accept=".txt,.md,.html,.htm,text/plain,text/markdown,text/html" tabIndex={-1} onChange={event => void importFile(event.target.files?.[0])} />
    <div className="tool-commandbar">
      <div className="tool-title-wrap">
        <span className="tool-mark writer-mark">Aa</span>
        <div><span className="tool-label">GROUP WRITER</span><input aria-label="Dokumenttitel" value={title} onChange={event => updateTitle(event.target.value)} readOnly={readOnly} /></div>
      </div>
      <div className="tool-actions">
        {readOnly && <span className="save-status"><Eye size={15} /> Nur ansehen</span>}
        <button className="primary-button compact" onClick={() => setShareOpen(true)}><Share2 size={16} /> Teilen</button>
      </div>
    </div>
    <CollaborationBar />
    {readOnly && <div className="readonly-banner"><Eye size={16} /> Dieses Dokument ist schreibgeschützt. Änderungen siehst du automatisch.</div>}
    <div className="writer-workspace">
      <div className="writer-toolbar" aria-label="Text formatieren">
        <ToolButton label="Rückgängig" onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={17} /></ToolButton>
        <ToolButton label="Wiederholen" onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={17} /></ToolButton><Minus size={16} className="toolbar-divider" />
        <ToolButton label="Überschrift 1" active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}><Heading1 size={18} /></ToolButton>
        <ToolButton label="Überschrift 2" active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={18} /></ToolButton>
        <ToolButton label="Fett" active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={17} /></ToolButton>
        <ToolButton label="Kursiv" active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={17} /></ToolButton>
        <ToolButton label="Durchgestrichen" active={editor?.isActive('strike')} onClick={() => editor?.chain().focus().toggleStrike().run()}><Strikethrough size={17} /></ToolButton><Minus size={16} className="toolbar-divider" />
        <ToolButton label="Aufzählung" active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={18} /></ToolButton>
        <ToolButton label="Nummerierte Liste" active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={18} /></ToolButton>
      </div>
      <div className="paper"><EditorContent editor={editor} /></div>
    </div>
    <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} type="writer" id={initial.id} editKey={editKey} title={title} />
  </div>;
}
