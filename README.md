# NEO Tracker Worker

Cloudflare Worker that backs the [NEO Tracker](https://github.com/AlverGant/neo-tracker) mobile app. It pulls near-Earth object data from NASA JPL, enriches it, caches it in Workers KV, and sends a Telegram alert whenever a newly listed asteroid passes closer to Earth than the Moon.

It replaces the earlier FastAPI service ([neo-tracker-api](https://github.com/AlverGant/neo-tracker-api)) with no server to run: a cron trigger refreshes the cache every 3 hours and the API serves straight from KV.

Live endpoint: `https://neo-tracker-api.alvaro-antelo.workers.dev`

## How it works

```
cron (every 3h)
  └─ refreshCache
       1. JPL CAD        close approaches, 7 days back to 30 days ahead, < 1 AU, up to 200 objects
       2. Telegram alert new asteroids with miss distance < 1 LD (see below)
       3. JPL SBDB       orbit class, diameter, PHA flag, MOID, discovery info, spectral class
          → first KV write (keeps previous Horizons data so the app never loses coordinates)
       4. JPL Horizons   geocentric RA/Dec, apparent magnitude, distance, XYZ position and velocity
          → final KV write
```

Data sources, all public and keyless:

| Source | Used for |
|---|---|
| [CAD API](https://ssd-api.jpl.nasa.gov/doc/cad.html) | list of close approaches, miss distance, relative velocity, H magnitude |
| [SBDB API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html) | physical and orbital parameters, discovery circumstances |
| [Horizons API](https://ssd.jpl.nasa.gov/horizons/app.html) | current geocentric coordinates and state vectors |

A full refresh is about 600 subrequests (1 CAD + 200 SBDB + 400 Horizons), so the Worker needs the Workers Paid plan. Horizons calls are throttled to one every 500 ms.

## Telegram alerts

On every refresh the Worker looks for asteroids (comets are excluded) whose close approach is inside one lunar distance (384,400 km). Each object is announced once per approach day; the set of announced objects lives in KV under `alerts:seen` and is pruned after 90 days. At most 10 alerts go out per run.

Because small asteroids are often discovered only after their flyby, the CAD window also looks 7 days back. For an approach that already happened, the Worker asks Horizons for the object's current distance and only alerts if it is still inside 1 LD. Otherwise the object is marked as seen silently. If Horizons is unavailable, a flyby estimate is used instead (miss distance plus relative velocity times the elapsed time).

Each message includes the designation, miss distance in LD, km and Earth radii, approach time in BRT, current distance when the approach is past, measured or H-estimated size, relative velocity, discovery date and site, a PHA warning when applicable, and a link to the JPL Small-Body Database.

Alerts are optional: without the two Telegram secrets the step is skipped.

## API

All responses are JSON. Routes other than `/` and `/health` require `Authorization: Bearer <API_TOKEN>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | no | Name, version and route list |
| GET | `/health` | no | Status, last refresh time, cached object count, coordinates epoch |
| GET | `/neos` | yes | Full cached list: `{ total_count, last_update, neos: NEOData[] }`. Returns 503 while the cache is empty |
| POST | `/cache/refresh` | yes | Runs a full refresh synchronously (slow, several minutes) |
| POST | `/alerts/check` | yes | Fetches CAD only and sends any pending Telegram alerts. Cheap, meant for manual tests |

The `NEOData` shape is in [`src/types.ts`](src/types.ts). Distances in `miss_distance_ld` are lunar distances; `distance_km` and `x_km`/`y_km`/`z_km` are geocentric and current as of `coords_epoch`.

CORS is allowed for the origins in `ALLOWED_ORIGIN`, any `*.neo-radar.pages.dev` preview, and localhost.

## Configuration

`wrangler.toml` holds the non-secret settings:

- `NEO_CACHE`: KV namespace binding (keys `neos:list`, `neos:meta`, `alerts:seen`)
- `ALLOWED_ORIGIN`: comma-separated list of allowed CORS origins
- `triggers.crons`: `0 */3 * * *`

Secrets, set with `npx wrangler secret put <NAME>`:

| Secret | Required | Purpose |
|---|---|---|
| `API_TOKEN` | yes | Bearer token for the protected routes |
| `TELEGRAM_BOT_TOKEN` | no | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | no | Chat that receives the alerts |

For local development put the same names in a `.dev.vars` file (ignored by git).

## Development

```bash
npm install
npm run dev        # wrangler dev, local KV
npx tsc --noEmit   # type check
npm run deploy     # wrangler deploy
npm run tail       # live logs from the deployed Worker
```

Manual checks against the deployed Worker:

```bash
curl https://neo-tracker-api.alvaro-antelo.workers.dev/health

curl -X POST -H "Authorization: Bearer $API_TOKEN" \
  https://neo-tracker-api.alvaro-antelo.workers.dev/alerts/check

# Forget every announced object so the next check re-sends alerts
npx wrangler kv key delete --remote --namespace-id <id> 'alerts:seen'
```

## Project layout

```
src/
  index.ts              fetch + scheduled handlers, routing, CORS
  types.ts              Env bindings and data shapes
  cache.ts              KV read/write helpers
  middleware/auth.ts    Bearer token check (timing-safe)
  routes/               health, neos, cache refresh, alerts check
  services/
    jpl-cad.ts          CAD close-approach list
    jpl-sbdb.ts         SBDB fetch and parsing
    jpl-horizons.ts     Horizons observer and vector tables
    refresh.ts          Full refresh pipeline
    alerts.ts           Sub-lunar asteroid Telegram alerts
```
