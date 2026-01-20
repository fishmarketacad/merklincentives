import { Redis } from '@upstash/redis';

/**
 * Cache utility for Redis using Upstash SDK
 * Provides caching for Merkl campaigns, opportunities, TVL, and volume data
 * Uses REST API - perfect for serverless environments
 */

// Initialize Redis client (reads from UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN)
// Falls back to KV_REST_API_URL and KV_REST_API_TOKEN if Upstash env vars not found
let redisClient: Redis | null = null;

/**
 * Get Redis client instance
 * Returns null if Upstash credentials are not available
 */
function getRedisClient(): Redis | null {
  // Check if client already initialized
  if (redisClient) {
    return redisClient;
  }

  // Check for Upstash environment variables
  // Upstash SDK looks for: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
  // Or: KV_REST_API_URL and KV_REST_API_TOKEN (Vercel KV naming)
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!upstashUrl || !upstashToken) {
    console.log('[Cache] Redis disabled - Upstash env vars not set. Caching skipped, app will work normally.');
    return null;
  }

  try {
    // Initialize Upstash Redis client manually (supports both naming conventions)
    // Uses REST API - no connection needed, perfect for serverless
    redisClient = new Redis({
      url: upstashUrl,
      token: upstashToken,
    });
    console.log('[Cache] Upstash Redis client initialized');
    return redisClient;
  } catch (error: any) {
    console.error('[Cache] Failed to initialize Upstash Redis:', error.message || error);
    return null;
  }
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
 * Upstash SDK automatically handles JSON serialization/deserialization
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient();
    if (!client) {
      // Redis not available, return null (cache miss)
      return null;
    }
    const value = await client.get<T>(key);
    return value;
  } catch (error) {
    console.error(`Cache get error for key ${key}:`, error);
    return null; // Graceful fallback - return null on error
  }
}

/**
 * Set cached value with TTL
 * Upstash SDK automatically handles JSON serialization
 */
export async function setCache<T>(key: string, value: T, ttl: number): Promise<void> {
  try {
    const client = getRedisClient();
    if (!client) {
      // Redis not available, silently skip caching
      return;
    }
    // Upstash SDK handles JSON automatically
    // Use set with ex option for expiration (ttl in seconds)
    await client.set(key, value, { ex: ttl });
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
  
  merklCampaignDetails: (campaignId: string) => 
    `merkl:campaign:details:${campaignId}`,
  
  merklCampaignMetrics: (campaignId: string) => 
    `merkl:campaign:metrics:${campaignId}`,
  
  merklOpportunity: (opportunityId: string) => 
    `merkl:opportunity:${opportunityId}`,
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

/**
 * Cache Merkl campaign details
 */
export async function cacheMerklCampaignDetails(
  campaignId: string,
  details: any,
  isHistorical: boolean = false
): Promise<void> {
  const key = CacheKeys.merklCampaignDetails(campaignId);
  const ttl = isHistorical ? CACHE_TTL.MERKL_CAMPAIGNS_HISTORICAL : CACHE_TTL.MERKL_CAMPAIGNS;
  await setCache(key, details, ttl);
}

/**
 * Get cached Merkl campaign details
 */
export async function getCachedMerklCampaignDetails(
  campaignId: string
): Promise<any | null> {
  const key = CacheKeys.merklCampaignDetails(campaignId);
  return await getCache<any>(key);
}

/**
 * Cache Merkl campaign metrics
 */
export async function cacheMerklCampaignMetrics(
  campaignId: string,
  metrics: any,
  isHistorical: boolean = false
): Promise<void> {
  const key = CacheKeys.merklCampaignMetrics(campaignId);
  const ttl = isHistorical ? CACHE_TTL.MERKL_CAMPAIGNS_HISTORICAL : CACHE_TTL.MERKL_CAMPAIGNS;
  await setCache(key, metrics, ttl);
}

/**
 * Get cached Merkl campaign metrics
 */
export async function getCachedMerklCampaignMetrics(
  campaignId: string
): Promise<any | null> {
  const key = CacheKeys.merklCampaignMetrics(campaignId);
  return await getCache<any>(key);
}

/**
 * Cache Merkl opportunity
 */
export async function cacheMerklOpportunity(
  opportunityId: string,
  opportunity: any,
  isHistorical: boolean = false
): Promise<void> {
  const key = CacheKeys.merklOpportunity(opportunityId);
  const ttl = isHistorical ? CACHE_TTL.MERKL_OPPORTUNITIES : CACHE_TTL.MERKL_OPPORTUNITIES;
  await setCache(key, opportunity, ttl);
}

/**
 * Get cached Merkl opportunity
 */
export async function getCachedMerklOpportunity(
  opportunityId: string
): Promise<any | null> {
  const key = CacheKeys.merklOpportunity(opportunityId);
  return await getCache<any>(key);
}
