// Búsqueda de lugares: Photon (komoot) y Nominatim, ambos sobre OpenStreetMap.

export interface Place {
  id: string;
  name: string;
  /** Línea secundaria (calle, municipio, provincia). */
  detail: string;
  lat: number;
  lon: number;
  kind?: string;
}

export function photonUrl(q: string, near?: { lat: number; lon: number }): string {
  const p = new URLSearchParams({ q, limit: '8' });
  if (near) {
    p.set('lat', near.lat.toFixed(4));
    p.set('lon', near.lon.toFixed(4));
  }
  return `https://photon.komoot.io/api/?${p}`;
}

export function nominatimUrl(q: string, near?: { lat: number; lon: number }): string {
  const p = new URLSearchParams({ q, format: 'jsonv2', limit: '8', 'accept-language': 'es', addressdetails: '1' });
  if (near) {
    const d = 1.5;
    p.set('viewbox', `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`);
  }
  return `https://nominatim.openstreetmap.org/search?${p}`;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | number | undefined>;
}

export function parsePhoton(json: { features?: PhotonFeature[] }): Place[] {
  return (json.features ?? []).map((f, i) => {
    const p = f.properties;
    const street = [p.street, p.housenumber].filter(Boolean).join(' ');
    const name = String(p.name ?? (street || p.city || p.county || 'Lugar'));
    const detail = [street && street !== name ? street : null, p.postcode, p.city ?? p.town ?? p.village, p.state ?? p.county, p.country !== 'España' ? p.country : null]
      .filter(Boolean)
      .join(', ');
    return {
      id: `ph-${p.osm_type ?? ''}${p.osm_id ?? i}`,
      name,
      detail,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      kind: String(p.osm_value ?? p.type ?? ''),
    };
  });
}

export function parseNominatim(json: { place_id: number; lat: string; lon: string; display_name: string; name?: string; type?: string }[]): Place[] {
  return json.map((r) => {
    const parts = r.display_name.split(',').map((s) => s.trim());
    return {
      id: `nm-${r.place_id}`,
      name: r.name || parts[0],
      detail: parts.slice(1, 4).join(', '),
      lat: Number(r.lat),
      lon: Number(r.lon),
      kind: r.type,
    };
  });
}

/** "40.4168, -3.7038" -> coordenadas. */
export function parseCoordinates(q: string): Place | null {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(q);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { id: `xy-${lat},${lon}`, name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, detail: 'Coordenadas', lat, lon };
}
