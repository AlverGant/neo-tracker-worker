import { Env, NEOData } from '../types';
import { fetchSBDB, parseSBDB } from './jpl-sbdb';
import { fetchHorizons } from './jpl-horizons';

const LD_IN_KM = 384400;

const SEEN_KEY = 'alerts:seen';
const SEEN_RETENTION_DAYS = 90;
const MAX_ALERTS_PER_RUN = 10;

/** Designations already alerted, keyed by "id|close_approach_date" → ISO date when alerted */
type SeenMap = Record<string, string>;

/**
 * Alert on new asteroids (not comets) whose close approach is inside the Moon's distance (< 1 LD).
 * Runs on every refresh with the raw CAD list, so it does not depend on the slow enrichment steps.
 * Dedupes via KV so each (object, approach) pair is announced once.
 */
export async function alertSubLunarNEOs(env: Env, neos: NEOData[]): Promise<number> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log('[Alerts] Telegram not configured, skipping');
    return 0;
  }

  const candidates = neos.filter(n => !n.is_comet && n.miss_distance_ld < 1);
  if (candidates.length === 0) return 0;

  const seen = (await readSeen(env)) ?? {};
  const fresh = candidates.filter(n => !(alertKey(n) in seen));
  console.log(`[Alerts] ${candidates.length} sub-lunar, ${fresh.length} new`);
  if (fresh.length === 0) return 0;

  let sent = 0;
  for (const neo of fresh.slice(0, MAX_ALERTS_PER_RUN)) {
    try {
      // Approach already happened: only alert if the object is still inside the Moon's distance right now
      const approach = parseCadDate(neo.close_approach_date);
      let currentLd: number | null = null;
      if (approach && approach.getTime() < Date.now()) {
        currentLd = await currentDistanceLd(neo, approach);
        if (currentLd === null || currentLd >= 1) {
          console.log(`[Alerts] ${neo.id} already passed, now at ${currentLd?.toFixed(2) ?? '?'} LD, skipping`);
          seen[alertKey(neo)] = new Date().toISOString();
          continue;
        }
      }

      // Enrich just this one object so the message has discovery info and size
      let discoveryDate: string | null = null;
      let discoveryLocation: string | null = null;
      let diameter: number | null = null;
      let pha: boolean | null = null;
      try {
        const sbdb = await fetchSBDB(neo.id);
        if (sbdb) {
          const p = parseSBDB(sbdb, neo.id);
          discoveryDate = p.discovery_date;
          discoveryLocation = p.discovery_location;
          diameter = p.diameter;
          pha = p.is_potentially_hazardous;
        }
      } catch (err) {
        console.warn(`[Alerts] SBDB failed for ${neo.id}: ${err}`);
      }

      const text = formatMessage(neo, { discoveryDate, discoveryLocation, diameter, pha, currentLd });
      const ok = await sendTelegram(env, text);
      if (ok) {
        seen[alertKey(neo)] = new Date().toISOString();
        sent++;
      }
    } catch (err) {
      console.warn(`[Alerts] Failed for ${neo.id}: ${err}`);
    }
  }

  await writeSeen(env, pruneSeen(seen));
  console.log(`[Alerts] Sent ${sent} Telegram alert(s)`);
  return sent;
}

function alertKey(neo: NEOData): string {
  // close_approach_date looks like "2026-Oct-18 04:12"; key on the day so tiny time refinements don't re-alert
  const day = neo.close_approach_date.split(' ')[0];
  return `${neo.id}|${day}`;
}

function formatMessage(
  neo: NEOData,
  extra: { discoveryDate: string | null; discoveryLocation: string | null; diameter: number | null; pha: boolean | null; currentLd: number | null },
): string {
  const ld = neo.miss_distance_ld;
  const km = Math.round(ld * 384400);
  const earthRadii = (km / 6371).toFixed(1);
  const approach = parseCadDate(neo.close_approach_date);
  const when = approach
    ? approach.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : neo.close_approach_date;
  const passed = approach ? approach.getTime() < Date.now() : false;

  let size: string;
  if (extra.diameter !== null && extra.diameter > 0) {
    size = `${fmtMeters(extra.diameter * 1000)} (medido)`;
  } else if (neo.absolute_magnitude !== null) {
    // D(km) = 1329 / sqrt(albedo) * 10^(-H/5); albedo range 0.05–0.25
    const h = neo.absolute_magnitude;
    const dBright = 1329 / Math.sqrt(0.25) * Math.pow(10, -h / 5);
    const dDark = 1329 / Math.sqrt(0.05) * Math.pow(10, -h / 5);
    size = `${fmtMeters(dBright * 1000)} a ${fmtMeters(dDark * 1000)} (estimado, H=${h.toFixed(1)})`;
  } else {
    size = 'desconhecido';
  }

  const lines = [
    `☄️ *Asteroide mais perto que a Lua*`,
    ``,
    `*${escapeMd(neo.name)}*`,
    `Distância mínima: *${ld.toFixed(3)} LD* (${km.toLocaleString('pt-BR')} km, ${earthRadii} raios terrestres)`,
    `Aproximação: ${when} (BRT)${passed ? ' — já passou' : ''}`,
  ];
  if (passed && extra.currentLd !== null) {
    lines.push(`Distância agora: *${extra.currentLd.toFixed(3)} LD* (${Math.round(extra.currentLd * LD_IN_KM).toLocaleString('pt-BR')} km), ainda mais perto que a Lua`);
  }
  lines.push(`Tamanho: ${size}`);
  if (neo.velocity_relative !== null) lines.push(`Velocidade relativa: ${neo.velocity_relative.toFixed(1)} km/s`);
  if (extra.discoveryDate) {
    lines.push(`Descoberto: ${escapeMd(extra.discoveryDate)}${extra.discoveryLocation ? ` — ${escapeMd(extra.discoveryLocation)}` : ''}`);
  }
  if (extra.pha) lines.push(`⚠️ Classificado como potencialmente perigoso (PHA)`);
  lines.push(``, `[Ver no JPL](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(neo.id)})`, `_NEO Tracker_`);
  return lines.join('\n');
}

/**
 * Current geocentric distance in lunar distances. Horizons first; if it fails,
 * a flyby estimate: the object recedes at roughly v_rel along a line offset by the miss distance.
 */
async function currentDistanceLd(neo: NEOData, approach: Date): Promise<number | null> {
  try {
    const h = await fetchHorizons(neo.id);
    if (h && h.distance_km !== null) return h.distance_km / LD_IN_KM;
  } catch (err) {
    console.warn(`[Alerts] Horizons failed for ${neo.id}: ${err}`);
  }
  if (neo.velocity_relative === null) return null;
  const dtSec = (Date.now() - approach.getTime()) / 1000;
  const missKm = neo.miss_distance_ld * LD_IN_KM;
  const alongKm = neo.velocity_relative * dtSec;
  return Math.sqrt(missKm * missKm + alongKm * alongKm) / LD_IN_KM;
}

function fmtMeters(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, '\\$1');
}

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** CAD "cd" field: "2026-Oct-18 04:12" (UTC) */
function parseCadDate(s: string): Date | null {
  const m = s.match(/^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return null;
  const mon = MONTHS[m[2]];
  if (mon === undefined) return null;
  return new Date(Date.UTC(+m[1], mon, +m[3], +m[4], +m[5]));
}

async function sendTelegram(env: Env, text: string): Promise<boolean> {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown', disable_web_page_preview: true }),
  });
  if (!resp.ok) {
    console.warn(`[Alerts] Telegram HTTP ${resp.status}: ${await resp.text()}`);
    return false;
  }
  return true;
}

async function readSeen(env: Env): Promise<SeenMap | null> {
  const raw = await env.NEO_CACHE.get(SEEN_KEY);
  return raw ? (JSON.parse(raw) as SeenMap) : null;
}

async function writeSeen(env: Env, seen: SeenMap): Promise<void> {
  await env.NEO_CACHE.put(SEEN_KEY, JSON.stringify(seen));
}

function pruneSeen(seen: SeenMap): SeenMap {
  const cutoff = Date.now() - SEEN_RETENTION_DAYS * 86400000;
  const out: SeenMap = {};
  for (const [k, v] of Object.entries(seen)) {
    if (new Date(v).getTime() >= cutoff) out[k] = v;
  }
  return out;
}
