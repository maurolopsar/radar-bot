// Mantiene la pantalla encendida mientras la app está abierta (Screen Wake Lock API).

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (!wanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => (sentinel = null));
  } catch {
    // denegado (batería baja, etc.)
  }
}

export function setWakeLock(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else {
    void sentinel?.release();
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted && !sentinel) void acquire();
});

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
