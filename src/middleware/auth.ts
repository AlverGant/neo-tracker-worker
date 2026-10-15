import { Env } from '../types';

/**
 * Validate Bearer Token on protected routes.
 * Returns a Response if auth fails, or null if OK.
 */
export function validateAuth(request: Request, env: Env): Response | null {
  const url = new URL(request.url);

  // /health is public
  if (url.pathname === '/health' || url.pathname === '/') {
    return null;
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.slice(7);

  // Timing-safe comparison
  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(env.API_TOKEN);
  if (a.length !== b.length || !crypto.subtle.timingSafeEqual(a, b)) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null; // Auth OK
}
