import { Env } from '../types';
import { refreshCache } from '../services/refresh';

export async function handleCacheRefresh(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const count = await refreshCache(env);
    return new Response(
      JSON.stringify({
        message: 'Cache refreshed successfully',
        neo_count: count,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[CacheRefresh]', err);
    return new Response(
      JSON.stringify({ error: 'Cache refresh failed', detail: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
