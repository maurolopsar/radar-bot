// Iconos del mapa dibujados en canvas bajo demanda (evento `styleimagemissing`).
// Así no dependen de las fuentes/glifos del estilo base y pueden incluir el
// límite de velocidad o el precio dentro del propio icono.

export const PIXEL_RATIO = 2;

export const KIND_COLORS: Record<string, string> = {
  fixed: '#e11d48',
  section: '#7c3aed',
  redlight: '#ea580c',
  trailer: '#a16207',
  mobile: '#db2777',
  police: '#1d4ed8',
  accident: '#dc2626',
  hazard: '#d97706',
  weather: '#0891b2',
  jam: '#b91c1c',
  roadworks: '#f97316',
  closure: '#111827',
  v16: '#eab308',
  event: '#6b7280',
  restriction: '#4f46e5',
  other: '#6b7280',
};

const REPORT_COLORS: Record<string, string> = {
  mobile_radar: '#db2777',
  police: '#1d4ed8',
  helicopter: '#dc2626',
  accident: '#dc2626',
  hazard: '#d97706',
  other: '#475569',
};

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function disc(ctx: Ctx, cx: number, cy: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function glyphCamera(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  roundRect(ctx, cx - s * 0.55, cy - s * 0.35, s * 1.1, s * 0.72, s * 0.14);
  ctx.fill();
  ctx.fillRect(cx - s * 0.25, cy - s * 0.48, s * 0.32, s * 0.16);
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.01, s * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.01, s * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function glyphTrafficLight(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  roundRect(ctx, cx - s * 0.24, cy - s * 0.58, s * 0.48, s * 1.16, s * 0.18);
  ctx.fill();
  const colors = ['#ef4444', '#f59e0b', '#22c55e'];
  colors.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.34 + i * s * 0.34, s * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
}

function glyphText(ctx: Ctx, cx: number, cy: number, s: number, text: string, color = '#fff', weight = 800): void {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + s * 0.05);
}

function glyphSiren(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.15, s * 0.38, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(cx - s * 0.5, cy + s * 0.15, s, s * 0.2);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  for (const [x1, y1, x2, y2] of [
    [-0.6, -0.35, -0.45, -0.25],
    [0.6, -0.35, 0.45, -0.25],
    [0, -0.6, 0, -0.42],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx + x1 * s, cy + y1 * s);
    ctx.lineTo(cx + x2 * s, cy + y2 * s);
    ctx.stroke();
  }
}

function glyphTriangle(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.55);
  ctx.lineTo(cx + s * 0.58, cy + s * 0.45);
  ctx.lineTo(cx - s * 0.58, cy + s * 0.45);
  ctx.closePath();
  ctx.fill();
}

function glyphCone(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.12, cy - s * 0.55);
  ctx.lineTo(cx + s * 0.12, cy - s * 0.55);
  ctx.lineTo(cx + s * 0.38, cy + s * 0.35);
  ctx.lineTo(cx - s * 0.38, cy + s * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - s * 0.55, cy + s * 0.35, s * 1.1, s * 0.16);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(cx - s * 0.25, cy - s * 0.12, s * 0.5, s * 0.14);
}

function glyphCar(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  roundRect(ctx, cx - s * 0.55, cy - s * 0.05, s * 1.1, s * 0.38, s * 0.1);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.36, cy - s * 0.05);
  ctx.lineTo(cx - s * 0.22, cy - s * 0.35);
  ctx.lineTo(cx + s * 0.22, cy - s * 0.35);
  ctx.lineTo(cx + s * 0.36, cy - s * 0.05);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  for (const x of [-0.32, 0.32]) {
    ctx.beginPath();
    ctx.arc(cx + x * s, cy + s * 0.34, s * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }
}

function glyphCloud(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx - s * 0.22, cy + s * 0.05, s * 0.24, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.08, cy - s * 0.1, s * 0.3, 0, Math.PI * 2);
  ctx.arc(cx + s * 0.32, cy + s * 0.1, s * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - s * 0.22, cy + s * 0.05, s * 0.55, s * 0.25);
}

function glyphBeacon(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx, cy + s * 0.1, s * 0.3, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(cx - s * 0.42, cy + s * 0.1, s * 0.84, s * 0.22);
  glyphText(ctx, cx, cy + s * 0.2, s * 0.32, 'V16', '#854d0e', 900);
}

function glyphNoEntry(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - s * 0.32, cy - s * 0.1, s * 0.64, s * 0.2);
}

function glyphBars(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  for (const dy of [-0.3, 0, 0.3]) {
    roundRect(ctx, cx - s * 0.45, cy + dy * s - s * 0.08, s * 0.9, s * 0.16, s * 0.08);
    ctx.fill();
  }
}

function glyphPump(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  roundRect(ctx, cx - s * 0.4, cy - s * 0.5, s * 0.55, s * 0.95, s * 0.08);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(cx - s * 0.3, cy - s * 0.4, s * 0.35, s * 0.25);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = s * 0.09;
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.15, cy - s * 0.2);
  ctx.lineTo(cx + s * 0.38, cy - s * 0.05);
  ctx.lineTo(cx + s * 0.38, cy + s * 0.3);
  ctx.stroke();
}

function glyphVideo(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.fillStyle = '#fff';
  roundRect(ctx, cx - s * 0.55, cy - s * 0.3, s * 0.75, s * 0.6, s * 0.1);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.22, cy - s * 0.05);
  ctx.lineTo(cx + s * 0.55, cy - s * 0.28);
  ctx.lineTo(cx + s * 0.55, cy + s * 0.28);
  ctx.lineTo(cx + s * 0.22, cy + s * 0.05);
  ctx.fill();
}

function speedBadge(ctx: Ctx, cx: number, cy: number, r: number, limit: string): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = r * 0.28;
  ctx.strokeStyle = '#dc2626';
  ctx.stroke();
  glyphText(ctx, cx, cy, r * (limit.length > 2 ? 0.95 : 1.15), limit, '#111', 900);
}

function radarIcon(kind: string, limit?: string): ImageData {
  const size = 64;
  const [, ctx] = canvas(size, size);
  const cx = limit ? 28 : 32;
  const cy = limit ? 36 : 32;
  disc(ctx, cx, cy, 22, KIND_COLORS[kind] ?? '#e11d48');
  if (kind === 'redlight') glyphTrafficLight(ctx, cx, cy, 26);
  else glyphCamera(ctx, cx, cy, 26);
  if (kind === 'section') {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 14);
    ctx.lineTo(cx + 10, cy + 14);
    ctx.stroke();
  }
  if (kind === 'mobile' || kind === 'trailer') glyphText(ctx, cx + 13, cy + 13, 13, kind === 'mobile' ? 'M' : 'R');
  if (limit) speedBadge(ctx, 48, 15, 13, limit);
  return ctx.getImageData(0, 0, size, size);
}

function eventIcon(cat: string): ImageData {
  const size = 56;
  const [, ctx] = canvas(size, size);
  const c = size / 2;
  disc(ctx, c, c, 20, KIND_COLORS[cat] ?? '#6b7280');
  const s = 24;
  switch (cat) {
    case 'police':
      glyphSiren(ctx, c, c, s);
      break;
    case 'accident':
      glyphCar(ctx, c, c - 2, s);
      glyphText(ctx, c + 11, c - 11, 14, '!');
      break;
    case 'jam':
      glyphBars(ctx, c, c, s);
      break;
    case 'roadworks':
      glyphCone(ctx, c, c, s);
      break;
    case 'closure':
      glyphNoEntry(ctx, c, c, s * 1.1);
      break;
    case 'weather':
      glyphCloud(ctx, c, c, s);
      break;
    case 'v16':
      glyphBeacon(ctx, c, c, s * 1.15);
      break;
    case 'restriction':
      glyphText(ctx, c, c, 18, 'km/h');
      break;
    case 'event':
      glyphText(ctx, c, c, 22, '★');
      break;
    case 'hazard':
      glyphTriangle(ctx, c, c, s);
      glyphText(ctx, c, c + 3, 15, '!', KIND_COLORS.hazard);
      break;
    default:
      glyphText(ctx, c, c, 22, 'i');
  }
  return ctx.getImageData(0, 0, size, size);
}

function reportIcon(kind: string): ImageData {
  const w = 52;
  const h = 64;
  const [, ctx] = canvas(w, h);
  const color = REPORT_COLORS[kind] ?? '#475569';
  ctx.beginPath();
  ctx.moveTo(w / 2, h - 3);
  ctx.bezierCurveTo(w / 2 - 6, h - 20, 4, 34, 4, 24);
  ctx.arc(w / 2, 24, w / 2 - 4, Math.PI, 0);
  ctx.bezierCurveTo(w - 4, 34, w / 2 + 6, h - 20, w / 2, h - 3);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  const glyph: Record<string, () => void> = {
    mobile_radar: () => glyphCamera(ctx, w / 2, 24, 22),
    police: () => glyphSiren(ctx, w / 2, 24, 22),
    helicopter: () => drawHeli(ctx, w / 2, 24, 26, '#fff'),
    accident: () => glyphCar(ctx, w / 2, 22, 22),
    hazard: () => glyphText(ctx, w / 2, 24, 24, '!'),
    other: () => glyphText(ctx, w / 2, 24, 22, '?'),
  };
  (glyph[kind] ?? glyph.other)();
  return ctx.getImageData(0, 0, w, h);
}

/** Helicóptero visto desde arriba, morro hacia arriba (norte). */
function drawHeli(ctx: Ctx, cx: number, cy: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  // fuselaje y cola
  ctx.beginPath();
  ctx.ellipse(cx, cy - s * 0.06, s * 0.15, s * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - s * 0.035, cy + s * 0.12, s * 0.07, s * 0.36);
  ctx.fillRect(cx - s * 0.13, cy + s * 0.44, s * 0.26, s * 0.06);
  // disco del rotor y palas en cruz
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = s * 0.045;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 0.08, s * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = s * 0.07;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.48);
  ctx.lineTo(cx, cy + s * 0.32);
  ctx.moveTo(cx - s * 0.4, cy - s * 0.08);
  ctx.lineTo(cx + s * 0.4, cy - s * 0.08);
  ctx.stroke();
}

function drawPlane(ctx: Ctx, cx: number, cy: number, s: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.5);
  ctx.lineTo(cx + s * 0.07, cy - s * 0.15);
  ctx.lineTo(cx + s * 0.5, cy + s * 0.08);
  ctx.lineTo(cx + s * 0.5, cy + s * 0.17);
  ctx.lineTo(cx + s * 0.07, cy + s * 0.07);
  ctx.lineTo(cx + s * 0.05, cy + s * 0.35);
  ctx.lineTo(cx + s * 0.2, cy + s * 0.47);
  ctx.lineTo(cx - s * 0.2, cy + s * 0.47);
  ctx.lineTo(cx - s * 0.05, cy + s * 0.35);
  ctx.lineTo(cx - s * 0.07, cy + s * 0.07);
  ctx.lineTo(cx - s * 0.5, cy + s * 0.17);
  ctx.lineTo(cx - s * 0.5, cy + s * 0.08);
  ctx.lineTo(cx - s * 0.07, cy - s * 0.15);
  ctx.closePath();
  ctx.fill();
}

function aircraftIcon(kind: string): ImageData {
  const size = 72;
  const [, ctx] = canvas(size, size);
  const c = size / 2;
  const color = kind === 'dgt' ? '#dc2626' : kind === 'heli' ? '#2563eb' : kind === 'police' ? '#1e3a8a' : '#64748b';
  if (kind === 'dgt') {
    ctx.beginPath();
    ctx.arc(c, c, 34, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(220,38,38,0.22)';
    ctx.fill();
  }
  disc(ctx, c, c, kind === 'plane' ? 17 : 22, color);
  if (kind === 'plane') drawPlane(ctx, c, c, 24, '#fff');
  else drawHeli(ctx, c, c + 2, 34, '#fff');
  return ctx.getImageData(0, 0, size, size);
}

function fuelIcon(price: string, tier: string): ImageData {
  const w = 96;
  const h = 44;
  const [, ctx] = canvas(w, h);
  const color = tier === 'low' ? '#16a34a' : tier === 'high' ? '#dc2626' : '#d97706';
  roundRect(ctx, 3, 4, w - 6, h - 10, 16);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 3;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  glyphPump(ctx, 22, h / 2 - 2, 20);
  glyphText(ctx, 60, h / 2 - 2, 19, price);
  return ctx.getImageData(0, 0, w, h);
}

function cameraIcon(): ImageData {
  const size = 48;
  const [, ctx] = canvas(size, size);
  disc(ctx, size / 2, size / 2, 17, '#334155');
  glyphVideo(ctx, size / 2, size / 2, 20);
  return ctx.getImageData(0, 0, size, size);
}

/** Genera la imagen de un icono a partir de su id, o null si no es nuestro. */
export function drawIcon(id: string): ImageData | null {
  const parts = id.split('-');
  switch (parts[0]) {
    case 'radar':
      return radarIcon(parts[1], parts[2]);
    case 'ev':
      return eventIcon(parts[1]);
    case 'rep':
      return reportIcon(parts.slice(1).join('-'));
    case 'ac':
      return aircraftIcon(parts[1]);
    case 'fuel':
      return fuelIcon(parts[1], parts[2]);
    case 'cam':
      return cameraIcon();
    default:
      return null;
  }
}

/** Icono como data URL (para listas y tarjetas fuera del mapa). */
const urlCache = new Map<string, string>();
export function iconUrl(id: string): string {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const img = drawIcon(id);
  if (!img) return '';
  const [c, ctx] = canvas(img.width, img.height);
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  urlCache.set(id, url);
  return url;
}
