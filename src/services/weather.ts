// Tiempo actual en la posición (Open-Meteo, gratuito y sin clave).

import { weather, type Weather } from '../state/store';

let lastFetch = 0;
let lastPos: { lat: number; lon: number } | null = null;

export async function updateWeather(lat: number, lon: number, force = false): Promise<void> {
  const now = Date.now();
  const moved = lastPos ? Math.hypot(lat - lastPos.lat, lon - lastPos.lon) > 0.15 : true;
  if (!force && now - lastFetch < 10 * 60_000 && !moved) return;
  lastFetch = now;
  lastPos = { lat, lon };
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
      '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,visibility,is_day&timezone=auto';
    const res = await fetch(url);
    if (!res.ok) return;
    const d = (await res.json()) as {
      current: {
        time: string;
        temperature_2m: number;
        apparent_temperature?: number;
        precipitation: number;
        weather_code: number;
        wind_speed_10m: number;
        wind_gusts_10m?: number;
        visibility?: number;
        is_day: number;
      };
    };
    const c = d.current;
    weather.value = {
      temperature: c.temperature_2m,
      apparent: c.apparent_temperature,
      precipitation: c.precipitation,
      code: c.weather_code,
      wind: c.wind_speed_10m,
      gusts: c.wind_gusts_10m,
      visibility: c.visibility,
      isDay: c.is_day === 1,
      time: c.time,
    } satisfies Weather;
  } catch {
    // sin conexión
  }
}

const CODES: Record<number, [string, string]> = {
  0: ['Despejado', '☀️'],
  1: ['Poco nuboso', '🌤️'],
  2: ['Nubes y claros', '⛅'],
  3: ['Nublado', '☁️'],
  45: ['Niebla', '🌫️'],
  48: ['Niebla con escarcha', '🌫️'],
  51: ['Llovizna débil', '🌦️'],
  53: ['Llovizna', '🌦️'],
  55: ['Llovizna intensa', '🌧️'],
  56: ['Llovizna helada', '🌧️'],
  57: ['Llovizna helada', '🌧️'],
  61: ['Lluvia débil', '🌧️'],
  63: ['Lluvia', '🌧️'],
  65: ['Lluvia fuerte', '🌧️'],
  66: ['Lluvia helada', '🌧️'],
  67: ['Lluvia helada fuerte', '🌧️'],
  71: ['Nieve débil', '🌨️'],
  73: ['Nieve', '🌨️'],
  75: ['Nieve fuerte', '❄️'],
  77: ['Granizo fino', '🌨️'],
  80: ['Chubascos', '🌦️'],
  81: ['Chubascos fuertes', '🌧️'],
  82: ['Chubascos torrenciales', '⛈️'],
  85: ['Chubascos de nieve', '🌨️'],
  86: ['Chubascos de nieve fuertes', '❄️'],
  95: ['Tormenta', '⛈️'],
  96: ['Tormenta con granizo', '⛈️'],
  99: ['Tormenta con granizo', '⛈️'],
};

export function describeWeather(code: number): { text: string; icon: string } {
  const [text, icon] = CODES[code] ?? ['—', '🌡️'];
  return { text, icon };
}

/** Avisos de conducción derivados del tiempo actual. */
export function drivingWarnings(w: Weather): string[] {
  const out: string[] = [];
  if (w.temperature <= 3) out.push('Riesgo de hielo en la calzada');
  if (w.code === 45 || w.code === 48 || (w.visibility != null && w.visibility < 1000)) out.push('Visibilidad reducida por niebla');
  if (w.precipitation >= 2 || [65, 67, 81, 82, 95, 96, 99].includes(w.code)) out.push('Lluvia intensa: aumenta la distancia de seguridad');
  if ([71, 73, 75, 77, 85, 86].includes(w.code)) out.push('Nieve: posibles cadenas obligatorias');
  if ((w.gusts ?? w.wind) >= 60) out.push('Rachas de viento fuertes');
  return out;
}
