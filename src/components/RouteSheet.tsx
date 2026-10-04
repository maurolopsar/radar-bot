import { useEffect, useRef, useState } from 'preact/hooks';
import { distanceM, formatDistance } from '../../shared/geo';
import type { Place } from '../../shared/geocode';
import { formatDuration } from '../../shared/nav';
import { recenter } from '../map/MapView';
import { unlockAudio } from '../services/audio';
import { startSim } from '../services/geolocation';
import {
  activeRoute,
  clearRoute,
  destination,
  favorites,
  navActive,
  planning,
  planRoutes,
  recents,
  routes,
  searchPlaces,
  selectedRoute,
  setFavorite,
  startNavigation,
  stops,
} from '../services/nav';
import { settings, updateSettings } from '../state/settings';
import { position, sheet, showToast, simActive, simRoute, started } from '../state/store';
import { Icon, Sheet, ToggleRow } from './ui';

type Target = 'destination' | 'stop';

function PlaceRow({ p, onPick, extra }: { p: Place; onPick: (p: Place) => void; extra?: preact.ComponentChildren }) {
  const me = position.value;
  return (
    <div class="row-item">
      <button class="grow" style={{ textAlign: 'left' }} onClick={() => onPick(p)}>
        <div class="t">{p.name}</div>
        <div class="s">{p.detail}</div>
      </button>
      {me && <span class="num s">{formatDistance(distanceM(me.lat, me.lon, p.lat, p.lon))}</span>}
      {extra}
    </div>
  );
}

export function RouteSheet() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<Target>(destination.value ? 'stop' : 'destination');
  const [editing, setEditing] = useState(!destination.value);
  const input = useRef<HTMLInputElement>(null);
  const s = settings.value;

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 3) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchPlaces(text));
      } catch (err) {
        showToast((err as Error).message);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [q]);

  const pick = (p: Place) => {
    if (target === 'stop' && destination.value) stops.value = [...stops.value, p];
    else destination.value = p;
    setQ('');
    setResults([]);
    setEditing(false);
    void planRoutes();
  };

  const start = () => {
    unlockAudio();
    started.value = true;
    startNavigation();
    recenter();
    sheet.value = null;
  };

  const simulate = () => {
    const r = activeRoute.value;
    if (!r) return;
    unlockAudio();
    started.value = true;
    startNavigation();
    simRoute.value = r.coords;
    simActive.value = true;
    startSim({ coords: r.coords, speeds: r.speeds, lengthM: r.distance }, s.simSpeedFactor, () => {
      simActive.value = false;
      simRoute.value = null;
    });
    recenter();
    sheet.value = null;
  };

  const dest = destination.value;
  const plan = planning.value;
  const fav = favorites.value;

  return (
    <Sheet title={navActive.value ? 'Ruta en curso' : 'Ir a…'}>
      <div class="sheet-body">
        {(editing || !dest) && (
          <>
            <input
              ref={input}
              type="text"
              class="search"
              placeholder={target === 'stop' ? 'Añadir parada: dirección, lugar…' : '¿A dónde vamos?'}
              value={q}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
              autocomplete="off"
              enterkeyhint="search"
            />
            {searching && <div class="note">Buscando…</div>}
            {results.map((p) => (
              <PlaceRow key={p.id} p={p} onPick={pick} />
            ))}
            {!q && (
              <>
                <div class="group">Favoritos</div>
                {(['home', 'work'] as const).map((k) => {
                  const p = fav[k];
                  return (
                    <div class="row-item" key={k}>
                      <span style={{ fontSize: '22px' }}>{k === 'home' ? '🏠' : '💼'}</span>
                      <button class="grow" style={{ textAlign: 'left' }} disabled={!p} onClick={() => p && pick(p)}>
                        <div class="t">{k === 'home' ? 'Casa' : 'Trabajo'}</div>
                        <div class="s">{p ? p.name : 'Sin guardar: elige un destino y pulsa «Guardar como…»'}</div>
                      </button>
                    </div>
                  );
                })}
                {recents.value.length > 0 && <div class="group">Recientes</div>}
                {recents.value.map((p) => (
                  <PlaceRow key={p.id} p={p} onPick={pick} />
                ))}
                <p class="note">También puedes mantener pulsado el mapa y elegir «Ir aquí», o escribir coordenadas («40.41, -3.70»).</p>
              </>
            )}
          </>
        )}

        {dest && !editing && (
          <>
            <div class="group">Itinerario</div>
            <div class="row-item">
              <span class="stop-dot origin" />
              <div class="grow t">Mi ubicación</div>
            </div>
            {stops.value.map((p, i) => (
              <div class="row-item" key={p.id + i}>
                <span class="stop-dot">{i + 1}</span>
                <div class="grow">
                  <div class="t">{p.name}</div>
                  <div class="s">{p.detail}</div>
                </div>
                <button
                  class="icon-btn"
                  aria-label="Quitar parada"
                  onClick={() => {
                    stops.value = stops.value.filter((_, j) => j !== i);
                    void planRoutes();
                  }}
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
            <div class="row-item">
              <span class="stop-dot dest" />
              <div class="grow">
                <div class="t">{dest.name}</div>
                <div class="s">{dest.detail}</div>
              </div>
            </div>
            <div class="btns">
              <button
                class="btn"
                onClick={() => {
                  setTarget('stop');
                  setEditing(true);
                }}
              >
                <Icon name="plus" size={18} /> Parada
              </button>
              <button
                class="btn"
                onClick={() => {
                  setTarget('destination');
                  setEditing(true);
                }}
              >
                Cambiar destino
              </button>
              <button class="btn" onClick={() => void setFavorite('home', dest).then(() => showToast('Guardado como Casa'))}>
                🏠 Guardar como casa
              </button>
              <button class="btn" onClick={() => void setFavorite('work', dest).then(() => showToast('Guardado como Trabajo'))}>
                💼 Trabajo
              </button>
            </div>

            <div class="group">Opciones</div>
            <ToggleRow title="Evitar peajes" checked={s.avoidTolls} onChange={(v) => { updateSettings({ avoidTolls: v }); void planRoutes(); }} />
            <ToggleRow title="Evitar autopistas y autovías" checked={s.avoidMotorways} onChange={(v) => { updateSettings({ avoidMotorways: v }); void planRoutes(); }} />

            <div class="group">Rutas {stops.value.length ? '' : '(con alternativas)'}</div>
            {plan.loading && <div class="note">Calculando rutas…</div>}
            {plan.error && <div class="note" style={{ color: 'var(--danger)' }}>{plan.error}</div>}
            {routes.value.map((r, i) => {
              const best = routes.value.reduce((a, b) => (b.duration < a.duration ? b : a));
              return (
                <button key={i} class={`route-card${i === selectedRoute.value ? ' on' : ''}`} onClick={() => (selectedRoute.value = i)}>
                  <div class="rc-main">
                    <span class="rc-time">{formatDuration(r.duration)}</span>
                    <span class="rc-dist">{formatDistance(r.distance)}</span>
                    {r === best && routes.value.length > 1 && <span class="tag ok">Más rápida</span>}
                  </div>
                  <div class="s">
                    por {r.summary || '—'} · {r.radarCount} radar{r.radarCount === 1 ? '' : 'es'}
                    {r !== best ? ` · +${formatDuration(r.duration - best.duration)}` : ''}
                  </div>
                </button>
              );
            })}
            <div class="btns">
              {!navActive.value ? (
                <button class="btn primary block" disabled={!activeRoute.value} onClick={start}>
                  <Icon name="navigate" size={18} /> Iniciar
                </button>
              ) : (
                <button class="btn primary block" onClick={() => (sheet.value = null)}>
                  Volver al mapa
                </button>
              )}
              <button class="btn" disabled={!activeRoute.value} onClick={simulate}>
                <Icon name="play" size={18} /> Simular
              </button>
              <button
                class="btn danger"
                onClick={() => {
                  clearRoute();
                  setEditing(true);
                  setTarget('destination');
                }}
              >
                Borrar ruta
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
