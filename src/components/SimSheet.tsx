import { useState } from 'preact/hooks';
import { formatDistance } from '../../shared/geo';
import { recenter } from '../map/MapView';
import { unlockAudio } from '../services/audio';
import { planRoute, setSimFactor, startGps, startSim, stopSim, toggleSimPause } from '../services/geolocation';
import { settings, updateSettings } from '../state/settings';
import { pickMode, position, sheet, showToast, simActive, simPoints, simRoute, started } from '../state/store';
import { Icon, Segmented, Sheet } from './ui';

const PRESETS: { name: string; from: { lat: number; lon: number }; to: { lat: number; lon: number } }[] = [
  { name: 'A-6 · Madrid (Moncloa) → Las Rozas', from: { lat: 40.4385, lon: -3.7238 }, to: { lat: 40.5001, lon: -3.8832 } },
  { name: 'M-30 · Puente de Ventas → Avda. de Portugal', from: { lat: 40.4318, lon: -3.6634 }, to: { lat: 40.4101, lon: -3.7314 } },
  { name: 'A-2 · Zaragoza → La Almunia', from: { lat: 41.6227, lon: -0.9527 }, to: { lat: 41.4787, lon: -1.3739 } },
  { name: 'AP-7 · Barcelona → Granollers', from: { lat: 41.4402, lon: 2.1952 }, to: { lat: 41.6063, lon: 2.2853 } },
];

const fmt = (p?: { lat: number; lon: number }) => (p ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : 'sin elegir');

export function SimSheet() {
  const pts = simPoints.value;
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const factor = settings.value.simSpeedFactor;

  const pick = (mode: 'sim-from' | 'sim-to') => {
    pickMode.value = mode;
    sheet.value = null;
    showToast(mode === 'sim-from' ? 'Toca el mapa para elegir el origen' : 'Toca el mapa para elegir el destino');
  };

  const run = async (from?: { lat: number; lon: number }, to?: { lat: number; lon: number }) => {
    const origin = from ?? (position.value ? { lat: position.value.lat, lon: position.value.lon } : undefined);
    if (!origin || !to) {
      showToast('Elige origen y destino');
      return;
    }
    setBusy(true);
    unlockAudio();
    started.value = true;
    const route = await planRoute(origin, to);
    setBusy(false);
    simRoute.value = route.coords;
    simActive.value = true;
    setPaused(false);
    startSim(route, factor, () => {
      simActive.value = false;
      simRoute.value = null;
      showToast('Simulación terminada');
      startGps();
    });
    recenter();
    sheet.value = null;
    showToast(`Simulando ${formatDistance(route.lengthM)}${route.coords.length === 2 ? ' (línea recta: sin servicio de rutas)' : ''}`);
  };

  return (
    <Sheet title="Simulación de ruta">
      <div class="sheet-body">
        <p class="note">
          Recorre una ruta virtual para probar los avisos de radares, tramos, incidencias y helicópteros sin conducir. La ruta se calcula con OSRM (OpenStreetMap).
        </p>
        {simActive.value && (
          <div class="btns">
            <button
              class="btn"
              onClick={() => {
                setPaused(toggleSimPause());
              }}
            >
              <Icon name={paused ? 'play' : 'pause'} size={18} /> {paused ? 'Reanudar' : 'Pausar'}
            </button>
            <button
              class="btn danger"
              onClick={() => {
                stopSim();
                simActive.value = false;
                simRoute.value = null;
                startGps();
              }}
            >
              <Icon name="stop" size={18} /> Detener
            </button>
          </div>
        )}
        <div class="group">Velocidad</div>
        <Segmented
          value={factor}
          options={[
            [1, 'Real'],
            [2, '×2'],
            [4, '×4'],
          ]}
          onChange={(v) => {
            updateSettings({ simSpeedFactor: v });
            setSimFactor(v);
          }}
        />
        <div class="group">Rutas de ejemplo</div>
        {PRESETS.map((p) => (
          <button class="row-item" key={p.name} disabled={busy} onClick={() => void run(p.from, p.to)}>
            <Icon name="route" />
            <div class="grow t">{p.name}</div>
          </button>
        ))}
        <div class="group">Ruta personalizada</div>
        <div class="row-item">
          <div class="grow">
            <div class="t">Origen</div>
            <div class="s">{pts.from ? fmt(pts.from) : 'Mi posición actual'}</div>
          </div>
          <button class="btn" onClick={() => pick('sim-from')}>
            Elegir en mapa
          </button>
        </div>
        <div class="row-item">
          <div class="grow">
            <div class="t">Destino</div>
            <div class="s">{fmt(pts.to)}</div>
          </div>
          <button class="btn" onClick={() => pick('sim-to')}>
            Elegir en mapa
          </button>
        </div>
        <div class="btns">
          <button class="btn primary block" disabled={busy || !pts.to} onClick={() => void run(pts.from, pts.to)}>
            {busy ? 'Calculando ruta…' : 'Iniciar simulación'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
