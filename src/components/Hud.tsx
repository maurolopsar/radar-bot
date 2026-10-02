import { useEffect, useRef } from 'preact/hooks';
import { cardinal, formatDistance } from '../../shared/geo';
import { iconUrl } from '../map/icons';
import { RADAR_LABEL } from '../services/engine';
import { settings } from '../state/settings';
import { activeAlerts, corridors, position, radarHits, road, section, speedKmh } from '../state/store';
import { LimitSign } from './ui';

function SectionPanel() {
  const s = section.value;
  if (!s) return null;
  const remaining = formatDistance(s.remainingM);
  return (
    <div class={`section-panel${s.over ? ' over' : ''}`}>
      <div class="row">
        <span class="lbl">Tramo de velocidad media</span>
        <span class="hint">quedan {remaining}</span>
      </div>
      <div class="row">
        <span class="avg">{Math.round(s.avgKmh)} km/h</span>
        <span class="hint">
          {s.limit ? `límite ${s.limit}` : 'límite desconocido'}
          {s.targetKmh != null && s.limit && (s.targetKmh > 0 ? ` · máx. ${Math.round(Math.min(s.targetKmh, 999))} en lo que queda` : ' · ya por encima')}
        </span>
      </div>
      <div class="bar">
        <div style={{ width: `${Math.round(s.progress * 100)}%` }} />
      </div>
    </div>
  );
}

export function Hud() {
  const ref = useRef<HTMLDivElement>(null);
  const kmh = speedKmh.value;
  const r = road.value;
  const s = settings.value;
  const next = radarHits.value[0];
  // El banner superior ya muestra el radar más cercano cuando es el aviso principal.
  const showNext = next && activeAlerts.value[0]?.id !== `radar-${next.target.id}`;
  const limit = next?.target.maxspeed ?? r?.maxspeed;
  const over = kmh != null && limit != null && kmh > limit + s.overspeedTolerance;
  const p = position.value;

  // Altura del HUD para colocar botones y controles del mapa encima.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--hud-h', `${el.offsetHeight + 8}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const roadTitle = r ? [r.ref, r.name].filter(Boolean).join(' · ') || 'Vía sin nombre' : p ? 'Detectando vía…' : 'Sin posición';
  const corridor = corridors.value[0];

  return (
    <div class="hud" ref={ref}>
      <SectionPanel />
      <div class="hud-main">
        <div class={`speed${over ? ' over' : ''}`}>
          <span class="v">{kmh == null ? '–' : Math.round(kmh)}</span>
          <span class="u">km/h</span>
        </div>
        <LimitSign value={r?.maxspeed} inferred={r?.inferred} />
        <div class="road">
          <div class="name">{roadTitle}</div>
          <div class="meta">
            {corridor
              ? 'Tramo con radar móvil'
              : r?.inferred
                ? 'Límite genérico (no señalizado)'
                : p?.heading != null
                  ? `Hacia el ${cardinal(p.heading)} · ${Math.round(p.heading)}°`
                  : ' '}
          </div>
        </div>
        {showNext && (
          <div class="next" title={RADAR_LABEL[next.target.kind]}>
            <img src={iconUrl(`radar-${next.target.kind}`)} alt="" />
            <div>
              <div class="d">{formatDistance(next.distance)}</div>
              <div class="k">{next.target.maxspeed ? `${next.target.maxspeed} km/h` : RADAR_LABEL[next.target.kind]}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
