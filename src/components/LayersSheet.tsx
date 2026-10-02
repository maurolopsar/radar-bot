import type { FuelType } from '../../shared/types';
import { iconUrl } from '../map/icons';
import { poke } from '../services/data';
import { setLayer, settings, updateSettings } from '../state/settings';
import { Row, Segmented, Sheet, ToggleRow } from './ui';

export function LayersSheet() {
  const s = settings.value;
  const l = s.layers;
  return (
    <Sheet title="Capas del mapa">
      <div class="sheet-body">
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
