import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Bell, Minus, Pause, Play, Plus, RotateCcw, TimerReset } from 'lucide-react';

const presets = [5, 10, 15, 25, 45];

function playFinishedSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const start = context.currentTime;
    [0, .22].forEach(offset => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 720;
      gain.gain.setValueAtTime(.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(.18, start + offset + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, start + offset + .18);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + .2);
    });
    window.setTimeout(() => void context.close(), 700);
  } catch { /* Audio may be blocked by the browser. */ }
}

export default function FocusTimer() {
  const [duration, setDuration] = useState(25 * 60);
  const [remaining, setRemaining] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const deadline = useRef(0);
  const originalTitle = useRef(document.title);

  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const next = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) {
        setRunning(false);
        setHasStarted(false);
        setFinished(true);
        playFinishedSound();
      }
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [running]);

  useEffect(() => {
    const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
    const seconds = (remaining % 60).toString().padStart(2, '0');
    document.title = `${minutes}:${seconds} · Fokus-Timer`;
    return () => { document.title = originalTitle.current; };
  }, [remaining]);

  const chooseDuration = (minutes: number) => {
    const value = minutes * 60;
    setDuration(value); setRemaining(value); setRunning(false); setHasStarted(false); setFinished(false);
  };
  const adjust = (minutes: number) => {
    const value = Math.min(120 * 60, Math.max(60, duration + minutes * 60));
    setDuration(value); setRemaining(value); setRunning(false); setHasStarted(false); setFinished(false);
  };
  const toggle = () => {
    if (running) {
      setRemaining(Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)));
      setRunning(false);
      return;
    }
    const next = remaining || duration;
    setRemaining(next); setFinished(false); setHasStarted(true); deadline.current = Date.now() + next * 1000; setRunning(true);
  };
  const reset = () => { setRunning(false); setHasStarted(false); setRemaining(duration); setFinished(false); };
  const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
  const seconds = (remaining % 60).toString().padStart(2, '0');
  const progress = duration ? ((duration - remaining) / duration) * 100 : 0;

  return <div className="focus-page">
    <header className="focus-heading">
      <span className="eyebrow"><TimerReset size={15} /> ZEIT IM BLICK</span>
      <h1>Fokus-Timer</h1>
      <p>Für konzentrierte Arbeitsphasen, Präsentationen oder eine kurze Pause.</p>
    </header>
    <section className={`focus-panel ${finished ? 'finished' : ''}`}>
      <div className="timer-presets" aria-label="Zeit auswählen">
        {presets.map(value => <button key={value} className={duration === value * 60 ? 'active' : ''} onClick={() => chooseDuration(value)}>{value} Min.</button>)}
      </div>
      <div className="timer-dial" style={{ '--timer-progress': `${progress}%` } as CSSProperties}>
        <div className="timer-dial-inner">
          <span>{running ? 'FOKUS LÄUFT' : finished ? 'GESCHAFFT' : 'BEREIT'}</span>
          <strong aria-live="polite" aria-label={`${minutes} Minuten und ${seconds} Sekunden`}>{minutes}:{seconds}</strong>
          <small>{finished ? <><Bell size={14} /> Zeit ist um</> : `${Math.round(duration / 60)} Minuten`}</small>
        </div>
      </div>
      <div className="timer-controls">
        <button className="timer-small-button" onClick={() => adjust(-1)} disabled={running} aria-label="Eine Minute abziehen"><Minus size={20} /></button>
        <button className="timer-main-button" onClick={toggle}>{running ? <><Pause size={22} fill="currentColor" /> Pause</> : <><Play size={22} fill="currentColor" /> {hasStarted && remaining > 0 ? 'Weiter' : 'Start'}</>}</button>
        <button className="timer-small-button" onClick={() => adjust(1)} disabled={running} aria-label="Eine Minute hinzufügen"><Plus size={20} /></button>
      </div>
      <button className="timer-reset" onClick={reset}><RotateCcw size={16} /> Zurücksetzen</button>
      <p className="timer-hint">Mit + und − kannst du die Dauer minutengenau anpassen.</p>
    </section>
  </div>;
}
