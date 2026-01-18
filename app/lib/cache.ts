import { createClient } from 'redis';

/**
 * Cache utility for Redis
 * Provides caching for Merkl campaigns, opportunities, TVL, and volume data
 */

// Create Redis client singleton
let redisClient: ReturnType<typeof createClient> | null = null;

/**
 * Get or create Redis client
 */
async function getRedisClient() {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is not set');
  }

  redisClient = createClient({
    url: redisUrl,
  });

  redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
  });

  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  return redisClient;
}

// Cache TTLs (in seconds)
const CACHE_TTL = {
  MERKL_CAMPAIGNS: 21600,           // 6 hours - campaigns change infrequently
  MERKL_OPPORTUNITIES: 21600,       // 6 hours - opportunities change infrequently
  DEFILLAMA_TVL_CURRENT: 21600,    // 6 hours - current TVL changes slowly
  DEFILLAMA_TVL_HISTORICAL: 2592000, // 30 days - historical TVL never changes
  DUNE_VOLUME: 2592000,             // 30 days - volumes are historical and never change
  MERKL_CAMPAIGNS_HISTORICAL: 2592000, // 30 days - historical campaigns never change
};

/**
 * Get cached value
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const client = await getRedisClient();
    const value = await client.get(key);
    if (value === null) {
      return null;
    }
    // Parse JSON if it's a string, otherwise return as-is
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  } catch (error) {
    console.error(`Cache get error for key ${key}:`, error);
    return null;
  }
}

/**
 * Set cached value with TTL
 */
export async function setCache<T>(key: string, value: T, ttl: number): Promise<void> {
  try {
    const client = await getRedisClient();
    // Serialize value to JSON string
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await client.setEx(key, ttl, serialized);
  } catch (error) {
    console.error(`Cache set error for key ${key}:`, error);
    // Don't throw - caching failures shouldn't break the app
  }
}

/**
 * Generate cache keys
 */
export const CacheKeys = {
  merklCampaigns: (protocolId: string, page: number) => 
    `merkl:campaigns:monad:${protocolId}:page:${page}`,
  
  merklOpportunities: (page: number) => 
    `merkl:opportunities:monad:page:${page}`,
  
  defillamaTVL: (protocolSlug: string, date: string) => 
    `defillama:tvl:${protocolSlug}:${date}`,
  
  duneVolume: (queryId: number, tokenPair: string | null) => 
    `dune:volume:${queryId}:${tokenPair || 'all'}`,
};

/**
 * Cache Merkl campaigns
 * @param isHistorical - If true, uses longer TTL (30 days) for historical date ranges
 */
export async function cacheMerklCampaigns(
  protocolId: string,
  page: number,
  campaigns: any[],
  isHistorical: boolean = false
): Promise<void> {
  const key = CacheKeys.merklCampaigns(protocolId, page);
  const ttl = isHistorical ? CACHE_TTL.MERKL_CAMPAIGNS_HISTORICAL : CACHE_TTL.MERKL_CAMPAIGNS;
  await setCache(key, campaigns, ttl);
}

/**
 * Get cached Merkl campaigns
 */
export async function getCachedMerklCampaigns(
  protocolId: string,
  page: number
): Promise<any[] | null> {
  const key = CacheKeys.merklCampaigns(protocolId, page);
  return await getCache<any[]>(key);
}

/**
 * Cache Merkl opportunities
 */
export async function cacheMerklOpportunities(
  page: number,
  opportunities: any[]
): Promise<void> {
  const key = CacheKeys.merklOpportunities(page);
  await setCache(key, opportunities, CACHE_TTL.MERKL_OPPORTUNITIES);
}

/**
 * Get cached Merkl opportunities
 */
export async function getCachedMerklOpportunities(
  page: number
): Promise<any[] | null> {
  const key = CacheKeys.merklOpportunities(page);
  return await getCache<any[]>(key);
}

/**
 * Cache DeFiLlama TVL
 * @param isHistorical - If true, uses longer TTL (30 days) since historical data never changes
 */
export async function cacheDefillamaTVL(
  protocolSlug: string,
  date: string,
  tvl: number,
  isHistorical: boolean = false
): Promise<void> {
  const key = CacheKeys.defillamaTVL(protocolSlug, date);
  const ttl = isHistorical ? CACHE_TTL.DEFILLAMA_TVL_HISTORICAL : CACHE_TTL.DEFILLAMA_TVL_CURRENT;
  await setCache(key, tvl, ttl);
}

/**
 * Get cached DeFiLlama TVL
 */
export async function getCachedDefillamaTVL(
  protocolSlug: string,
  date: string
): Promise<number | null> {
  const key = CacheKeys.defillamaTVL(protocolSlug, date);
  return await getCache<number>(key);
}

/**
 * Cache Dune volume
 */
export async function cacheDuneVolume(
  queryId: number,
  tokenPair: string | null,
  volumeData: any
): Promise<void> {
  const key = CacheKeys.duneVolume(queryId, tokenPair);
  await setCache(key, volumeData, CACHE_TTL.DUNE_VOLUME);
}

/**
 * Get cached Dune volume
 */
export async function getCachedDuneVolume(
  queryId: number,
  tokenPair: string | null
): Promise<any | null> {
  const key = CacheKeys.duneVolume(queryId, tokenPair);
  return await getCache<any>(key);
}
