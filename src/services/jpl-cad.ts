import { CADRow } from '../types';

const CAD_API = 'https://ssd-api.jpl.nasa.gov/cad.api';

/**
 * Fetch close-approach data from NASA JPL CAD API.
 * Returns raw rows: [des, orbit_id, jd, cd, dist, dist_min, dist_max, v_rel, v_inf, t_sigma_f, h]
 */
export async function fetchCADList(
  totalDays = 30,
  distMaxAu = 1.0,
  lookbackDays = 7,
): Promise<CADRow[]> {
  const now = new Date();
  const start = new Date(now.getTime() - lookbackDays * 86400000);
  const end = new Date(now.getTime() + totalDays * 86400000);

  const dateMin = formatDate(start);
  const dateMax = formatDate(end);

  const url = new URL(CAD_API);
  url.searchParams.set('date-min', dateMin);
  url.searchParams.set('date-max', dateMax);
  url.searchParams.set('dist-max', distMaxAu.toString());
  url.searchParams.set('sort', 'dist');
  url.searchParams.set('limit', '200');
  url.searchParams.set('nea-comet', 'true'); // Include both NEAs and comets

  console.log(`[CAD] Fetching: ${url.toString()}`);

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': 'NEOTracker-Worker/1.0' },
  });

  if (!resp.ok) {
    throw new Error(`CAD API returned ${resp.status}: ${await resp.text()}`);
  }

  const json = (await resp.json()) as { count: string; data: CADRow[] };
  console.log(`[CAD] Got ${json.count} results`);
  return json.data || [];
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}
