import { cardinal, formatDistance } from '../../shared/geo';
import { iconUrl } from '../map/icons';
import { flyTo } from '../map/MapView';
import { visibleRadarCount } from '../services/engine';
import { describeWeather } from '../services/weather';
import { settings } from '../state/settings';
import { activeAlerts, datasetState, fleet, gpsState, position, sheet, weather, type ActiveAlert } from '../state/store';
import { LimitSign } from './ui';

function GpsChip() {
  const st = gpsState.value;
  const p = position.value;
  const label =
    st === 'ok' ? `GPS ±${Math.round(p?.accuracy ?? 0)} m` : st === 'sim' ? 'Simulación' : st === 'waiting' ? 'Buscando GPS…' : st === 'denied' ? 'GPS denegado' : st === 'error' ? 'GPS no disponible' : 'GPS apagado';
  const cls = st === 'ok' ? ((p?.accuracy ?? 99) < 30 ? 'ok' : 'warn') : st === 'sim' ? 'ok' : st === 'waiting' ? 'warn' : 'bad';
  return (
    <span class={`chip${st === 'sim' ? ' sim' : ''}`}>
      <span class={`dot ${cls}`} />
      {label}
    </span>
  );
}

function DataChip() {
  const ds = datasetState.value;
  const n = visibleRadarCount.value;
  const cls = ds.loading ? 'warn' : ds.offline ? 'bad' : ds.error ? 'warn' : 'ok';
  return (
    <button class="chip" onClick={() => (sheet.value = 'sources')} title={ds.error ?? 'Fuentes de datos'}>
      <span class={`dot ${cls}`} />
      {ds.loading && !n ? 'Cargando radares…' : `${n.toLocaleString('es-ES')} radares`}
    </button>
  );
}

function FleetChip() {
  const s = settings.value;
  if (!s.aircraft || !s.fleetTracking) return null;
  const flying = fleet.value.filter((a) => !a.onGround && (a.seenPosS ?? 0) < 300);
  if (!flying.length) return null;
  return (
    <button class="chip dgt" onClick={() => (sheet.value = 'nearby')} title="Helicópteros DGT en vuelo en España">
      <img src={iconUrl('ac-dgt')} alt="" width={20} height={20} />
      DGT: {flying.length} en vuelo
    </button>
  );
}

function WeatherChip() {
  const w = weather.value;
  if (!w) return null;
  const d = describeWeather(w.code);
  return (
    <span class="chip" title={d.text}>
      {d.icon} {Math.round(w.temperature)}°
    </span>
  );
}

function AlertCard({ a }: { a: ActiveAlert }) {
  return (
    <div class={`alert ${a.severity}${a.stage === 'close' ? ' close' : ''}`} role="alert" onClick={() => a.lat != null && flyTo(a.lat, a.lon!, 15)}>
      <img src={iconUrl(a.icon)} alt="" />
      <div class="txt">
        <div class="title">{a.title}</div>
        {a.subtitle && <div class="sub">{a.subtitle}</div>}
      </div>
      {a.limit != null && <LimitSign value={a.limit} small />}
      {a.distance != null && (
        <div class="dist">
          {formatDistance(a.distance)}
          <small>{a.stage === 'close' ? '¡muy cerca!' : a.kind === 'aircraft' && a.bearing != null ? `al ${cardinal(a.bearing)}` : 'por delante'}</small>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const alerts = activeAlerts.value;
  const [first, ...rest] = alerts;
  return (
    <div class="top">
      <div class="chips">
        <GpsChip />
        <DataChip />
        <FleetChip />
        <WeatherChip />
      </div>
      {first && <AlertCard a={first} />}
      {rest.length > 0 && (
        <div class="more-alerts">
          {rest.slice(0, 6).map((a) => (
            <button class="mini-alert" key={a.id} onClick={() => a.lat != null && flyTo(a.lat, a.lon!, 15)}>
              <img src={iconUrl(a.icon)} alt="" />
              {a.title}
              {a.distance != null && ` · ${formatDistance(a.distance)}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
