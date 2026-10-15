import { SBDBResponse } from '../types';

const SBDB_API = 'https://ssd-api.jpl.nasa.gov/sbdb.api';

/** Extract discovery year from designation like "2026 CR2" → "2026" */
function extractYearFromDesignation(des?: string | null): string | null {
  if (!des) return null;
  const match = des.match(/^(\d{4})\s/);
  return match ? match[1] : null;
}

/**
 * Fetch orbital & physical data for one object from SBDB.
 * Returns null on failure (non-fatal — we still have CAD data).
 */
export async function fetchSBDB(designation: string): Promise<SBDBResponse | null> {
  const url = new URL(SBDB_API);
  url.searchParams.set('sstr', designation.trim());
  url.searchParams.set('phys-par', 'true');
  url.searchParams.set('discovery', 'true');

  try {
    const resp = await fetch(url.toString(), {
      headers: { 'User-Agent': 'NEOTracker-Worker/1.0' },
    });

    if (!resp.ok) {
      console.warn(`[SBDB] ${designation}: HTTP ${resp.status}`);
      return null;
    }

    return (await resp.json()) as SBDBResponse;
  } catch (err) {
    console.warn(`[SBDB] ${designation}: ${err}`);
    return null;
  }
}

/** Extract fields we need from SBDB response */
export function parseSBDB(data: SBDBResponse, designation?: string) {
  const orbitClassName = data.object?.orbit_class?.name ?? 'Unknown';

  // Extract physical parameters
  const physMap = new Map<string, string>();
  if (data.phys_par) {
    for (const p of data.phys_par) {
      physMap.set(p.name, p.value);
    }
  }

  // Extract orbital elements
  const elemMap = new Map<string, string>();
  if (data.orbit?.elements) {
    for (const e of data.orbit.elements) {
      elemMap.set(e.name, e.value);
    }
  }

  const diameter = physMap.get('diameter') ? parseFloat(physMap.get('diameter')!) : null;
  const rotationPeriod = physMap.get('rot_per') ? parseFloat(physMap.get('rot_per')!) : null;
  const spectralClass = physMap.get('spec_T') || physMap.get('spec_B') || null;

  const eccentricity = elemMap.get('e') ? parseFloat(elemMap.get('e')!) : null;
  const orbitalPeriod = elemMap.get('per') ? parseFloat(elemMap.get('per')!) : null; // SBDB returns period in days
  const moid = elemMap.get('moid') ? parseFloat(elemMap.get('moid')!) : null;

  // PHA flag: SBDB returns it as boolean in object.pha (not in phys_par)
  const isPotentiallyHazardous = data.object?.pha === true;

  // Comet detection: kind 'cn' or 'cu', or prefix P/C/D
  const kind = data.object?.kind;
  const isComet = kind === 'cn' || kind === 'cu' || !!data.object?.prefix;

  return {
    is_comet: isComet,
    orbit_class_name: orbitClassName,
    diameter,
    rotation_period: rotationPeriod,
    spectral_class: spectralClass,
    eccentricity,
    orbital_period: orbitalPeriod,
    moid,
    is_potentially_hazardous: isPotentiallyHazardous,
    discovery_date: data.discovery?.date ?? null,
    discovery_location: data.discovery?.location ?? null,
    discoverer: data.discovery?.who ?? null,
    first_obs: data.discovery?.date ?? extractYearFromDesignation(designation || data.object?.des) ?? 'Unknown',
  };
}
