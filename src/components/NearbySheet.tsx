import { useState } from 'preact/hooks';
import { bearingDeg, cardinal, distanceM, formatDistance, ftToM, ktToKmh } from '../../shared/geo';
import type { Aircraft } from '../../shared/types';
import { iconUrl } from '../map/icons';
import { flyTo } from '../map/MapView';
import { poke } from '../services/data';
import { allRadars, RADAR_LABEL, REPORT_LABEL } from '../services/engine';
import { describeWeather, drivingWarnings } from '../services/weather';
import { setLayer, settings } from '../state/settings';
import { aircraft, aircraftInfo, events, fleet, fleetInfo, fuel, position, reports, selected, sheet, trip, weather } from '../state/store';
import { Sheet, timeAgo } from './ui';

type Tab = 'radars' | 'aircraft' | 'events' | 'fuel' | 'trip';

function useDistance() {
  const p = position.value;
  return (lat: number, lon: number) => (p ? distanceM(p.lat, p.lon, lat, lon) : Infinity);
}

function go(type: string, id: string, lat: number, lon: number) {
  selected.value = { type, data: { id } };
  sheet.value = null;
  flyTo(lat, lon, 15);
}

function RadarsTab() {
  const dist = useDistance();
  const list = allRadars.value
    .map((r) => ({ r, d: dist(r.lat, r.lon) }))
    .filter((x) => x.d < 30_000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 60);
  if (!position.value) return <div class="empty">Esperando posición GPS…</div>;
  if (!list.length) return <div class="empty">No hay radares en 30 km</div>;
  return (
    <>
      {list.map(({ r, d }) => (
        <button class="row-item" key={r.id} onClick={() => go('radars', r.id, r.lat, r.lon)}>
          <img src={iconUrl(`radar-${r.kind}${r.maxspeed ? `-${r.maxspeed}` : ''}`)} alt="" />
          <div class="grow">
            <div class="t">{RADAR_LABEL[r.kind]}</div>
            <div class="s">{[r.road, r.pk != null ? `km ${r.pk.toFixed(1)}` : null, r.direction ? `sentido ${r.direction}` : null, !r.road ? r.name : null].filter(Boolean).join(' · ')}</div>
          </div>
          <span class="num">{formatDistance(d)}</span>
        </button>
      ))}
    </>
  );
}

function AircraftRow({ a, d, bearing }: { a: Aircraft; d: number; bearing?: number }) {
  return (
    <button class="row-item" onClick={() => go('aircraft', a.hex, a.lat, a.lon)}>
      <img src={iconUrl(a.isDgt ? 'ac-dgt' : a.isHeli ? (a.tag === 'Guardia Civil' || a.tag === 'Policía' ? 'ac-police' : 'ac-heli') : 'ac-plane')} alt="" />
      <div class="grow">
        <div class="t">
          {a.isDgt ? 'DGT · ' : a.tag ? `${a.tag} · ` : ''}
          {a.reg ?? a.callsign ?? a.hex.toUpperCase()}
        </div>
        <div class="s">
          {[a.desc ?? a.type, a.onGround ? 'en tierra' : a.altFt != null ? `${Math.round(ftToM(a.altFt))} m` : null, a.gsKt != null ? `${Math.round(ktToKmh(a.gsKt))} km/h` : null, a.seenPosS != null ? `hace ${Math.round(a.seenPosS)} s` : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <span class="num">
        {Number.isFinite(d) ? formatDistance(d) : ''}
        {bearing != null && Number.isFinite(d) ? ` ${cardinal(bearing)}` : ''}
      </span>
    </button>
  );
}

function AircraftTab() {
  const p = position.value;
  const s = settings.value;
  const dist = useDistance();
  const near = aircraft.value
    .filter((a) => a.isHeli || a.isDgt || s.showAllAircraft)
    .map((a) => ({ a, d: dist(a.lat, a.lon) }))
    .sort((x, y) => Number(y.a.isDgt) - Number(x.a.isDgt) || x.d - y.d);
  const fl = fleet.value.map((a) => ({ a, d: dist(a.lat, a.lon) })).sort((x, y) => x.d - y.d);
  if (!s.aircraft) return <div class="empty">La vigilancia de aeronaves está desactivada en Ajustes.</div>;
  return (
    <>
      <div class="group">Flota DGT en vuelo (toda España)</div>
      {fl.length ? (
        fl.map(({ a, d }) => <AircraftRow key={a.hex} a={a} d={d} bearing={p ? bearingDeg(p.lat, p.lon, a.lat, a.lon) : undefined} />)
      ) : (
        <div class="empty">{fleetInfo.value.error ? `Sin datos: ${fleetInfo.value.error}` : 'Ningún helicóptero DGT detectado ahora mismo'}</div>
      )}
      <div class="group">Helicópteros cerca de ti</div>
      {near.length ? (
        near.slice(0, 40).map(({ a, d }) => <AircraftRow key={a.hex} a={a} d={d} bearing={p ? bearingDeg(p.lat, p.lon, a.lat, a.lon) : undefined} />)
      ) : (
        <div class="empty">{aircraftInfo.value.error ? `Sin datos: ${aircraftInfo.value.error}` : 'Ninguno en la zona'}</div>
      )}
      <p class="note">
        Fuente: {aircraftInfo.value.provider ?? '—'} {aircraftInfo.value.fetchedAt ? `(${timeAgo(aircraftInfo.value.fetchedAt)})` : ''}. Los helicópteros solo aparecen si emiten
        ADS-B o son localizados por MLAT; a baja altura o en zonas sin receptores pueden no verse.
      </p>
    </>
  );
}

function EventsTab() {
  const dist = useDistance();
  const all = [
    ...events.value.map((e) => ({ id: e.id, type: 'events', icon: `ev-${e.category}`, title: e.description ?? e.category, sub: [e.source === 'waze' ? 'Waze' : 'DGT', e.road, e.town, timeAgo(e.startedAt)].filter(Boolean).join(' · '), lat: e.lat, lon: e.lon })),
    ...reports.value.map((r) => ({ id: r.id, type: 'reports', icon: `rep-${r.kind}`, title: `${REPORT_LABEL[r.kind]} (propio)`, sub: [r.note, timeAgo(r.createdAt)].filter(Boolean).join(' · '), lat: r.lat, lon: r.lon })),
  ]
    .map((x) => ({ ...x, d: dist(x.lat, x.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 80);
  if (!all.length) return <div class="empty">Sin incidencias en la zona</div>;
  return (
    <>
      {all.map((x) => (
        <button class="row-item" key={x.id} onClick={() => go(x.type, x.id, x.lat, x.lon)}>
          <img src={iconUrl(x.icon)} alt="" />
          <div class="grow">
            <div class="t">{x.title}</div>
            <div class="s">{x.sub}</div>
          </div>
          <span class="num">{Number.isFinite(x.d) ? formatDistance(x.d) : ''}</span>
        </button>
      ))}
    </>
  );
}

function FuelTab() {
  const s = settings.value;
  const dist = useDistance();
  if (!s.layers.fuel) {
    return (
      <div class="empty">
        <p>Activa la capa de gasolineras para ver precios.</p>
        <button
          class="btn primary"
          onClick={() => {
            setLayer('fuel', true);
            poke('fuel');
          }}
        >
          Activar gasolineras
        </button>
      </div>
    );
  }
  const type = s.fuelType;
  const list = fuel.value
    .filter((f) => f.prices[type] != null)
    .map((f) => ({ f, d: dist(f.lat, f.lon) }))
    .filter((x) => x.d < 15_000)
    .sort((a, b) => a.f.prices[type]! - b.f.prices[type]! || a.d - b.d)
    .slice(0, 40);
  if (!list.length) return <div class="empty">Cargando precios…</div>;
  return (
    <>
      <p class="note">Las más baratas en 15 km.</p>
      {list.map(({ f, d }) => (
        <button class="row-item" key={f.id} onClick={() => go('fuel', f.id, f.lat, f.lon)}>
          <div class="grow">
            <div class="t">{f.name}</div>
            <div class="s">
              {f.town} · {formatDistance(d)}
            </div>
          </div>
          <span class="num">{f.prices[type]!.toFixed(3).replace('.', ',')} €</span>
        </button>
      ))}
    </>
  );
}

function TripTab() {
  const t = trip.value;
  const w = weather.value;
  const hours = t.movingS / 3600;
  const avg = hours > 0 ? t.distanceM / 1000 / hours : 0;
  const fmtDur = (s: number) => `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return (
    <>
      {w && (
        <>
          <div class="group">Tiempo ahora</div>
          <div class="row-item">
            <span style={{ fontSize: '32px' }}>{describeWeather(w.code).icon}</span>
            <div class="grow">
              <div class="t">
                {describeWeather(w.code).text} · {Math.round(w.temperature)}°C
              </div>
              <div class="s">
                Viento {Math.round(w.wind)} km/h{w.gusts ? ` (rachas ${Math.round(w.gusts)})` : ''}
                {w.visibility != null ? ` · visibilidad ${formatDistance(w.visibility)}` : ''}
                {w.precipitation ? ` · ${w.precipitation} mm` : ''}
              </div>
            </div>
          </div>
          {drivingWarnings(w).map((txt) => (
            <div class="row-item" key={txt}>
              <span>⚠️</span>
              <div class="grow t">{txt}</div>
            </div>
          ))}
        </>
      )}
      <div class="group">Viaje actual</div>
      <div class="row-item">
        <div class="grow t">Distancia</div>
        <span class="num">{(t.distanceM / 1000).toFixed(1).replace('.', ',')} km</span>
      </div>
      <div class="row-item">
        <div class="grow t">Tiempo en movimiento</div>
        <span class="num">{fmtDur(t.movingS)}</span>
      </div>
      <div class="row-item">
        <div class="grow t">Velocidad media</div>
        <span class="num">{Math.round(avg)} km/h</span>
      </div>
      <div class="row-item">
        <div class="grow t">Velocidad máxima</div>
        <span class="num">{Math.round(t.maxKmh)} km/h</span>
      </div>
      <div class="row-item">
        <div class="grow t">Radares superados</div>
        <span class="num">{t.radarsPassed}</span>
      </div>
      <div class="btns">
        <button class="btn" onClick={() => (trip.value = { startedAt: Date.now(), distanceM: 0, maxKmh: 0, movingS: 0, radarsPassed: 0 })}>
          Reiniciar viaje
        </button>
      </div>
    </>
  );
}

export function NearbySheet() {
  const [tab, setTab] = useState<Tab>('radars');
  const tabs: [Tab, string][] = [
    ['radars', 'Radares'],
    ['aircraft', 'Helicópteros'],
    ['events', 'Incidencias'],
    ['fuel', 'Gasolineras'],
    ['trip', 'Tiempo y viaje'],
  ];
  return (
    <Sheet title="Cerca de mí">
      <nav class="tabs">
        {tabs.map(([k, label]) => (
          <button class={k === tab ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      <div class="sheet-body">
        {tab === 'radars' && <RadarsTab />}
        {tab === 'aircraft' && <AircraftTab />}
        {tab === 'events' && <EventsTab />}
        {tab === 'fuel' && <FuelTab />}
        {tab === 'trip' && <TripTab />}
      </div>
    </Sheet>
  );
}
