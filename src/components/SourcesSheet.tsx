import { refreshRadars } from '../services/data';
import { aircraftInfo, dataset, datasetState, eventSources, fleetInfo } from '../state/store';
import { Icon, Sheet, timeAgo } from './ui';

export function SourcesSheet() {
  const ds = dataset.value;
  const st = datasetState.value;
  return (
    <Sheet
      title="Fuentes de datos"
      actions={
        <button class="icon-btn" aria-label="Actualizar" onClick={() => void refreshRadars(true)}>
          <Icon name="refresh" />
        </button>
      }
    >
      <div class="sheet-body">
        <p class="note">
          {st.loading ? 'Actualizando… ' : ''}
          {st.source === 'server' ? 'Datos del servidor' : st.source === 'direct' ? 'Modo directo (sin servidor)' : st.source === 'cache' ? 'Copia guardada en el dispositivo' : ''}
          {ds ? ` · generado ${timeAgo(ds.generatedAt)} · ${ds.radars.length.toLocaleString('es-ES')} radares y ${ds.stretches.length.toLocaleString('es-ES')} tramos` : ''}
          {st.error ? ` · ${st.error}` : ''}
        </p>
        <div class="group">Radares</div>
        {(ds?.sources ?? []).map((s) => (
          <div class="row-item" key={s.key}>
            <span class={`dot ${s.ok ? 'ok' : s.stale ? 'warn' : 'bad'}`} style={{ width: '10px', height: '10px', borderRadius: '50%', background: s.ok ? 'var(--ok)' : s.stale ? 'var(--warning-bg)' : 'var(--danger)' }} />
            <div class="grow">
              <div class="t">{s.label}</div>
              <div class="s">
                {s.count.toLocaleString('es-ES')} elementos{s.updatedAt ? ` · ${timeAgo(s.updatedAt)}` : ''}
                {s.error ? ` · ${s.error}` : ''}
              </div>
            </div>
          </div>
        ))}
        {!ds && <div class="empty">Sin datos todavía</div>}
        <div class="group">Tiempo real</div>
        {eventSources.value.map((s) => (
          <div class="row-item" key={s.key}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: s.ok ? 'var(--ok)' : 'var(--danger)' }} />
            <div class="grow">
              <div class="t">{s.label}</div>
              <div class="s">
                {s.count} en la zona{s.error ? ` · ${s.error}` : ''}
              </div>
            </div>
          </div>
        ))}
        <div class="row-item">
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: aircraftInfo.value.error ? 'var(--danger)' : aircraftInfo.value.provider ? 'var(--ok)' : 'var(--muted)' }} />
          <div class="grow">
            <div class="t">Aeronaves (ADS-B / MLAT)</div>
            <div class="s">{aircraftInfo.value.error ?? (aircraftInfo.value.provider ? `${aircraftInfo.value.provider} · ${timeAgo(aircraftInfo.value.fetchedAt)}` : 'Sin consultar')}</div>
          </div>
        </div>
        <div class="row-item">
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: fleetInfo.value.error ? 'var(--danger)' : fleetInfo.value.provider ? 'var(--ok)' : 'var(--muted)' }} />
          <div class="grow">
            <div class="t">Flota DGT en España</div>
            <div class="s">{fleetInfo.value.error ?? (fleetInfo.value.provider ? `${fleetInfo.value.provider} · ${timeAgo(fleetInfo.value.fetchedAt)}` : 'Sin consultar')}</div>
          </div>
        </div>
        <div class="group">Atribución y aviso legal</div>
        <p class="note">
          Radares: Dirección General de Tráfico (NAP, CC BY), Servei Català de Trànsit (Llicència oberta d'ús d'informació – Catalunya), Ayuntamiento de Madrid (CC BY 4.0),
          feed «Radares Anunciados» (ODbL, con la atribución de cada fuente) y © colaboradores de OpenStreetMap (ODbL). Aeronaves: adsb.lol, airplanes.live, adsb.fi, OpenSky
          Network. Incidencias: DGT (DATEX II) y Waze. Tiempo: Open-Meteo. Carburantes: Ministerio para la Transición Ecológica. Mapas: CARTO, OpenFreeMap, Esri.
        </p>
        <p class="note">
          Uso personal. Esta app solo muestra ubicaciones publicadas por organismos y comunidades; no detecta ni inhibe señales de radar (art. 18.3 RGC). Conduce siempre
          respetando los límites: los datos pueden estar incompletos o desactualizados.
        </p>
      </div>
    </Sheet>
  );
}
