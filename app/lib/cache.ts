import { Redis } from '@upstash/redis';

/**
 * Cache utility for Redis using Upstash SDK
 * Provides caching for Merkl campaigns, opportunities, TVL, and volume data
 * Uses REST API - perfect for serverless environments
 */

// Initialize Redis client (reads from UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN)
// Falls back to KV_REST_API_URL and KV_REST_API_TOKEN if Upstash env vars not found
let redisClient: Redis | null = null;
let redisInitialized = false; // Track if we've already tried to initialize
let hasLoggedDisabled = false; // Track if we've already logged the disabled message

/**
 * Get Redis client instance
 * Returns null if Upstash credentials are not available
 */
function getRedisClient(): Redis | null {
  // Check if client already initialized (either successfully or determined to be unavailable)
  if (redisInitialized) {
    return redisClient;
  }

  // Check for Upstash environment variables
  // Upstash SDK looks for: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
  // Or: KV_REST_API_URL and KV_REST_API_TOKEN (Vercel KV naming)
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!upstashUrl || !upstashToken) {
    if (!hasLoggedDisabled) {
      console.log('[Cache] Redis disabled - Upstash env vars not set. Caching skipped, app will work normally.');
      hasLoggedDisabled = true;
    }
    redisInitialized = true;
    return null;
  }

  try {
    // Initialize Upstash Redis client manually (supports both naming conventions)
    // Uses REST API - no connection needed, perfect for serverless
    redisClient = new Redis({
      url: upstashUrl,
      token: upstashToken,
    });
    redisInitialized = true;
    console.log('[Cache] Upstash Redis client initialized');
    return redisClient;
  } catch (error: any) {
    console.error('[Cache] Failed to initialize Upstash Redis:', error.message || error);
    redisInitialized = true;
    return null;
  }
}

// Cache TTLs (in seconds)
const CACHE_TTL = {
  MERKL_CAMPAIGNS: 21600,           // 6 hours - campaigns change infrequently
  MERKL_OPPORTUNITIES: 21600,       // 6 hours - opportunities change infrequently
  DEFILLAMA_TVL_CURRENT: 21600,    // 6 hours - current TVL changes slowly
  DEFILLAMA_TVL_HISTORICAL: 604800, // 7 days - historical TVL never changes (reduced from 30 days)
  DUNE_VOLUME: 604800,             // 7 days - volumes are historical (reduced from 30 days)
  MERKL_CAMPAIGNS_HISTORICAL: 604800, // 7 days - historical campaigns (reduced from 30 days)
  EPOCH_DATA_CURRENT: 3600,        // 1 hour - current epoch data
  EPOCH_DATA_HISTORICAL: 604800,   // 7 days - historical epoch data never changes
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

  epochData: (epochId: string) =>
    `epoch:data:${epochId}`,
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

/**
 * Cache epoch data
 * @param isHistorical - If true, uses longer TTL (7 days) for completed epochs
 */
export async function cacheEpochData(
  epochId: string,
  data: any,
  isHistorical: boolean = false
): Promise<void> {
  const key = CacheKeys.epochData(epochId);
  const ttl = isHistorical ? CACHE_TTL.EPOCH_DATA_HISTORICAL : CACHE_TTL.EPOCH_DATA_CURRENT;
  await setCache(key, data, ttl);
}

/**
 * Get cached epoch data
 */
export async function getCachedEpochData(
  epochId: string
): Promise<any | null> {
  const key = CacheKeys.epochData(epochId);
  return await getCache<any>(key);
}

/**
 * Clear all Merkl campaign caches
 * Useful when new protocols/campaigns are added and cache has stale data
 */
export async function clearMerklCampaignCaches(): Promise<{ cleared: number; error?: string }> {
  try {
    const client = getRedisClient();
    if (!client) {
      return { cleared: 0, error: 'Redis not available' };
    }

    // Get all keys matching merkl:campaigns:*
    const keys = await client.keys('merkl:campaigns:*');

    if (keys.length === 0) {
      return { cleared: 0 };
    }

    // Delete all matching keys
    await client.del(...keys);
    console.log(`[Cache] Cleared ${keys.length} Merkl campaign cache entries`);

    return { cleared: keys.length };
  } catch (error: any) {
    console.error('[Cache] Failed to clear Merkl caches:', error);
    return { cleared: 0, error: error.message };
  }
}

/**
 * Clear all caches (nuclear option)
 */
export async function clearAllCaches(): Promise<{ cleared: number; error?: string }> {
  try {
    const client = getRedisClient();
    if (!client) {
      return { cleared: 0, error: 'Redis not available' };
    }

    // Get all keys
    const keys = await client.keys('*');

    if (keys.length === 0) {
      return { cleared: 0 };
    }

    // Delete all keys
    await client.del(...keys);
    console.log(`[Cache] Cleared ALL ${keys.length} cache entries`);

    return { cleared: keys.length };
  } catch (error: any) {
    console.error('[Cache] Failed to clear all caches:', error);
    return { cleared: 0, error: error.message };
  }
}

/**
 * Dynamic epochs stored in Redis
 * These are auto-generated epochs that extend beyond the hardcoded list
 */
const DYNAMIC_EPOCHS_KEY = 'epochs:dynamic';

export interface DynamicEpoch {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  snapshotDate: string;
  monTwap: number;
  monTwapChange: string;
  isGenerated?: boolean; // Flag to indicate this was auto-generated
}

/**
 * Get all dynamic epochs from Redis
 */
export async function getDynamicEpochs(): Promise<DynamicEpoch[]> {
  const epochs = await getCache<DynamicEpoch[]>(DYNAMIC_EPOCHS_KEY);
  return epochs || [];
}

/**
 * Save dynamic epochs to Redis
 */
export async function saveDynamicEpochs(epochs: DynamicEpoch[]): Promise<void> {
  // Store for 30 days (epochs are semi-permanent)
  await setCache(DYNAMIC_EPOCHS_KEY, epochs, 60 * 60 * 24 * 30);
}

/**
 * Add a new dynamic epoch
 */
export async function addDynamicEpoch(epoch: DynamicEpoch): Promise<void> {
  const existing = await getDynamicEpochs();
  // Check if epoch with same ID already exists
  if (!existing.find(e => e.id === epoch.id)) {
    existing.unshift(epoch); // Add to beginning (newest first)
    await saveDynamicEpochs(existing);
  }
}

/**
 * Update a dynamic epoch (e.g., to set the TWAP after it's calculated)
 */
export async function updateDynamicEpoch(epochId: string, updates: Partial<DynamicEpoch>): Promise<void> {
  const existing = await getDynamicEpochs();
  const index = existing.findIndex(e => e.id === epochId);
  if (index !== -1) {
    existing[index] = { ...existing[index], ...updates };
    await saveDynamicEpochs(existing);
  }
}
