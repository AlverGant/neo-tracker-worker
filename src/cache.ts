import { Env, NEOData, CacheMeta } from './types';

const LIST_KEY = 'neos:list';
const META_KEY = 'neos:meta';

/** Read the full enriched NEO list from KV */
export async function readNEOList(env: Env): Promise<NEOData[] | null> {
  const raw = await env.NEO_CACHE.get(LIST_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as NEOData[];
}

/** Write the full enriched NEO list to KV */
export async function writeNEOList(env: Env, neos: NEOData[]): Promise<void> {
  await env.NEO_CACHE.put(LIST_KEY, JSON.stringify(neos));
}

/** Read cache metadata */
export async function readMeta(env: Env): Promise<CacheMeta | null> {
  const raw = await env.NEO_CACHE.get(META_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as CacheMeta;
}

/** Write cache metadata */
export async function writeMeta(env: Env, meta: CacheMeta): Promise<void> {
  await env.NEO_CACHE.put(META_KEY, JSON.stringify(meta));
}
