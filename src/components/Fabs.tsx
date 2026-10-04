import { recenter } from '../map/MapView';
import { settings, updateSettings } from '../state/settings';
import { follow, position, reportAt, sheet } from '../state/store';
import { Icon } from './ui';
import { navActive } from '../services/nav';

export function Fabs() {
  const s = settings.value;
  return (
    <div class="fabs">
      <button class={`fab${navActive.value ? ' nav' : ''}`} aria-label="Buscar destino y rutas" onClick={() => (sheet.value = 'route')}>
        <Icon name="search" />
      </button>
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
        class={`fab${follow.value ? ' primary' : ''}`}
        aria-label={follow.value ? (s.headingUp ? 'Cambiar a norte arriba' : 'Cambiar a rumbo arriba') : 'Centrar en mi posición'}
        title="Centrar · si ya está centrado, alterna rumbo arriba / norte arriba"
        onClick={() => {
          if (follow.value) updateSettings({ headingUp: !s.headingUp });
          recenter();
        }}
      >
        <Icon name={follow.value ? (s.headingUp ? 'navigate' : 'north') : 'locate'} />
      </button>
    </div>
  );
}
