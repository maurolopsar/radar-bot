import type { FuelType } from '../../shared/types';
import { iconUrl } from '../map/icons';
import { poke } from '../services/data';
import { setLayer, settings, updateSettings } from '../state/settings';
import { Row, Segmented, Sheet, ToggleRow } from './ui';
import { sheet } from '../state/store';

export function LayersSheet() {
  const s = settings.value;
  const l = s.layers;
  return (
    <Sheet title="Modos y capas">
      <div class="sheet-body">
        <div class="group">Modos</div>
        <ToggleRow
          icon={iconUrl('radar-fixed')}
          title="Modo radares"
          sub="Tu velocidad en grande y semitransparente sobre el mapa (también tocando la velocidad)"
          checked={s.radarMode}
          onChange={(v) => updateSettings({ radarMode: v })}
        />
        {s.radarMode && (
          <div class="row-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
            <span class="t">Opacidad: {Math.round(s.radarModeOpacity * 100)} %</span>
            <input type="range" min={10} max={80} step={5} value={Math.round(s.radarModeOpacity * 100)} onInput={(e) => updateSettings({ radarModeOpacity: Number((e.target as HTMLInputElement).value) / 100 })} aria-label="Opacidad del modo radares" />
          </div>
        )}
        <ToggleRow title="Modo tramo" sub="Curvas por colores, velocidad recomendada y cronómetro" checked={s.rallyMode} onChange={(v) => updateSettings({ rallyMode: v })} />
        {s.rallyMode && (
          <button class="btn block" onClick={() => (sheet.value = 'rally')}>
            Tramos cronometrados y ajustes del modo tramo ›
          </button>
        )}
        <div class="group">Mapa</div>
        <Row title="Tema">
          <Segmented value={s.theme} options={[['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']]} onChange={(v) => updateSettings({ theme: v })} />
        </Row>
        <Row title="Vista">
          <Segmented
            value={s.mapStyle === 'satellite' ? 'satellite' : 'map'}
            options={[
              ['map', 'Mapa'],
              ['satellite', 'Satélite'],
            ]}
            onChange={(v) => updateSettings({ mapStyle: v === 'satellite' ? 'satellite' : 'auto' })}
          />
        </Row>
        <ToggleRow title="Carreteras resaltadas" sub="Dibuja las vías con más grosor y contraste" checked={s.boostRoads} onChange={(v) => updateSettings({ boostRoads: v })} />
        <Row title="Inclinación 3D">
          <Segmented value={s.pitch} options={[[0, 'Plano'], [30, 'Media'], [50, 'Alta']]} onChange={(v) => updateSettings({ pitch: v })} />
        </Row>
        <ToggleRow title="Acercar en cruces y maniobras" checked={s.autoZoomJunctions} onChange={(v) => updateSettings({ autoZoomJunctions: v })} />
        <div class="group">Capas</div>
        <ToggleRow icon={iconUrl('radar-fixed')} title="Radares" checked={l.radars} onChange={(v) => setLayer('radars', v)} />
        <ToggleRow icon={iconUrl('radar-section')} title="Tramos (velocidad media y radar móvil)" checked={l.stretches} onChange={(v) => setLayer('stretches', v)} />
        <ToggleRow icon={iconUrl('ev-police')} title="Incidencias y avisos" checked={l.events} onChange={(v) => setLayer('events', v)} />
        <ToggleRow icon={iconUrl('ev-jam')} title="Atascos y tramos afectados" checked={l.jams} onChange={(v) => setLayer('jams', v)} />
        <ToggleRow icon={iconUrl('ac-dgt')} title="Helicópteros y aeronaves" checked={l.aircraft} onChange={(v) => setLayer('aircraft', v)} />
        <ToggleRow icon={iconUrl('rep-police')} title="Mis avisos" checked={l.reports} onChange={(v) => setLayer('reports', v)} />
        <ToggleRow
          icon={iconUrl('cam')}
          title="Cámaras de tráfico DGT"
          checked={l.cameras}
          onChange={(v) => {
            setLayer('cameras', v);
            poke('cameras');
          }}
        />
        <ToggleRow
          icon={iconUrl('fuel-1.499-low')}
          title="Gasolineras con precio"
          sub="Precios oficiales del Ministerio (actualizados cada hora)"
          checked={l.fuel}
          onChange={(v) => {
            setLayer('fuel', v);
            poke('fuel');
          }}
        />
        {l.fuel && (
          <Row title="Combustible">
            <select value={s.fuelType} onChange={(e) => updateSettings({ fuelType: (e.target as HTMLSelectElement).value as FuelType })}>
              <option value="g95">Gasolina 95</option>
              <option value="g98">Gasolina 98</option>
              <option value="diesel">Diésel</option>
              <option value="dieselPlus">Diésel premium</option>
              <option value="glp">GLP</option>
            </select>
          </Row>
        )}
      </div>
    </Sheet>
  );
}
