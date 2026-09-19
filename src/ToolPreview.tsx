import { ArrowUpRight, Check, MousePointer2, Pencil, Play, Users } from 'lucide-react';

/** Decorative, code-drawn previews stay crisp at every screen size. */
export default function ToolPreview({ type }: { type: 'whiteboard' | 'writer' | 'traffic' | 'timer' }) {
  return <div className={`tool-preview preview-${type}`} aria-hidden="true">
    {type === 'whiteboard' ? <>
      <svg className="preview-connections" viewBox="0 0 320 170" fill="none">
        <path d="M101 87C143 87 139 43 188 43M101 87C152 87 135 129 191 129" stroke="currentColor" strokeWidth="2" strokeDasharray="5 5" />
        <path d="m182 37 7 6-7 6m3 74 7 6-7 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="preview-idea">Eine gute<br /><strong>Idee.</strong></span>
      <span className="preview-note first">Zusammen<br />weiterdenken ✦</span>
      <span className="preview-note second">Einfach machen!</span>
      <span className="preview-cursor"><MousePointer2 size={17} fill="currentColor" /> Du</span>
    </> : type === 'writer' ? <>
      <div className="preview-paper"><span className="preview-paper-kicker">UNSER NÄCHSTES PROJEKT</span><strong>Aus Worten<br />wird etwas Großes.</strong><span className="preview-text-line" /><span className="preview-text-line short" /><span className="preview-highlight">Gemeinsam geht mehr.<i /></span></div>
      <span className="preview-pen"><Pencil size={18} /></span>
      <span className="preview-collaborator"><span /> Gemeinsam schreiben</span>
    </> : type === 'traffic' ? <>
      <div className="preview-feedback"><span>Wie läuft’s bei euch?</span><div className="preview-lights"><i /><i /><i><Check size={24} /></i></div></div>
      <span className="preview-response"><Users size={15} /> Alle im Blick <ArrowUpRight size={15} /></span>
    </> : <>
      <div className="preview-timer-ring"><span>15:00</span><small>FOKUS</small></div>
      <span className="preview-timer-play"><Play size={16} fill="currentColor" /> Start</span>
      <span className="preview-timer-note">Zeit für eure Idee ✦</span>
    </>}
  </div>;
}

export function CreativeCollage() {
  return <div className="creative-collage" aria-hidden="true">
    <span className="collage-orbit" />
    <div className="collage-sheet"><div className="collage-sheet-bar"><span /><span /><span /><small>Platz für eure Ideen</small></div><ToolPreview type="whiteboard" /></div>
    <div className="collage-sticker"><span>kleine Idee,</span><strong>große<br />Sache.</strong><span className="sticker-star">✳</span></div>
    <div className="collage-team"><span className="collage-avatars"><i>A</i><i>B</i><i>Du</i></span><span>Zusammen<br /><strong>wird’s besser.</strong></span></div>
    <span className="collage-spark">✳</span>
    <span className="collage-caption">Hier beginnt euer nächstes Projekt.</span>
  </div>;
}
