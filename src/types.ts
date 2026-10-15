/** Cloudflare Worker environment bindings */
export interface Env {
  NEO_CACHE: KVNamespace;
  API_TOKEN: string;
  ALLOWED_ORIGIN: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

/** Enriched NEO data stored in KV */
export interface NEOData {
  name: string;
  id: string;
  close_approach_date: string;
  miss_distance_ld: number;
  diameter: number | null;
  brightness: number | null;
  current_brightness: number | null;
  first_obs: string;
  orbit_class_name: string;

  is_comet: boolean;

  // CAD API fields
  velocity_relative: number | null;
  absolute_magnitude: number | null;

  // SBDB API fields
  is_potentially_hazardous: boolean | null;
  moid: number | null;
  orbital_period: number | null;
  eccentricity: number | null;
  discovery_date: string | null;
  discovery_location: string | null;
  discoverer: string | null;
  spectral_class: string | null;
  rotation_period: number | null;

  // Geocentric coordinates (from Horizons)
  ra: number | null;
  dec: number | null;
  apparent_magnitude: number | null;
  distance_au: number | null;
  distance_km: number | null;

  // 3D heliocentric coordinates
  x_km: number | null;
  y_km: number | null;
  z_km: number | null;
  coords_epoch: string | null;

  // Velocity vectors (km/s)
  velocity_x: number | null;
  velocity_y: number | null;
  velocity_z: number | null;
  velocity_epoch: string | null;
}

/** Response shape returned by GET /neos */
export interface NEOListResponse {
  total_count: number;
  last_update: string;
  neos: NEOData[];
}

/** Cache metadata stored in KV at neos:meta */
export interface CacheMeta {
  last_refresh: string;
  neo_count: number;
  coords_epoch: string | null;
}

/** Raw row from NASA CAD API */
export type CADRow = string[];

/** SBDB API response shape (subset we use) */
export interface SBDBResponse {
  object?: {
    des?: string;
    orbit_class?: { name?: string };
    spkid?: string;
    pha?: boolean;
    neo?: boolean;
    kind?: string; // 'cn'|'cu' = comet, 'an'|'au' = asteroid
    prefix?: string | null; // 'P','C','D' for comets, null for asteroids
  };
  orbit?: {
    elements?: Array<{ name: string; value: string }>;
    epoch?: string;
  };
  phys_par?: Array<{ name: string; value: string }>;
  discovery?: {
    date?: string;
    location?: string;
    who?: string;
  };
}

/** Horizons API parsed result for one object */
export interface HorizonsResult {
  ra: number | null;
  dec: number | null;
  apparent_magnitude: number | null;
  distance_au: number | null;
  distance_km: number | null;
  x_km: number | null;
  y_km: number | null;
  z_km: number | null;
  coords_epoch: string | null;
  velocity_x: number | null;
  velocity_y: number | null;
  velocity_z: number | null;
  velocity_epoch: string | null;
}
