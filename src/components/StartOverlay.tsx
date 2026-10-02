import { iconUrl } from '../map/icons';
import { unlockAudio } from '../services/audio';
import { startGps } from '../services/geolocation';
import { setWakeLock } from '../services/wakelock';
import { settings } from '../state/settings';
import { sheet, started } from '../state/store';

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function start(): void {
  unlockAudio();
  startGps();
  setWakeLock(settings.value.wakeLock);
  started.value = true;
}

export function StartOverlay() {
  return (
    <div class="start">
      <div class="start-box">
        <img src={iconUrl('radar-fixed')} alt="" width={64} height={64} />
        <h1>Radar Bot</h1>
        <p>Avisador de radares, helicópteros Pegasus e incidencias de tráfico en toda España.</p>
        <ul class="features">
          <li>
            <img src={iconUrl('radar-fixed-100')} alt="" /> Radares fijos, de tramo y semáforo de DGT, Cataluña, Madrid, Euskadi, OSM…
          </li>
          <li>
            <img src={iconUrl('ac-dgt')} alt="" /> Helicópteros DGT en tiempo real con radio de aviso
          </li>
          <li>
            <img src={iconUrl('ev-police')} alt="" /> Controles y avisos de Waze, incidencias DGT y balizas V16
          </li>
          <li>
            <img src={iconUrl('radar-mobile')} alt="" /> Radares móviles anunciados y tramos vigilados
          </li>
        </ul>
        <button class="go" onClick={start}>
          Iniciar
        </button>
        <div class="small">Necesita permiso de ubicación. Los avisos de voz se activan al pulsar Iniciar.</div>
        {isIos && !standalone && <div class="small">En iPhone: Compartir → «Añadir a pantalla de inicio» para usarla como app a pantalla completa.</div>}
        <button
          class="link"
          onClick={() => {
            unlockAudio();
            started.value = true;
            sheet.value = 'sim';
          }}
        >
          Probar con una ruta simulada
        </button>
      </div>
    </div>
  );
}
