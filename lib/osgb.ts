/**
 * WGS84 latitude/longitude → Ordnance Survey National Grid reference.
 *
 * Traffic management drawings are dimensioned against the National Grid, not
 * lat/lon, so the readout needs a real OSGB36 grid reference rather than a
 * rough conversion. That means the full job: a Helmert transformation from the
 * WGS84 datum onto Airy 1830, then the National Grid transverse Mercator
 * projection. Accurate to roughly a metre, which is well inside what a site
 * layout needs.
 */

type Ellipsoid = { a: number; b: number };

const WGS84: Ellipsoid = { a: 6378137, b: 6356752.3142 };
const AIRY1830: Ellipsoid = { a: 6377563.396, b: 6356256.909 };

// Helmert parameters, WGS84 → OSGB36.
const TX = -446.448;
const TY = 125.157;
const TZ = -542.06;
const S = 20.4894e-6; // scale factor
const RX = degToRad(-0.1502 / 3600);
const RY = degToRad(-0.247 / 3600);
const RZ = degToRad(-0.8421 / 3600);

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function helmertToOSGB36(lat: number, lon: number) {
  const phi = degToRad(lat);
  const lambda = degToRad(lon);
  const h = 0; // height above the ellipsoid; ground level is close enough here

  const { a, b } = WGS84;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const eSq = (a * a - b * b) / (a * a);
  const nu = a / Math.sqrt(1 - eSq * sinPhi * sinPhi);

  // Geodetic → cartesian
  const x1 = (nu + h) * cosPhi * Math.cos(lambda);
  const y1 = (nu + h) * cosPhi * Math.sin(lambda);
  const z1 = ((1 - eSq) * nu + h) * sinPhi;

  // Apply the 7-parameter transformation
  const x2 = TX + x1 * (1 + S) - y1 * RZ + z1 * RY;
  const y2 = TY + x1 * RZ + y1 * (1 + S) - z1 * RX;
  const z2 = TZ - x1 * RY + y1 * RX + z1 * (1 + S);

  // Cartesian → geodetic on Airy 1830
  const { a: a2, b: b2 } = AIRY1830;
  const eSq2 = (a2 * a2 - b2 * b2) / (a2 * a2);
  const p = Math.sqrt(x2 * x2 + y2 * y2);

  let phi2 = Math.atan2(z2, p * (1 - eSq2));
  let phiPrev = 2 * Math.PI;
  let nu2 = a2;

  // Converges in a handful of passes; the guard is only there to be safe.
  for (let i = 0; i < 10 && Math.abs(phi2 - phiPrev) > 1e-12; i++) {
    nu2 = a2 / Math.sqrt(1 - eSq2 * Math.sin(phi2) * Math.sin(phi2));
    phiPrev = phi2;
    phi2 = Math.atan2(z2 + eSq2 * nu2 * Math.sin(phi2), p);
  }

  return { phi: phi2, lambda: Math.atan2(y2, x2) };
}

/** Easting/northing in metres on the OS National Grid. */
export function latLonToGrid(lat: number, lon: number) {
  const { phi, lambda } = helmertToOSGB36(lat, lon);

  const a = AIRY1830.a;
  const b = AIRY1830.b;
  const F0 = 0.9996012717;
  const phi0 = degToRad(49);
  const lambda0 = degToRad(-2);
  const N0 = -100000;
  const E0 = 400000;

  const eSq = (a * a - b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n2 * n;

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const tanPhi = Math.tan(phi);

  const nu = (a * F0) / Math.sqrt(1 - eSq * sinPhi * sinPhi);
  const rho = (a * F0 * (1 - eSq)) / Math.pow(1 - eSq * sinPhi * sinPhi, 1.5);
  const eta2 = nu / rho - 1;

  const dPhi = phi - phi0;
  const sPhi = phi + phi0;

  const M =
    b *
    F0 *
    ((1 + n + (5 / 4) * n2 + (5 / 4) * n3) * dPhi -
      (3 * n + 3 * n2 + (21 / 8) * n3) * Math.sin(dPhi) * Math.cos(sPhi) +
      ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * dPhi) * Math.cos(2 * sPhi) -
      (35 / 24) * n3 * Math.sin(3 * dPhi) * Math.cos(3 * sPhi));

  const cos3 = cosPhi * cosPhi * cosPhi;
  const cos5 = cos3 * cosPhi * cosPhi;
  const tan2 = tanPhi * tanPhi;
  const tan4 = tan2 * tan2;

  const I = M + N0;
  const II = (nu / 2) * sinPhi * cosPhi;
  const III = (nu / 24) * sinPhi * cos3 * (5 - tan2 + 9 * eta2);
  const IIIA = (nu / 720) * sinPhi * cos5 * (61 - 58 * tan2 + tan4);
  const IV = nu * cosPhi;
  const V = (nu / 6) * cos3 * (nu / rho - tan2);
  const VI = (nu / 120) * cos5 * (5 - 18 * tan2 + tan4 + 14 * eta2 - 58 * tan2 * eta2);

  const dL = lambda - lambda0;
  const dL2 = dL * dL;
  const dL3 = dL2 * dL;
  const dL4 = dL3 * dL;
  const dL5 = dL4 * dL;
  const dL6 = dL5 * dL;

  return {
    easting: E0 + IV * dL + V * dL3 + VI * dL5,
    northing: I + II * dL2 + III * dL4 + IIIA * dL6,
  };
}

// The National Grid's 100km squares, laid out as a 5x5 lettered grid.
const GRID_LETTERS = "VWXYZQRSTULMNOPFGHJKABCDE";

/**
 * Formats a grid reference at the given precision, e.g. "SJ 8394 9812".
 * `digits` is the number of digits per axis: 4 → 10m, 5 → 1m.
 */
export function gridRef(lat: number, lon: number, digits: 3 | 4 | 5 = 4): string | null {
  const { easting, northing } = latLonToGrid(lat, lon);

  // Outside the National Grid's coverage there is no valid reference.
  if (easting < 0 || easting >= 700000 || northing < 0 || northing >= 1300000) {
    return null;
  }

  const e100 = Math.floor(easting / 100000);
  const n100 = Math.floor(northing / 100000);

  // Both letters index the same 5x5 alphabet square, read from the bottom-left.
  // The grid's true origin sits two squares east and one south of that
  // alphabet's origin — which is why "S", not "A", covers the south-west of
  // Great Britain — so the 500km letter carries a fixed offset.
  const first = GRID_LETTERS[(Math.floor(n100 / 5) + 1) * 5 + Math.floor(e100 / 5) + 2];
  const second = GRID_LETTERS[(n100 % 5) * 5 + (e100 % 5)];
  if (!first || !second) return null;

  const divisor = Math.pow(10, 5 - digits);
  const e = Math.floor((easting % 100000) / divisor)
    .toString()
    .padStart(digits, "0");
  const n = Math.floor((northing % 100000) / divisor)
    .toString()
    .padStart(digits, "0");

  return `${first}${second} ${e} ${n}`;
}
