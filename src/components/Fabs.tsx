import { recenter } from '../map/MapView';
import { settings, updateSettings } from '../state/settings';
import { follow, position, reportAt, sheet } from '../state/store';
import { Icon } from './ui';

export function Fabs() {
  const s = settings.value;
  return (
    <div class="fabs">
      <button
        class="fab report"
        aria-label="Añadir aviso"
        title="Añadir aviso en tu posición (o mantén pulsado el mapa)"
        onClick={() => {
          const p = position.value;
          reportAt.value = p ? { lat: p.lat, lon: p.lon } : null;
          sheet.value = 'report';
        }}
      >
        <Icon name="plus" />
      </button>
      <button class="fab" aria-label="Capas" onClick={() => (sheet.value = 'layers')}>
        <Icon name="layers" />
      </button>
      <button class="fab" aria-label="Cerca de mí" onClick={() => (sheet.value = 'nearby')}>
        <Icon name="list" />
      </button>
      <button class="fab" aria-label="Ajustes" onClick={() => (sheet.value = 'settings')}>
        <Icon name="settings" />
      </button>
      <button
        class={`fab${s.headingUp ? ' active' : ''}`}
        aria-label={s.headingUp ? 'Mapa orientado al rumbo' : 'Mapa con el norte arriba'}
        title={s.headingUp ? 'Rumbo arriba (pulsa para norte arriba)' : 'Norte arriba (pulsa para rumbo arriba)'}
        onClick={() => updateSettings({ headingUp: !s.headingUp })}
      >
        <Icon name={s.headingUp ? 'navigate' : 'north'} />
      </button>
      <button class={`fab${follow.value ? ' primary' : ''}`} aria-label="Centrar en mi posición" onClick={recenter}>
        <Icon name="locate" />
      </button>
    </div>
  );
}
