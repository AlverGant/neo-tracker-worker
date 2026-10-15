import { Env } from './types';
import { validateAuth } from './middleware/auth';
import { handleHealth } from './routes/health';
import { handleNeos } from './routes/neos';
import { handleCacheRefresh } from './routes/cache';
import { handleAlertsCheck } from './routes/alerts';
import { refreshCache } from './services/refresh';

export default {
  /**
   * HTTP request handler
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = getCorsHeaders(request, env);

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Auth check (skips /health and /)
    const authError = validateAuth(request, env);
    if (authError) {
      // Add CORS headers to auth error responses
      for (const [k, v] of Object.entries(corsHeaders)) {
        authError.headers.set(k, v);
      }
      return authError;
    }

    // Route
    let response: Response;
    try {
      switch (url.pathname) {
        case '/':
          response = new Response(
            JSON.stringify({
              name: 'NEO Tracker API',
              version: '2.0.0',
              endpoints: ['/health', '/neos', '/cache/refresh', '/alerts/check'],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
          break;

        case '/health':
          response = await handleHealth(env);
          break;

        case '/neos':
          response = await handleNeos(env);
          break;

        case '/cache/refresh':
          response = await handleCacheRefresh(request, env);
          break;

        case '/alerts/check':
          response = await handleAlertsCheck(request, env);
          break;

        default:
          response = new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
      }
    } catch (err) {
      console.error('[Worker] Unhandled error:', err);
      response = new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Attach CORS headers
    for (const [k, v] of Object.entries(corsHeaders)) {
      response.headers.set(k, v);
    }

    return response;
  },

  /**
   * Cron trigger handler — runs every 3 hours
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[Cron] Triggered at ${new Date(controller.scheduledTime).toISOString()}`);
    ctx.waitUntil(
      refreshCache(env)
        .then(count => console.log(`[Cron] Refresh complete: ${count} NEOs`))
        .catch(err => console.error(`[Cron] Refresh failed:`, err)),
    );
  },
} satisfies ExportedHandler<Env>;

function getCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGIN || '*';

  // Support comma-separated list of allowed origins
  const allowedOrigins = allowed.split(',').map(s => s.trim());
  // Also allow Cloudflare Pages preview/deploy subdomains
  const isPagesPreview = /^https:\/\/[a-f0-9]+\.neo-radar\.pages\.dev$/.test(origin);
  const isAllowed = allowedOrigins.includes('*') || origin.includes('localhost') || allowedOrigins.includes(origin) || isPagesPreview;
  const allowOrigin = isAllowed ? origin || '*' : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}
