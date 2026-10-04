import type { ComponentChildren } from 'preact';
import { sheet } from '../state/store';

const PATHS: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  speed: 'M12 14l4-4M4 18a9 9 0 1116 0',
  curve: 'M5 20c0-8 4-12 14-14M15 3l4 3-3 4',
  locate: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 7a5 5 0 100 10 5 5 0 000-10z',
  navigate: 'M12 2l7 19-7-4-7 4z',
  north: 'M12 3l5 13-5-3-5 3zM9 21h6',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  plus: 'M12 5v14M5 12h14',
  menu: 'M4 7h16M4 12h16M4 17h16',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM6 15V9a4 4 0 014-4h2M18 9v6a4 4 0 01-4 4h-2',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  volume: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14',
  mute: 'M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
};

export function Icon({ name, size = 24 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label class="switch">
      <input type="checkbox" checked={checked} aria-label={label} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span />
    </label>
  );
}

export function ToggleRow({ title, sub, checked, onChange, icon }: { title: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; icon?: string }) {
  return (
    <div class="row-item">
      {icon && <img src={icon} alt="" />}
      <div class="grow">
        <div class="t">{title}</div>
        {sub && <div class="s">{sub}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function Row({ title, sub, children }: { title: string; sub?: string; children?: ComponentChildren }) {
  return (
    <div class="row-item">
      <div class="grow">
        <div class="t">{title}</div>
        {sub && <div class="s">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button type="button" role="radio" aria-checked={v === value} class={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ title, children, actions }: { title: string; children: ComponentChildren; actions?: ComponentChildren }) {
  const close = () => (sheet.value = null);
  return (
    <>
      <div class="backdrop" onClick={close} />
      <section class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header class="sheet-head">
          <h2>{title}</h2>
          {actions}
          <button class="icon-btn" onClick={close} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </>
  );
}

export function LimitSign({ value, small, inferred }: { value?: number | null; small?: boolean; inferred?: boolean }) {
  return (
    <div class={`limit${small ? ' small' : ''}${inferred ? ' inferred' : ''}${value == null ? ' unknown' : ''}`} title={inferred ? 'Límite genérico por tipo de vía' : 'Límite de velocidad'}>
      {value ?? '–'}
    </div>
  );
}

export function timeAgo(iso?: string): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
