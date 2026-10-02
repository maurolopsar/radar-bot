import { useState } from 'preact/hooks';
import { distanceM, formatDistance } from '../../shared/geo';
import type { ReportKind } from '../../shared/types';
import { iconUrl } from '../map/icons';
import { addReport } from '../services/data';
import { REPORT_LABEL } from '../services/engine';
import { settings } from '../state/settings';
import { position, reportAt, sheet, showToast } from '../state/store';
import { Segmented, Sheet } from './ui';

const KINDS: ReportKind[] = ['mobile_radar', 'police', 'helicopter', 'accident', 'hazard', 'other'];

export function ReportSheet() {
  const [kind, setKind] = useState<ReportKind>('mobile_radar');
  const [note, setNote] = useState('');
  const [ttl, setTtl] = useState<number>(settings.value.reportTtlMin);
  const p = position.value;
  const at = reportAt.value ?? (p ? { lat: p.lat, lon: p.lon } : null);
  const atMe = !!p && !!at && distanceM(p.lat, p.lon, at.lat, at.lon) < 50;

  const save = async () => {
    if (!at) return;
    await addReport({
      id: crypto.randomUUID?.() ?? String(Date.now()),
      kind,
      lat: at.lat,
      lon: at.lon,
      // Si el aviso es en tu posición, se asocia a tu sentido de marcha.
      heading: atMe && p?.heading != null && (p.speed ?? 0) > 2 ? Math.round(p.heading) : undefined,
      note: note.trim() || undefined,
      createdAt: new Date().toISOString(),
      expiresAt: ttl > 0 ? new Date(Date.now() + ttl * 60_000).toISOString() : undefined,
    });
    showToast(`Aviso guardado: ${REPORT_LABEL[kind]}`);
    reportAt.value = null;
    sheet.value = null;
  };

  return (
    <Sheet title="Nuevo aviso">
      <div class="sheet-body">
        {!at ? (
          <div class="empty">Sin posición. Mantén pulsado el mapa en el punto del aviso.</div>
        ) : (
          <>
            <p class="note">
              {atMe ? 'En tu posición actual' : p ? `En el punto marcado, a ${formatDistance(distanceM(p.lat, p.lon, at.lat, at.lon))}` : 'En el punto marcado'}
              {' · '}
              {at.lat.toFixed(5)}, {at.lon.toFixed(5)}
            </p>
            <div class="kinds">
              {KINDS.map((k) => (
                <button class={`kind-btn${k === kind ? ' on' : ''}`} onClick={() => setKind(k)} aria-pressed={k === kind}>
                  <img src={iconUrl(`rep-${k}`)} alt="" />
                  {REPORT_LABEL[k]}
                </button>
              ))}
            </div>
            <div class="group">Duración</div>
            <Segmented
              value={ttl}
              options={[
                [30, '30 min'],
                [120, '2 h'],
                [480, '8 h'],
                [0, 'Siempre'],
              ]}
              onChange={setTtl}
            />
            <div class="group">Nota (opcional)</div>
            <textarea value={note} maxLength={280} placeholder="Ej.: furgoneta camuflada en el arcén" onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
            <div class="btns">
              <button class="btn primary block" onClick={() => void save()}>
                Guardar aviso
              </button>
            </div>
            <p class="note">Consejo: mantén pulsado el mapa (o clic derecho) para crear un aviso en cualquier punto.</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
