import { Env, NEOData } from '../types';
import { fetchCADList } from '../services/jpl-cad';
import { cadRowToNEO } from '../services/refresh';
import { alertSubLunarNEOs } from '../services/alerts';

/** POST /alerts/check — fetch CAD only and send Telegram alerts for new sub-lunar asteroids (cheap, for manual tests) */
export async function handleAlertsCheck(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const rows = await fetchCADList();
    const neos: NEOData[] = [];
    for (const row of rows) {
      const neo = cadRowToNEO(row);
      if (neo) neos.push(neo);
    }
    const subLunar = neos.filter(n => !n.is_comet && n.miss_distance_ld < 1).map(n => ({
      id: n.id, close_approach_date: n.close_approach_date, miss_distance_ld: +n.miss_distance_ld.toFixed(3),
    }));
    const sent = await alertSubLunarNEOs(env, neos);
    return new Response(JSON.stringify({ sub_lunar: subLunar, alerts_sent: sent }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Alert check failed', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
