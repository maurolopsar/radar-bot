// Conversión UTM -> latitud/longitud (series de Krüger, precisión submilimétrica).
// ETRS89 (EPSG:258xx) y WGS84 son equivalentes a efectos de este uso.

const a = 6378137;
const f = 1 / 298.257223563;
const k0 = 0.9996;
const e = Math.sqrt(f * (2 - f));
const n = f / (2 - f);
const n2 = n * n;
const n3 = n2 * n;
const A = (a / (1 + n)) * (1 + n2 / 4 + (n2 * n2) / 64);
const beta = [n / 2 - (2 / 3) * n2 + (37 / 96) * n3, (1 / 48) * n2 + (1 / 15) * n3, (17 / 480) * n3];

export function utmToLatLon(easting: number, northing: number, zone: number, northern = true): { lat: number; lon: number } {
  const x = easting - 500_000;
  const y = northern ? northing : northing - 10_000_000;
  const η = x / (k0 * A);
  const ξ = y / (k0 * A);

  let ξp = ξ;
  let ηp = η;
  for (let j = 1; j <= 3; j++) {
    ξp -= beta[j - 1] * Math.sin(2 * j * ξ) * Math.cosh(2 * j * η);
    ηp -= beta[j - 1] * Math.cos(2 * j * ξ) * Math.sinh(2 * j * η);
  }
  const sinhηp = Math.sinh(ηp);
  const sinξp = Math.sin(ξp);
  const cosξp = Math.cos(ξp);
  const τp = sinξp / Math.sqrt(sinhηp * sinhηp + cosξp * cosξp);

  let τi = τp;
  for (let iter = 0; iter < 10; iter++) {
    const σi = Math.sinh(e * Math.atanh((e * τi) / Math.sqrt(1 + τi * τi)));
    const τip = τi * Math.sqrt(1 + σi * σi) - σi * Math.sqrt(1 + τi * τi);
    const δτi =
      ((τp - τip) / Math.sqrt(1 + τip * τip)) *
      ((1 + (1 - e * e) * τi * τi) / ((1 - e * e) * Math.sqrt(1 + τi * τi)));
    τi += δτi;
    if (Math.abs(δτi) < 1e-12) break;
  }
  const φ = Math.atan(τi);
  const λ = Math.atan2(sinhηp, cosξp);
  const λ0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  return { lat: (φ * 180) / Math.PI, lon: ((λ + λ0) * 180) / Math.PI };
}
