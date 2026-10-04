import { formatDistance } from '../../shared/geo';
import { GRADE_COLOR, GRADE_LABEL, type RallyProfile } from '../../shared/curves';
import {
  advice,
  bestFor,
  cancelRun,
  clock,
  formatLap,
  lapStopwatch,
  lastResult,
  liveDelta,
  pendingStart,
  records,
  removeSegment,
  renameSegment,
  resetStopwatch,
  run,
  segments,
  stopwatch,
  stopwatchMs,
  toggleStopwatch,
  addSegment,
} from '../services/rally';
import { settings, updateSettings } from '../state/settings';
import { pickMode, position, radarHits, road, sheet, showToast, speedKmh } from '../state/store';
import { Icon, Segmented, Sheet, ToggleRow } from './ui';

function CurveArrow({ dir, color }: { dir: 'left' | 'right'; color: string }) {
  return (
    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" fill="none" stroke={color} stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
      <g transform={dir === 'left' ? 'scale(-1 1) translate(-40 0)' : undefined}>
        <path d="M12 36V22a10 10 0 0110-10h8M24 4l8 8-8 8" />
      </g>
    </svg>
  );
}

const fmtDelta = (ms: number) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(1).replace('.', ',')}`;

/** Panel del modo tramo, encima del HUD. */
export function RallyPanel() {
  const s = settings.value;
  if (!s.rallyMode) return null;
  const a = advice.value;
  const kmh = speedKmh.value ?? 0;
  const r = run.value;
  const sw = stopwatch.value;
  void clock.value;
  const rec = a ? Math.round(a.recommendedKmh / 5) * 5 : null;
  const over = rec != null && kmh > a!.recommendedKmh + 5;
  const next = a?.next;
  const res = lastResult.value;
  return (
    <div class={`rally-panel${over ? ' over' : ''}`} onClick={() => (sheet.value = 'rally')}>
      <div class="rally-rec">
        <span class="lbl">Recomendada</span>
        <span class="v">{rec ?? '–'}</span>
      </div>
      {next ? (
        <div class="rally-curve">
          <CurveArrow dir={next.direction} color={GRADE_COLOR[next.grade]} />
          <div>
            <div class="t" style={{ color: GRADE_COLOR[next.grade] }}>
              {next.direction === 'left' ? 'Izq.' : 'Der.'} {GRADE_LABEL[next.grade]}
            </div>
            <div class="s">
              {formatDistance(next.distance)} · {Math.round(Math.min(next.targetKmh, road.value?.maxspeed ?? 999))} km/h
            </div>
          </div>
        </div>
      ) : (
        <div class="rally-curve s">{a ? 'Sin curvas en 1,2 km' : 'Esperando vía…'}</div>
      )}
      <div class="rally-time">
        {r ? (
          <>
            <span class="lbl">{r.segment.name}</span>
            <span class="v">{formatLap(clock.value - r.startedAt)}</span>
            {(() => {
              const d = liveDelta(r);
              return d != null ? <span class={`delta ${d < 0 ? 'good' : 'bad'}`}>{fmtDelta(d)}</span> : null;
            })()}
          </>
        ) : sw.running || sw.accumulated ? (
          <>
            <span class="lbl">Crono</span>
            <span class="v">{formatLap(stopwatchMs())}</span>
          </>
        ) : res ? (
          <>
            <span class="lbl">{res.best ? '¡Récord!' : 'Último'}</span>
            <span class="v">{formatLap(res.timeMs)}</span>
            {res.deltaMs != null && <span class={`delta ${res.deltaMs < 0 ? 'good' : 'bad'}`}>{fmtDelta(res.deltaMs)}</span>}
          </>
        ) : (
          <span class="lbl">Tramos ›</span>
        )}
      </div>
    </div>
  );
}

const PROFILES: [RallyProfile, string][] = [
  ['tranquilo', 'Tranquilo'],
  ['normal', 'Normal'],
  ['deportivo', 'Deportivo'],
  ['tope', 'Tope'],
];

export function RallySheet() {
  const s = settings.value;
  const sw = stopwatch.value;
  void clock.value;
  const p = position.value;

  const markStart = () => {
    if (!p) return showToast('Sin posición GPS');
    pendingStart.value = { lat: p.lat, lon: p.lon, heading: p.heading ?? undefined };
    showToast('Inicio marcado. Marca el final cuando llegues');
  };
  const markEnd = () => {
    const start = pendingStart.value;
    if (!p || !start) return;
    void addSegment({ name: `Tramo ${segments.value.length + 1}`, start, end: { lat: p.lat, lon: p.lon } });
    pendingStart.value = null;
    showToast('Tramo guardado');
  };

  return (
    <Sheet title="Modo tramo">
      <div class="sheet-body">
        <ToggleRow title="Modo tramo activo" sub="Curvas por colores, velocidad recomendada, avisos de curva y cronómetro" checked={s.rallyMode} onChange={(v) => updateSettings({ rallyMode: v })} />
        <div class="group">Estilo</div>
        <Segmented value={s.rallyProfile} options={PROFILES} onChange={(v) => updateSettings({ rallyProfile: v })} />
        <p class="note">
          Define la aceleración lateral admitida en curva ({ { tranquilo: '0,25 g', normal: '0,35 g', deportivo: '0,5 g', tope: '0,7 g' }[s.rallyProfile] }). La velocidad
          recomendada nunca supera el límite legal de la vía: «Tope» es para circuitos y tramos cerrados al tráfico.
        </p>
        <ToggleRow title="Cantar curvas por voz" sub="«Derecha cerrada, 60» antes de cada curva media o más fuerte" checked={s.rallyVoice} onChange={(v) => updateSettings({ rallyVoice: v })} />
        <ToggleRow title="Aviso si vas demasiado rápido para la curva" checked={s.rallyWarn} onChange={(v) => updateSettings({ rallyWarn: v })} />
        <ToggleRow title="Colorear curvas en el mapa" checked={s.showCurves} onChange={(v) => updateSettings({ showCurves: v })} />
        <div class="legend">
          {([1, 2, 3, 4, 5, 6] as const).map((g) => (
            <span key={g}>
              <i style={{ background: GRADE_COLOR[g] }} />
              {GRADE_LABEL[g]}
            </span>
          ))}
        </div>

        <div class="group">Cronómetro</div>
        <div class="row-item">
          <div class="grow">
            <div class="big-time">{formatLap(stopwatchMs())}</div>
            {sw.laps.length > 0 && <div class="s">Vueltas: {sw.laps.map((l, i) => formatLap(l - (sw.laps[i - 1] ?? 0))).join(' · ')}</div>}
          </div>
          <button class="btn primary" onClick={toggleStopwatch}>
            {sw.running ? 'Parar' : 'Iniciar'}
          </button>
          <button class="btn" onClick={sw.running ? lapStopwatch : resetStopwatch}>
            {sw.running ? 'Vuelta' : 'Reset'}
          </button>
        </div>

        <div class="group">Tramos cronometrados</div>
        <p class="note">El crono arranca solo al pasar por el inicio (círculo verde) y se para en el final (rojo). Se guardan los 10 mejores tiempos de cada tramo.</p>
        <div class="btns">
          {!pendingStart.value ? (
            <button class="btn" onClick={markStart}>
              Marcar inicio aquí
            </button>
          ) : (
            <button class="btn primary" onClick={markEnd}>
              Marcar final aquí
            </button>
          )}
          <button
            class="btn"
            onClick={() => {
              pickMode.value = 'seg-start';
              sheet.value = null;
              showToast('Toca en el mapa el inicio del tramo');
            }}
          >
            Elegir en el mapa
          </button>
          {pendingStart.value && (
            <button class="btn" onClick={() => (pendingStart.value = null)}>
              Cancelar
            </button>
          )}
        </div>
        {run.value && (
          <div class="btns">
            <button class="btn danger" onClick={cancelRun}>
              Anular pasada en curso
            </button>
          </div>
        )}
        {segments.value.length === 0 && <div class="empty">Aún no hay tramos</div>}
        {segments.value.map((seg) => {
          const best = bestFor(seg.id);
          const mine = records.value.filter((r) => r.segmentId === seg.id).sort((a, b) => a.timeMs - b.timeMs);
          return (
            <div class="segment" key={seg.id}>
              <div class="row-item">
                <div class="grow">
                  <input
                    class="seg-name"
                    value={seg.name}
                    aria-label="Nombre del tramo"
                    onChange={(e) => void renameSegment(seg.id, (e.target as HTMLInputElement).value || seg.name)}
                  />
                  <div class="s">{best ? `Récord ${formatLap(best.timeMs)} · media ${Math.round(best.avgKmh)} km/h` : 'Sin tiempos'}</div>
                </div>
                <button class="icon-btn" aria-label="Borrar tramo" onClick={() => confirm(`¿Borrar ${seg.name} y sus tiempos?`) && void removeSegment(seg.id)}>
                  <Icon name="trash" />
                </button>
              </div>
              {mine.length > 0 && (
                <ol class="times">
                  {mine.map((r) => (
                    <li key={r.id}>
                      <b>{formatLap(r.timeMs)}</b> · {new Date(r.date).toLocaleDateString('es-ES')} · máx {Math.round(r.maxKmh)} km/h
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

/** Modo radares: velocidad enorme y semitransparente sobre el mapa. */
export function SpeedOverlay() {
  const s = settings.value;
  if (!s.radarMode) return null;
  const kmh = speedKmh.value;
  // Mismo criterio que el HUD: el límite del radar cercano manda sobre el de la vía.
  const limit = radarHits.value[0]?.target.maxspeed ?? road.value?.maxspeed;
  const over = kmh != null && limit != null && kmh > limit + s.overspeedTolerance;
  return (
    <div class={`speed-overlay${over ? ' over' : ''}`} style={{ opacity: Math.max(0.12, Math.min(0.8, s.radarModeOpacity)) }} aria-hidden="true">
      <span>{kmh == null ? '–' : Math.round(kmh)}</span>
      {limit != null && <small>{limit}</small>}
    </div>
  );
}
