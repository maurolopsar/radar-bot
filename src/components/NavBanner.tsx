import { formatDistance } from '../../shared/geo';
import { formatDuration } from '../../shared/nav';
import { navActive, progress, stopNavigation } from '../services/nav';
import { sheet } from '../state/store';
import { Icon } from './ui';

/** Flecha de maniobra según tipo y dirección. */
export function ManeuverIcon({ type, modifier, exit, size = 52 }: { type: string; modifier?: string; exit?: number; size?: number }) {
  const m = modifier ?? 'straight';
  const angle: Record<string, number> = {
    uturn: 180,
    'sharp right': 135,
    right: 90,
    'slight right': 40,
    straight: 0,
    'slight left': -40,
    left: -90,
    'sharp left': -135,
  };
  if (type === 'arrive') {
    return (
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
        <path d="M24 6c-7 0-12 5-12 12 0 9 12 22 12 22s12-13 12-22c0-7-5-12-12-12z" fill="currentColor" />
        <circle cx="24" cy="18" r="5" fill="var(--nav-bg, #1d4ed8)" />
      </svg>
    );
  }
  if (/roundabout|rotary/.test(type)) {
    return (
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round">
        <circle cx="24" cy="26" r="9" />
        <path d="M24 44v-9M33 26h9M24 17V6" />
        <path d="M18 10l6-6 6 6" />
        {exit != null && (
          <text x="24" y="31" text-anchor="middle" font-size="13" font-weight="900" fill="currentColor" stroke="none">
            {exit}
          </text>
        )}
      </svg>
    );
  }
  const a = angle[m] ?? 0;
  if (m === 'uturn') {
    return (
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M30 44V18a8 8 0 00-16 0v14M8 26l6 7 6-7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M24 44V27" />
      <g transform={`rotate(${a} 24 27)`}>
        <path d="M24 27V8M15 17l9-9 9 9" />
      </g>
    </svg>
  );
}

export function NavBanner() {
  if (!navActive.value) return null;
  const p = progress.value;
  const next = p?.next;
  if (!p || !next) {
    return (
      <div class="nav-banner">
        <div class="nav-text">
          <div class="nav-instr">Calculando…</div>
        </div>
      </div>
    );
  }
  return (
    <div class="nav-banner" role="status" onClick={() => (sheet.value = 'route')}>
      <div class="nav-icon">
        <ManeuverIcon type={next.type} modifier={next.modifier} exit={next.exit} />
        <div class="nav-dist">{formatDistance(Math.max(0, p.toNext))}</div>
      </div>
      <div class="nav-text">
        <div class="nav-instr">{next.instruction}</div>
      </div>
    </div>
  );
}

/** Barra de llegada (tiempo, distancia, hora) encima del HUD. */
export function NavEta() {
  if (!navActive.value) return null;
  const p = progress.value;
  if (!p) return null;
  const eta = new Date(Date.now() + p.remainingTime * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return (
    <div class="nav-eta">
      <button class="eta-main" onClick={() => (sheet.value = 'route')}>
        <span class="eta-time">{formatDuration(p.remainingTime)}</span>
        <span class="eta-sub">
          {formatDistance(p.remaining)} · llegada {eta}
        </span>
      </button>
      <button class="icon-btn" aria-label="Terminar ruta" onClick={stopNavigation}>
        <Icon name="close" />
      </button>
    </div>
  );
}
