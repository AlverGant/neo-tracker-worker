import { Env } from '../types';
import { readMeta } from '../cache';

export async function handleHealth(env: Env): Promise<Response> {
  const meta = await readMeta(env);

  return new Response(
    JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      cache_last_refresh: meta?.last_refresh ?? null,
      cached_neo_count: meta?.neo_count ?? 0,
      coords_epoch: meta?.coords_epoch ?? null,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}
