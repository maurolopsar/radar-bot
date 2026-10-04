import { useState } from 'preact/hooks';
import type { RadarKind } from '../../shared/types';
import { iconUrl } from '../map/icons';
import { STYLE_LABELS } from '../map/styles';
import { api } from '../services/api';
import { beep, say, unlockAudio } from '../services/audio';
import { checkServer, poke, refreshRadars, saveImports } from '../services/data';
import { RADAR_LABEL } from '../services/engine';
import { parseRadarFile } from '../services/importer';
import { setWakeLock, wakeLockSupported } from '../services/wakelock';
import { resetSettings, setHazard, setRadarKind, settings, updateSettings, type HazardKind, type MapStyleSetting, type Settings } from '../state/settings';
import { importedRadars, sheet, showToast } from '../state/store';
import { Icon, Row, Segmented, Sheet, ToggleRow } from './ui';

function Range({ title, value, min, max, step, unit, onChange, sub }: { title: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; sub?: string }) {
  return (
    <div class="row-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span class="t">{title}</span>
        <span class="num">
          {value} {unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))} aria-label={title} />
      {sub && <div class="s note">{sub}</div>}
    </div>
  );
}

function TextRow({ title, sub, value, placeholder, onChange, type = 'text' }: { title: string; sub?: string; value: string; placeholder?: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div class="row-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
      <span class="t">{title}</span>
      <input type={type} value={value} placeholder={placeholder} autocomplete="off" autocapitalize="off" spellcheck={false} onChange={(e) => onChange((e.target as HTMLInputElement).value)} />
      {sub && <div class="note">{sub}</div>}
    </div>
  );
}

const KINDS: RadarKind[] = ['fixed', 'section', 'redlight', 'mobile', 'trailer'];

const HAZARDS: [HazardKind, string][] = [
  ['level_crossing', 'Pasos a nivel'],
  ['bump', 'Resaltos, badenes y bandas'],
  ['narrow', 'Estrechamientos'],
  ['toll', 'Peajes'],
  ['hazard', 'Señales de peligro (animales, desprendimientos…)'],
  ['stop', 'Stop en tu camino'],
  ['give_way', 'Ceda el paso en tu camino'],
  ['traffic_signals', 'Semáforos'],
  ['crossing', 'Pasos de peatones'],
];

export function SettingsSheet() {
  const s = settings.value;
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const [testing, setTesting] = useState(false);

  const importFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const list = [...importedRadars.value];
    for (const f of files) {
      try {
        const radars = parseRadarFile(f.name, await f.text());
        if (!radars.length) {
          showToast(`${f.name}: no se encontraron radares`);
          continue;
        }
        const name = f.name;
        const idx = list.findIndex((x) => x.name === name);
        if (idx >= 0) list.splice(idx, 1);
        list.push({ name, radars });
        showToast(`${f.name}: ${radars.length} radares importados`);
      } catch (err) {
        showToast(`${f.name}: ${(err as Error).message}`);
      }
    }
    await saveImports(list);
    input.value = '';
  };

  return (
    <Sheet title="Ajustes">
      <div class="sheet-body">
        <div class="group">Apariencia</div>
        <Row title="Tema">
          <Segmented value={s.theme} options={[['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']]} onChange={(v) => set({ theme: v })} />
        </Row>
        <Row title="Mapa base">
          <select value={s.mapStyle} onChange={(e) => set({ mapStyle: (e.target as HTMLSelectElement).value as MapStyleSetting })}>
            {Object.entries(STYLE_LABELS).map(([k, v]) => (
              <option value={k}>{v}</option>
            ))}
          </select>
        </Row>
        <ToggleRow title="Mapa orientado al rumbo" sub="Gira el mapa en el sentido de la marcha" checked={s.headingUp} onChange={(v) => set({ headingUp: v })} />
        <ToggleRow
          title="Mantener pantalla encendida"
          sub={wakeLockSupported ? 'Evita que el móvil se bloquee mientras conduces' : 'No soportado en este navegador'}
          checked={s.wakeLock}
          onChange={(v) => {
            set({ wakeLock: v });
            setWakeLock(v);
          }}
        />

        <div class="group">Avisos sonoros</div>
        <ToggleRow title="Voz" sub="Lee los avisos en español" checked={s.voice} onChange={(v) => set({ voice: v })} />
        <ToggleRow title="Pitidos" checked={s.beeps} onChange={(v) => set({ beeps: v })} />
        <ToggleRow title="Vibración" sub="Solo Android (iOS no lo permite en web)" checked={s.vibrate} onChange={(v) => set({ vibrate: v })} />
        <Range title="Volumen" value={Math.round(s.volume * 100)} min={10} max={100} step={5} unit="%" onChange={(v) => set({ volume: v / 100 })} />
        <div class="btns">
          <button
            class="btn"
            onClick={() => {
              unlockAudio();
              beep('radar');
              say('Radar fijo a 500 metros. Límite 100');
            }}
          >
            <Icon name="volume" size={18} /> Probar sonido
          </button>
          <button
            class="btn"
            onClick={() => {
              unlockAudio();
              beep('helicopter');
              say('Helicóptero de la DGT a 5 kilómetros, al noreste');
            }}
          >
            Probar aviso helicóptero
          </button>
        </div>

        <div class="group">Radares</div>
        {KINDS.map((k) => (
          <ToggleRow key={k} icon={iconUrl(`radar-${k}`)} title={RADAR_LABEL[k]} checked={s.radarKinds[k]} onChange={(v) => setRadarKind(k, v)} />
        ))}
        <ToggleRow title="Avisar tramos de velocidad media" sub="Calcula tu velocidad media dentro del tramo" checked={s.sectionAlerts} onChange={(v) => set({ sectionAlerts: v })} />
        <ToggleRow title="Avisar tramos con radar móvil (DGT)" sub="Tramos donde la DGT suele situar radares móviles" checked={s.mobileStretchAlerts} onChange={(v) => set({ mobileStretchAlerts: v })} />
        <Range title="Antelación del aviso" value={s.alertSeconds} min={15} max={90} step={5} unit="s" onChange={(v) => set({ alertSeconds: v })} sub="Segundos antes de llegar al radar a tu velocidad actual" />
        <Range title="Distancia mínima de aviso" value={s.alertMinDistance} min={100} max={1500} step={50} unit="m" onChange={(v) => set({ alertMinDistance: v })} />
        <Range title="Distancia máxima de aviso" value={s.alertMaxDistance} min={500} max={4000} step={100} unit="m" onChange={(v) => set({ alertMaxDistance: v })} />
        <Range title="Margen de exceso de velocidad" value={s.overspeedTolerance} min={0} max={15} step={1} unit="km/h" onChange={(v) => set({ overspeedTolerance: v })} />
        <ToggleRow title="Alarma de exceso cerca del radar" checked={s.overspeedAlarm} onChange={(v) => set({ overspeedAlarm: v })} />
        <ToggleRow title="Pitido al superar un radar" checked={s.announcePassed} onChange={(v) => set({ announcePassed: v })} />

        <div class="group">Avisos de la vía (OpenStreetMap)</div>
        {HAZARDS.map(([k, label]) => (
          <ToggleRow key={k} icon={iconUrl(`hz-${k}`)} title={label} checked={s.hazards[k]} onChange={(v) => setHazard(k, v)} />
        ))}

        <div class="group">Navegación</div>
        <ToggleRow title="Instrucciones por voz" checked={s.navVoice} onChange={(v) => set({ navVoice: v })} />
        <ToggleRow title="Evitar peajes" checked={s.avoidTolls} onChange={(v) => set({ avoidTolls: v })} />
        <ToggleRow title="Evitar autopistas y autovías" checked={s.avoidMotorways} onChange={(v) => set({ avoidMotorways: v })} />

        <div class="group">Helicópteros y aeronaves</div>
        <ToggleRow icon={iconUrl('ac-dgt')} title="Vigilar helicópteros DGT (Pegasus)" sub="Datos ADS-B/MLAT de adsb.lol, airplanes.live, adsb.fi y OpenSky" checked={s.aircraft} onChange={(v) => set({ aircraft: v })} />
        <Range title="Radio de aviso" value={s.aircraftRangeKm} min={1} max={60} step={1} unit="km" onChange={(v) => set({ aircraftRangeKm: v })} sub="Avisa cuando un helicóptero de la DGT entre en este radio" />
        <Range title="Frecuencia de actualización" value={s.aircraftPollS} min={5} max={60} step={5} unit="s" onChange={(v) => set({ aircraftPollS: v })} />
        <ToggleRow title="Seguir la flota DGT en toda España" sub="Muestra cuántos helicópteros de la DGT vuelan ahora" checked={s.fleetTracking} onChange={(v) => set({ fleetTracking: v })} />
        <ToggleRow icon={iconUrl('ac-heli')} title="Mostrar todos los helicópteros" checked={s.showAllHelis} onChange={(v) => set({ showAllHelis: v })} />
        <ToggleRow icon={iconUrl('ac-police')} title="Avisar también de Guardia Civil, Policía y emergencias" checked={s.alertOtherHelis} onChange={(v) => set({ alertOtherHelis: v })} />
        <ToggleRow icon={iconUrl('ac-plane')} title="Mostrar todas las aeronaves" checked={s.showAllAircraft} onChange={(v) => set({ showAllAircraft: v })} />
        <TextRow title="Matrículas DGT adicionales" placeholder="EC-ABC, EC-XYZ" value={s.extraRegs} onChange={(v) => set({ extraRegs: v.toUpperCase() })} sub="Se añaden a la lista integrada de 18 matrículas conocidas" />
        <TextRow title="Códigos ICAO (hex) adicionales" placeholder="3443c5" value={s.extraHex} onChange={(v) => set({ extraHex: v })} />
        <TextRow title="Indicativos adicionales (prefijo)" placeholder="PEGASO" value={s.extraCallsigns} onChange={(v) => set({ extraCallsigns: v.toUpperCase() })} />

        <div class="group">Incidencias y avisos de usuarios</div>
        <ToggleRow title="Waze" sub="Policía, accidentes, peligros y atascos reportados por usuarios" checked={s.waze} onChange={(v) => { set({ waze: v }); poke('events'); }} />
        <ToggleRow title="DGT" sub="Incidencias oficiales y balizas V16 conectadas" checked={s.dgtIncidents} onChange={(v) => { set({ dgtIncidents: v }); poke('events'); }} />
        <Range title="Radio de incidencias" value={s.eventsRadiusKm} min={5} max={80} step={5} unit="km" onChange={(v) => set({ eventsRadiusKm: v })} />
        <ToggleRow icon={iconUrl('ev-police')} title="Avisar controles policiales (Waze)" checked={s.alertPolice} onChange={(v) => set({ alertPolice: v })} />
        <ToggleRow icon={iconUrl('ev-accident')} title="Avisar accidentes" checked={s.alertAccidents} onChange={(v) => set({ alertAccidents: v })} />
        <ToggleRow icon={iconUrl('ev-v16')} title="Avisar vehículos detenidos (V16)" checked={s.alertV16} onChange={(v) => set({ alertV16: v })} />
        <ToggleRow icon={iconUrl('ev-hazard')} title="Avisar peligros, cortes y meteorología" checked={s.alertHazards} onChange={(v) => set({ alertHazards: v })} />
        <ToggleRow icon={iconUrl('rep-mobile_radar')} title="Avisar mis avisos propios" checked={s.alertUserReports} onChange={(v) => set({ alertUserReports: v })} />
        <Range title="Duración por defecto de mis avisos" value={s.reportTtlMin} min={15} max={720} step={15} unit="min" onChange={(v) => set({ reportTtlMin: v })} />

        <div class="group">Bases de datos propias</div>
        <p class="note">
          Importa ficheros de radares (CSV, GPX, KML o GeoJSON) de cualquier base de datos de POIs. Se combinan con las fuentes oficiales y se eliminan duplicados.
        </p>
        {importedRadars.value.map((i) => (
          <div class="row-item" key={i.name}>
            <div class="grow">
              <div class="t">{i.name}</div>
              <div class="s">{i.radars.length} radares</div>
            </div>
            <button class="icon-btn" aria-label={`Eliminar ${i.name}`} onClick={() => void saveImports(importedRadars.value.filter((x) => x.name !== i.name))}>
              <Icon name="trash" />
            </button>
          </div>
        ))}
        <label class="btn block" style={{ marginTop: '8px' }}>
          <Icon name="database" size={18} /> Importar fichero…
          <input type="file" accept=".csv,.txt,.gpx,.kml,.geojson,.json" multiple hidden onChange={importFile} />
        </label>
        <div class="btns">
          <button class="btn" onClick={() => void refreshRadars(true).then(() => showToast('Radares actualizados'))}>
            <Icon name="refresh" size={18} /> Actualizar radares
          </button>
          <button class="btn" onClick={() => (sheet.value = 'sources')}>
            Ver fuentes
          </button>
        </div>

        <div class="group">Servidor</div>
        <TextRow title="URL del servidor" placeholder="(mismo origen)" type="url" value={s.serverUrl} onChange={(v) => set({ serverUrl: v.trim() })} sub="Déjalo vacío si la app se sirve desde el propio servidor." />
        <TextRow title="Token de acceso" type="password" placeholder="APP_TOKEN" value={s.token} onChange={(v) => set({ token: v.trim() })} sub="Solo si el servidor tiene configurado APP_TOKEN." />
        <div class="btns">
          <button
            class="btn"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              try {
                const h = await api.health();
                showToast(h.ok ? 'Servidor OK' : 'El servidor no responde bien');
                await checkServer();
              } catch (err) {
                showToast(`Error: ${(err as Error).message}`);
              } finally {
                setTesting(false);
              }
            }}
          >
            Probar conexión
          </button>
          <button class="btn" onClick={() => (sheet.value = 'sim')}>
            <Icon name="route" size={18} /> Simulación
          </button>
        </div>

        <div class="btns" style={{ marginTop: '24px' }}>
          <button
            class="btn danger"
            onClick={() => {
              if (confirm('¿Restablecer todos los ajustes?')) resetSettings();
            }}
          >
            Restablecer ajustes
          </button>
        </div>
      </div>
    </Sheet>
  );
}
