import { Env, NEOListResponse } from '../types';
import { readNEOList, readMeta } from '../cache';

export async function handleNeos(env: Env): Promise<Response> {
  const [neos, meta] = await Promise.all([readNEOList(env), readMeta(env)]);

  if (!neos) {
    return new Response(
      JSON.stringify({ error: 'Cache is empty. Trigger /cache/refresh or wait for cron.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const body: NEOListResponse = {
    total_count: neos.length,
    last_update: meta?.last_refresh ?? new Date().toISOString(),
    neos,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
