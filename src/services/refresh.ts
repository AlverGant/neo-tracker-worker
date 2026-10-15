import { Env, NEOData } from '../types';
import { writeNEOList, writeMeta, readNEOList } from '../cache';
import { fetchCADList } from './jpl-cad';
import { fetchSBDB, parseSBDB } from './jpl-sbdb';
import { fetchHorizons } from './jpl-horizons';
import { alertSubLunarNEOs } from './alerts';

const AU_TO_KM = 149597870.7;
const LD_IN_KM = 384400;

/**
 * Full cache refresh: CAD → SBDB (all) → Horizons (all) → write to KV.
 * Requires Cloudflare Workers Paid plan (1000 subrequests limit).
 * Budget: 1 CAD + 200 SBDB + 400 Horizons (2×200) + 2 KV = ~603 subrequests.
 */
export async function refreshCache(env: Env): Promise<number> {
  console.log('[Refresh] Starting full cache refresh...');

  // 1. Fetch NEO list from CAD API
  const cadRows = await fetchCADList();
  console.log(`[Refresh] CAD returned ${cadRows.length} NEOs`);

  const neos: NEOData[] = [];
  for (const row of cadRows) {
    try {
      const neo = cadRowToNEO(row);
      if (neo) neos.push(neo);
    } catch (err) {
      console.warn(`[Refresh] Failed to parse CAD row: ${err}`);
    }
  }

  console.log(`[Refresh] Parsed ${neos.length} NEOs from CAD`);

  // Telegram alert for new asteroids passing inside the Moon's orbit (best-effort)
  try {
    await alertSubLunarNEOs(env, neos);
  } catch (err) {
    console.warn(`[Refresh] Alert step failed: ${err}`);
  }

  // Sort by miss distance (closest approach first)
  neos.sort((a, b) => (a.miss_distance_ld ?? Infinity) - (b.miss_distance_ld ?? Infinity));

  // 2. Enrich ALL NEOs with SBDB data
  let sbdbSuccess = 0;
  for (const neo of neos) {
    try {
      const sbdbData = await fetchSBDB(neo.id);
      if (sbdbData) {
        const parsed = parseSBDB(sbdbData, neo.id);
        neo.orbit_class_name = parsed.orbit_class_name;
        if (parsed.is_comet) neo.is_comet = true;
        neo.diameter = parsed.diameter;
        neo.is_potentially_hazardous = parsed.is_potentially_hazardous;
        neo.moid = parsed.moid;
        neo.orbital_period = parsed.orbital_period;
        neo.eccentricity = parsed.eccentricity;
        neo.discovery_date = parsed.discovery_date;
        neo.discovery_location = parsed.discovery_location;
        neo.discoverer = parsed.discoverer;
        neo.spectral_class = parsed.spectral_class;
        neo.rotation_period = parsed.rotation_period;
        neo.first_obs = parsed.first_obs;
        sbdbSuccess++;
      }
    } catch (err) {
      console.warn(`[Refresh] SBDB failed for ${neo.name}: ${err}`);
    }
  }

  console.log(`[Refresh] SBDB enriched ${sbdbSuccess}/${neos.length} NEOs`);

  // Preserve existing Horizons data from previous cache so the
  // intermediate save below doesn't wipe RA/DEC/XYZ/velocity.
  const prevNeos = await readNEOList(env);
  if (prevNeos && prevNeos.length > 0) {
    const prevMap = new Map(prevNeos.map(n => [n.id, n]));
    for (const neo of neos) {
      const prev = prevMap.get(neo.id);
      if (prev) {
        if (neo.ra === null && prev.ra !== null) neo.ra = prev.ra;
        if (neo.dec === null && prev.dec !== null) neo.dec = prev.dec;
        if (neo.apparent_magnitude === null && prev.apparent_magnitude !== null) neo.apparent_magnitude = prev.apparent_magnitude;
        if (neo.distance_au === null && prev.distance_au !== null) neo.distance_au = prev.distance_au;
        if (neo.distance_km === null && prev.distance_km !== null) neo.distance_km = prev.distance_km;
        if (neo.x_km === null && prev.x_km !== null) neo.x_km = prev.x_km;
        if (neo.y_km === null && prev.y_km !== null) neo.y_km = prev.y_km;
        if (neo.z_km === null && prev.z_km !== null) neo.z_km = prev.z_km;
        if (neo.coords_epoch === null && prev.coords_epoch !== null) neo.coords_epoch = prev.coords_epoch;
        if (neo.velocity_x === null && prev.velocity_x !== null) neo.velocity_x = prev.velocity_x;
        if (neo.velocity_y === null && prev.velocity_y !== null) neo.velocity_y = prev.velocity_y;
        if (neo.velocity_z === null && prev.velocity_z !== null) neo.velocity_z = prev.velocity_z;
        if (neo.velocity_epoch === null && prev.velocity_epoch !== null) neo.velocity_epoch = prev.velocity_epoch;
      }
    }
    console.log(`[Refresh] Preserved Horizons data from ${prevMap.size} previous NEOs`);
  }

  // Save after SBDB (with preserved Horizons data) so data is available even if Horizons is slow
  await writeNEOList(env, neos);
  await writeMeta(env, {
    last_refresh: new Date().toISOString(),
    neo_count: neos.length,
    coords_epoch: null,
  });
  console.log(`[Refresh] Saved ${neos.length} NEOs after CAD+SBDB`);

  // 3. Fetch Horizons data (RA/DEC, 3D XYZ, velocity) for ALL NEOs
  let horizonsSuccess = 0;
  for (const neo of neos) {
    try {
      const hData = await fetchHorizons(neo.id);
      if (hData) {
        neo.ra = hData.ra;
        neo.dec = hData.dec;
        neo.apparent_magnitude = hData.apparent_magnitude;
        if (hData.distance_au !== null) {
          neo.distance_au = hData.distance_au;
          neo.distance_km = hData.distance_km;
        }
        neo.x_km = hData.x_km;
        neo.y_km = hData.y_km;
        neo.z_km = hData.z_km;
        neo.coords_epoch = hData.coords_epoch;
        neo.velocity_x = hData.velocity_x;
        neo.velocity_y = hData.velocity_y;
        neo.velocity_z = hData.velocity_z;
        neo.velocity_epoch = hData.velocity_epoch;
        horizonsSuccess++;
      }
    } catch (err) {
      console.warn(`[Refresh] Horizons failed for ${neo.name}: ${err}`);
    }

    // Throttle: 500ms between Horizons requests to avoid 503
    await sleep(500);
  }

  console.log(`[Refresh] Horizons enriched ${horizonsSuccess}/${neos.length} NEOs`);

  // 4. Write final enriched data to KV
  await writeNEOList(env, neos);
  await writeMeta(env, {
    last_refresh: new Date().toISOString(),
    neo_count: neos.length,
    coords_epoch: horizonsSuccess > 0 ? new Date().toISOString() : null,
  });

  console.log(`[Refresh] Cache refresh complete: ${neos.length} NEOs (${horizonsSuccess} with coords)`);
  return neos.length;
}

export function cadRowToNEO(row: string[]): NEOData | null {
  if (row.length < 5) return null;

  const designation = row[0]?.trim();
  if (!designation) return null;

  // Detect comets by designation: contains P/, C/, D/, or ends with P (numbered periodic)
  const isComet = /[PCD]\//.test(designation) || /^\d+P$/.test(designation);

  const missDistAu = parseFloat(row[4]);
  if (isNaN(missDistAu)) return null;

  const missDistKm = missDistAu * AU_TO_KM;
  const missDistanceLd = missDistKm / LD_IN_KM;

  const velocityRelative = row[7] && row[7] !== 'null' ? parseFloat(row[7]) : null;
  const absoluteMagnitude = row.length > 10 && row[10] && row[10] !== 'null' ? parseFloat(row[10]) : null;

  let brightness: number | null = null;
  let currentBrightness: number | null = null;
  if (absoluteMagnitude !== null) {
    const r_sun = 1.0;
    currentBrightness = absoluteMagnitude + 5 * Math.log10(missDistAu * r_sun);
    brightness = currentBrightness;
  }

  return {
    name: designation,
    id: designation,
    is_comet: isComet,
    close_approach_date: row[3] ?? '',
    miss_distance_ld: missDistanceLd,
    diameter: null,
    brightness,
    current_brightness: currentBrightness,
    first_obs: designation.match(/^(\d{4})\s/)?.[1] ?? 'Unknown',
    orbit_class_name: 'Unknown',
    velocity_relative: velocityRelative !== null && !isNaN(velocityRelative) ? velocityRelative : null,
    absolute_magnitude: absoluteMagnitude !== null && !isNaN(absoluteMagnitude) ? absoluteMagnitude : null,
    is_potentially_hazardous: null,
    moid: null,
    orbital_period: null,
    eccentricity: null,
    discovery_date: null,
    discovery_location: null,
    discoverer: null,
    spectral_class: null,
    rotation_period: null,
    ra: null,
    dec: null,
    apparent_magnitude: null,
    distance_au: null,  // Will be set by Horizons with actual current distance
    distance_km: null,  // Will be set by Horizons with actual current distance
    x_km: null,
    y_km: null,
    z_km: null,
    coords_epoch: null,
    velocity_x: null,
    velocity_y: null,
    velocity_z: null,
    velocity_epoch: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
