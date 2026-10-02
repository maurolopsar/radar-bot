// Pitidos (Web Audio), voz (speechSynthesis) y vibración.
// En iOS el audio solo se desbloquea tras un gesto del usuario: unlockAudio()
// se llama desde el botón "Iniciar".

import { settings } from '../state/settings';

let ctx: AudioContext | null = null;
let voice: SpeechSynthesisVoice | null = null;

function pickVoice(): void {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  voice =
    voices.find((v) => v.lang === 'es-ES' && /Mónica|Monica|Jorge|Google|Paulina/i.test(v.name)) ??
    voices.find((v) => v.lang === 'es-ES') ??
    voices.find((v) => v.lang.startsWith('es')) ??
    null;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export function unlockAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ctx && AC) ctx = new AC();
    void ctx?.resume();
    // Un buffer vacío "despierta" el audio en Safari.
    if (ctx) {
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch {
    // sin audio
  }
}

interface Tone {
  f: number;
  d: number;
  /** pausa tras el tono (s) */
  gap?: number;
  /** frecuencia final (barrido) */
  to?: number;
  type?: OscillatorType;
}

function play(tones: Tone[]): void {
  const s = settings.value;
  if (!s.beeps || !ctx) return;
  void ctx.resume();
  let t = ctx.currentTime + 0.02;
  for (const tone of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type ?? 'sine';
    osc.frequency.setValueAtTime(tone.f, t);
    if (tone.to) osc.frequency.linearRampToValueAtTime(tone.to, t + tone.d);
    const v = Math.max(0.001, s.volume * 0.6);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(v, t + 0.01);
    gain.gain.setValueAtTime(v, t + tone.d - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + tone.d + 0.02);
    t += tone.d + (tone.gap ?? 0.08);
  }
}

export type SoundName = 'radar' | 'radarClose' | 'overspeed' | 'passed' | 'helicopter' | 'police' | 'hazard' | 'section' | 'info';

const SOUNDS: Record<SoundName, Tone[]> = {
  radar: [
    { f: 880, d: 0.16 },
    { f: 880, d: 0.16 },
  ],
  radarClose: [
    { f: 1175, d: 0.1, gap: 0.05 },
    { f: 1175, d: 0.1, gap: 0.05 },
    { f: 1175, d: 0.1, gap: 0.05 },
  ],
  overspeed: [
    { f: 1568, d: 0.12, type: 'square', gap: 0.05 },
    { f: 1568, d: 0.12, type: 'square' },
  ],
  passed: [{ f: 523, d: 0.15 }],
  helicopter: [
    { f: 600, to: 1200, d: 0.35, type: 'triangle', gap: 0.05 },
    { f: 600, to: 1200, d: 0.35, type: 'triangle' },
  ],
  police: [
    { f: 960, d: 0.18, gap: 0.02 },
    { f: 720, d: 0.18, gap: 0.02 },
    { f: 960, d: 0.18 },
  ],
  hazard: [{ f: 660, d: 0.25, type: 'triangle' }],
  section: [
    { f: 784, d: 0.14 },
    { f: 988, d: 0.14 },
    { f: 1175, d: 0.2 },
  ],
  info: [{ f: 740, d: 0.12 }],
};

const VIBRATION: Partial<Record<SoundName, number[]>> = {
  radar: [120, 80, 120],
  radarClose: [80, 50, 80, 50, 80],
  overspeed: [300],
  helicopter: [200, 100, 200],
  police: [150, 80, 150],
};

export function beep(name: SoundName): void {
  play(SOUNDS[name]);
  const pattern = VIBRATION[name];
  if (pattern && settings.value.vibrate && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // no soportado
    }
  }
}

let lastSpoken = '';
let lastSpokenAt = 0;

export function say(text: string, opts: { interrupt?: boolean } = {}): void {
  const s = settings.value;
  if (!s.voice || !('speechSynthesis' in window)) return;
  const now = Date.now();
  if (text === lastSpoken && now - lastSpokenAt < 8000) return;
  lastSpoken = text;
  lastSpokenAt = now;
  if (opts.interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'es-ES';
  if (voice) u.voice = voice;
  u.volume = s.volume;
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

/** Distancia en palabras para la voz. */
export function spokenDistance(m: number): string {
  if (m < 1000) return `${Math.max(50, Math.round(m / 50) * 50)} metros`;
  const km = Math.round(m / 100) / 10;
  return km === 1 ? '1 kilómetro' : `${String(km).replace('.', ',')} kilómetros`;
}
