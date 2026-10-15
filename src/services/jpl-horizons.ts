import { HorizonsResult } from '../types';

const HORIZONS_API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/**
 * Fetch geocentric RA/DEC, 3D XYZ, and velocity from JPL Horizons for one object.
 * Uses two separate queries:
 *   1) OBSERVER table for RA, DEC, apparent mag, distance
 *   2) VECTORS table for XYZ position and velocity
 *
 * Returns partial results on individual query failures.
 */
export async function fetchHorizons(designation: string): Promise<HorizonsResult | null> {
  const now = new Date();
  const start = formatDateTime(now);
  const end = formatDateTime(new Date(now.getTime() + 3600000)); // +1h

  const result: HorizonsResult = {
    ra: null,
    dec: null,
    apparent_magnitude: null,
    distance_au: null,
    distance_km: null,
    x_km: null,
    y_km: null,
    z_km: null,
    coords_epoch: null,
    velocity_x: null,
    velocity_y: null,
    velocity_z: null,
    velocity_epoch: null,
  };

  // 1) Observer ephemeris (RA, DEC, Vmag, delta)
  try {
    const observerData = await queryHorizons(designation, start, end, 'OBSERVER', '1,9,20');
    if (observerData) {
      const lines = extractDataLines(observerData);
      if (lines.length > 0) {
        const parsed = parseObserverLine(lines[0]);
        if (parsed) {
          result.ra = parsed.ra;
          result.dec = parsed.dec;
          result.apparent_magnitude = parsed.vmag;
          result.distance_au = parsed.delta;
          result.distance_km = parsed.delta !== null ? parsed.delta * 149597870.7 : null;
        }
      }
    }
  } catch (err) {
    console.warn(`[Horizons] Observer query failed for ${designation}: ${err}`);
  }

  // 2) Vectors (XYZ position and velocity)
  try {
    const vectorData = await queryHorizons(designation, start, end, 'VECTORS', '');
    if (vectorData) {
      const lines = extractDataLines(vectorData);
      if (lines.length >= 1) {
        const parsed = parseVectorLines(lines);
        if (parsed) {
          result.x_km = parsed.x;
          result.y_km = parsed.y;
          result.z_km = parsed.z;
          result.coords_epoch = now.toISOString();
          result.velocity_x = parsed.vx;
          result.velocity_y = parsed.vy;
          result.velocity_z = parsed.vz;
          result.velocity_epoch = now.toISOString();
        }
      }
    }
  } catch (err) {
    console.warn(`[Horizons] Vectors query failed for ${designation}: ${err}`);
  }

  // Return null only if we got no useful data at all
  if (result.ra === null && result.x_km === null) {
    return null;
  }

  return result;
}

async function queryHorizons(
  designation: string,
  start: string,
  end: string,
  tableType: string,
  quantities: string,
): Promise<string | null> {
  const cleanName = designation.replace(/[()]/g, '').trim();

  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${cleanName}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: tableType,
    CENTER: tableType === 'VECTORS' ? "'@399'" : "'500'", // geocentric (Earth-centered) for both
    START_TIME: `'${start}'`,
    STOP_TIME: `'${end}'`,
    STEP_SIZE: "'1 h'",
    CSV_FORMAT: 'YES',
    ANG_FORMAT: 'DEG', // Return RA/DEC in decimal degrees
  });

  if (quantities) {
    params.set('QUANTITIES', `'${quantities}'`);
  }

  if (tableType === 'VECTORS') {
    params.set('VEC_TABLE', "'3'"); // position + velocity
    params.set('OUT_UNITS', "'KM-S'");
  }

  const resp = await fetch(`${HORIZONS_API}?${params.toString()}`, {
    headers: { 'User-Agent': 'NEOTracker-Worker/1.0' },
  });

  if (!resp.ok) {
    console.warn(`[Horizons] ${tableType} HTTP ${resp.status} for ${cleanName}`);
    return null;
  }

  return await resp.text();
}

function extractDataLines(text: string): string[] {
  const lines = text.split('\n');
  let inData = false;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('$$SOE')) {
      inData = true;
      continue;
    }
    if (line.startsWith('$$EOE')) {
      break;
    }
    if (inData && line.trim()) {
      dataLines.push(line.trim());
    }
  }

  return dataLines;
}

function parseObserverLine(line: string): { ra: number; dec: number; vmag: number | null; delta: number | null } | null {
  // CSV format with empty fields: Date, , , RA, DEC, APmag, S-brt, delta, deldot
  // Filter out empty fields to get meaningful values
  const parts = line.split(',').map(s => s.trim()).filter(s => s.length > 0);
  // After filtering: [date, RA, DEC, APmag, S-brt, delta, deldot]
  if (parts.length < 3) return null;

  const ra = parseFloat(parts[1]);
  const dec = parseFloat(parts[2]);
  if (isNaN(ra) || isNaN(dec)) return null;

  let vmag: number | null = null;
  if (parts.length > 3 && parts[3] !== 'n.a.') {
    const v = parseFloat(parts[3]);
    if (!isNaN(v)) vmag = v;
  }

  let delta: number | null = null;
  if (parts.length > 5) {
    const d = parseFloat(parts[5]);
    if (!isNaN(d)) delta = d;
  }

  return { ra, dec, vmag, delta };
}

function parseVectorLines(lines: string[]): { x: number; y: number; z: number; vx: number; vy: number; vz: number } | null {
  // In CSV vector output, each time step produces one line with:
  // JDTDB, Calendar, X, Y, Z, VX, VY, VZ, LT, RG, RR
  if (lines.length < 1) return null;

  const parts = lines[0].split(',').map(s => s.trim());
  if (parts.length < 8) return null;

  const x = parseFloat(parts[2]);
  const y = parseFloat(parts[3]);
  const z = parseFloat(parts[4]);
  const vx = parseFloat(parts[5]);
  const vy = parseFloat(parts[6]);
  const vz = parseFloat(parts[7]);

  if ([x, y, z, vx, vy, vz].some(isNaN)) return null;

  return { x, y, z, vx, vy, vz };
}

function formatDateTime(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}
