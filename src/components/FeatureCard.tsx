import { useState } from 'preact/hooks';
import { bearingDeg, cardinal, distanceM, formatDistance, ftToM, ktToKmh } from '../../shared/geo';
import type { Aircraft } from '../../shared/types';
import { iconUrl } from '../map/icons';
import { removeReport } from '../services/data';
import { allRadars, RADAR_LABEL, REPORT_LABEL } from '../services/engine';
import { aircraft, cameras, dataset, events, fleet, fuel, position, reports, selected } from '../state/store';
import { Icon, timeAgo } from './ui';

const SOURCE_LABEL: Record<string, string> = {
  dgt: 'DGT',
  dgt_invive: 'DGT (INVIVE)',
  sct: 'Servei Català de Trànsit',
  madrid: 'Ayto. Madrid',
  osm: 'OpenStreetMap',
};

export function sourceLabel(s: string): string {
  if (s.startsWith('feed:')) return `Radares Anunciados (${s.slice(5)})`;
  if (s.startsWith('import:')) return `Importado (${s.slice(7)})`;
  return SOURCE_LABEL[s] ?? s;
}

const FUEL_LABEL: Record<string, string> = { g95: 'Gasolina 95', g98: 'Gasolina 98', diesel: 'Diésel', dieselPlus: 'Diésel+', glp: 'GLP' };

function DistanceLine({ lat, lon }: { lat: number; lon: number }) {
  const p = position.value;
  if (!p) return null;
  const d = distanceM(p.lat, p.lon, lat, lon);
  return (
    <>
      <dt>Distancia</dt>
      <dd>
        {formatDistance(d)} al {cardinal(bearingDeg(p.lat, p.lon, lat, lon))}
      </dd>
    </>
  );
}

function navLink(lat: number, lon: number): string {
  const ios = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
  return ios ? `https://maps.apple.com/?daddr=${lat},${lon}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

function AircraftDetail({ a }: { a: Aircraft }) {
  return (
    <>
      <div class="card-head">
        <img src={iconUrl(a.isDgt ? 'ac-dgt' : a.isHeli ? 'ac-heli' : 'ac-plane')} alt="" />
        <div class="grow">
          <h3>{a.isDgt ? 'Helicóptero DGT (Pegasus)' : a.tag ? `${a.isHeli ? 'Helicóptero' : 'Aeronave'} · ${a.tag}` : a.isHeli ? 'Helicóptero' : 'Aeronave'}</h3>
          <div class="s">{[a.reg, a.callsign, a.desc ?? a.type].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <dl class="kv">
        <DistanceLine lat={a.lat} lon={a.lon} />
        <dt>Altitud</dt>
        <dd>{a.onGround ? 'En tierra' : a.altFt != null ? `${Math.round(ftToM(a.altFt))} m (${a.altFt} ft)` : '—'}</dd>
        <dt>Velocidad</dt>
        <dd>{a.gsKt != null ? `${Math.round(ktToKmh(a.gsKt))} km/h` : '—'}</dd>
        <dt>Rumbo</dt>
        <dd>{a.track != null ? `${Math.round(a.track)}° (${cardinal(a.track)})` : '—'}</dd>
        {a.operator && (
          <>
            <dt>Operador</dt>
            <dd>{a.operator}</dd>
          </>
        )}
        <dt>Señal</dt>
        <dd>
          {a.mlat ? 'MLAT' : 'ADS-B'} · {a.seenPosS != null ? `hace ${Math.round(a.seenPosS)} s` : '—'} · {a.source}
        </dd>
        <dt>ICAO</dt>
        <dd>{a.hex.toUpperCase()}</dd>
      </dl>
      <div class="btns">
        <a class="btn" href={`https://globe.adsb.lol/?icao=${a.hex}`} target="_blank" rel="noreferrer">
          <Icon name="external" size={18} /> adsb.lol
        </a>
        {a.reg && (
          <a class="btn" href={`https://www.flightradar24.com/data/aircraft/${a.reg.toLowerCase()}`} target="_blank" rel="noreferrer">
            <Icon name="external" size={18} /> FR24
          </a>
        )}
      </div>
    </>
  );
}

function CameraImage({ src }: { src: string }) {
  const [stamp, setStamp] = useState(Date.now());
  const [failed, setFailed] = useState(false);
  return (
    <>
      {failed ? (
        <div class="empty">Imagen no disponible</div>
      ) : (
        <img class="cam-img" src={`${src}?t=${stamp}`} alt="Cámara de tráfico" onError={() => setFailed(true)} referrerpolicy="no-referrer" />
      )}
      <div class="btns">
        <button
          class="btn"
          onClick={() => {
            setFailed(false);
            setStamp(Date.now());
          }}
        >
          <Icon name="refresh" size={18} /> Actualizar
        </button>
      </div>
    </>
  );
}

export function FeatureCard() {
  const sel = selected.value;
  if (!sel) return null;
  const props = sel.data as Record<string, unknown>;
  const id = String(props.id ?? '');
  let body = null;

  if (sel.type === 'radars') {
    const r = allRadars.value.find((x) => x.id === id);
    if (r) {
      body = (
        <>
          <div class="card-head">
            <img src={iconUrl(`radar-${r.kind}${r.maxspeed ? `-${r.maxspeed}` : ''}`)} alt="" />
            <div class="grow">
              <h3>{RADAR_LABEL[r.kind]}</h3>
              <div class="s">{r.name}</div>
            </div>
          </div>
          <dl class="kv">
            <DistanceLine lat={r.lat} lon={r.lon} />
            <dt>Límite</dt>
            <dd>{r.maxspeed ? `${r.maxspeed} km/h` : 'Desconocido'}</dd>
            {r.road && (
              <>
                <dt>Vía</dt>
                <dd>
                  {r.road}
                  {r.pk != null ? ` · km ${r.pk.toFixed(1).replace('.', ',')}` : ''}
                </dd>
              </>
            )}
            {r.direction && (
              <>
                <dt>Sentido</dt>
                <dd>{r.direction}</dd>
              </>
            )}
            {r.heading != null && (
              <>
                <dt>Controla</dt>
                <dd>tráfico hacia el {cardinal(r.heading)}</dd>
              </>
            )}
            {(r.validFrom || r.validTo) && (
              <>
                <dt>Válido</dt>
                <dd>
                  {r.validFrom ?? '…'} → {r.validTo ?? '…'}
                </dd>
              </>
            )}
            <dt>Fuentes</dt>
            <dd>{r.sources.map(sourceLabel).join(', ')}</dd>
          </dl>
        </>
      );
    }
  } else if (sel.type === 'aircraft') {
    const a = [...fleet.value, ...aircraft.value].find((x) => x.hex === id);
    if (a) body = <AircraftDetail a={a} />;
  } else if (sel.type === 'events') {
    const e = events.value.find((x) => x.id === id);
    if (e) {
      body = (
        <>
          <div class="card-head">
            <img src={iconUrl(`ev-${e.category}`)} alt="" />
            <div class="grow">
              <h3>{e.description}</h3>
              <div class="s">{[e.road, e.pk != null ? `km ${e.pk}` : null, e.town].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
          <dl class="kv">
            <DistanceLine lat={e.lat} lon={e.lon} />
            <dt>Fuente</dt>
            <dd>{e.source === 'waze' ? 'Waze (usuarios)' : e.category === 'v16' ? 'DGT 3.0 (baliza V16)' : 'DGT'}</dd>
            {e.startedAt && (
              <>
                <dt>Desde</dt>
                <dd>{timeAgo(e.startedAt)}</dd>
              </>
            )}
            {e.reliability != null && (
              <>
                <dt>Fiabilidad</dt>
                <dd>
                  {e.reliability}/10{e.thumbsUp ? ` · 👍 ${e.thumbsUp}` : ''}
                </dd>
              </>
            )}
            {e.severity && (
              <>
                <dt>Gravedad</dt>
                <dd>{{ low: 'Baja', medium: 'Media', high: 'Alta', highest: 'Muy alta' }[e.severity]}</dd>
              </>
            )}
            {e.direction && (
              <>
                <dt>Sentido</dt>
                <dd>{{ positive: 'Creciente', negative: 'Decreciente', both: 'Ambos' }[e.direction] ?? e.direction}</dd>
              </>
            )}
          </dl>
        </>
      );
    }
  } else if (sel.type === 'reports') {
    const r = reports.value.find((x) => x.id === id);
    if (r) {
      body = (
        <>
          <div class="card-head">
            <img src={iconUrl(`rep-${r.kind}`)} alt="" />
            <div class="grow">
              <h3>{REPORT_LABEL[r.kind]}</h3>
              <div class="s">Aviso propio · {timeAgo(r.createdAt)}</div>
            </div>
          </div>
          <dl class="kv">
            <DistanceLine lat={r.lat} lon={r.lon} />
            {r.note && (
              <>
                <dt>Nota</dt>
                <dd>{r.note}</dd>
              </>
            )}
            <dt>Caduca</dt>
            <dd>{r.expiresAt ? new Date(r.expiresAt).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'}</dd>
          </dl>
          <div class="btns">
            <button
              class="btn danger"
              onClick={() => {
                void removeReport(r.id);
                selected.value = null;
              }}
            >
              <Icon name="trash" size={18} /> Borrar aviso
            </button>
          </div>
        </>
      );
    }
  } else if (sel.type === 'fuel') {
    const f = fuel.value.find((x) => x.id === id);
    if (f) {
      body = (
        <>
          <div class="card-head">
            <div class="grow">
              <h3>{f.name}</h3>
              <div class="s">{[f.address, f.town].filter(Boolean).join(', ')}</div>
            </div>
          </div>
          <dl class="kv">
            <DistanceLine lat={f.lat} lon={f.lon} />
            {Object.entries(f.prices).map(([k, v]) => (
              <>
                <dt>{FUEL_LABEL[k] ?? k}</dt>
                <dd>{v!.toFixed(3).replace('.', ',')} €/l</dd>
              </>
            ))}
            {f.schedule && (
              <>
                <dt>Horario</dt>
                <dd>{f.schedule}</dd>
              </>
            )}
          </dl>
          <div class="btns">
            <a class="btn primary" href={navLink(f.lat, f.lon)} target="_blank" rel="noreferrer">
              <Icon name="route" size={18} /> Cómo llegar
            </a>
          </div>
        </>
      );
    }
  } else if (sel.type === 'cameras') {
    const c = cameras.value.find((x) => x.id === id);
    if (c) {
      body = (
        <>
          <div class="card-head">
            <img src={iconUrl('cam')} alt="" />
            <div class="grow">
              <h3>Cámara de tráfico DGT</h3>
              <div class="s">{c.name}</div>
            </div>
          </div>
          <CameraImage src={c.image} />
        </>
      );
    }
  } else if (sel.type === 'stretches') {
    const s = dataset.value?.stretches.find((x) => x.id === id);
    if (s) {
      body = (
        <>
          <div class="card-head">
            <img src={iconUrl(s.kind === 'section' ? 'radar-section' : 'radar-mobile')} alt="" />
            <div class="grow">
              <h3>{s.kind === 'section' ? 'Tramo de velocidad media' : 'Tramo con radar móvil'}</h3>
              <div class="s">{s.name}</div>
            </div>
          </div>
          <dl class="kv">
            {s.road && (
              <>
                <dt>Vía</dt>
                <dd>{s.road}</dd>
              </>
            )}
            {s.kmFrom != null && (
              <>
                <dt>Kilómetros</dt>
                <dd>
                  {s.kmFrom} – {s.kmTo}
                </dd>
              </>
            )}
            <dt>Límite</dt>
            <dd>{s.maxspeed ? `${s.maxspeed} km/h` : 'Ver señalización'}</dd>
            <dt>Fuentes</dt>
            <dd>{s.sources.map(sourceLabel).join(', ')}</dd>
          </dl>
          {s.kind === 'mobile_stretch' && <p class="note">La DGT publica los tramos donde opera radares móviles; no indica cuándo están activos.</p>}
        </>
      );
    }
  }

  if (!body) return null;
  return (
    <div class="card">
      <button class="icon-btn" style={{ float: 'right', marginTop: 0 }} onClick={() => (selected.value = null)} aria-label="Cerrar">
        <Icon name="close" />
      </button>
      {body}
    </div>
  );
}
