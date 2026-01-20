import { createClient } from 'redis';

/**
 * Cache utility for Redis
 * Provides caching for Merkl campaigns, opportunities, TVL, and volume data
 */

// Create Redis client singleton
let redisClient: ReturnType<typeof createClient> | null = null;
let connectionAttempted = false; // Track if we've already tried to connect
let connectionFailed = false; // Track if connection failed (to avoid repeated attempts)

/**
 * Get or create Redis client
 * Returns null if connection fails (graceful fallback)
 */
async function getRedisClient() {
  // Early exit if REDIS_URL is not set - no connection attempts
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    // Only warn once
    if (!connectionAttempted) {
      console.log('[Cache] Redis disabled - REDIS_URL not set. Caching skipped, app will work normally.');
      connectionAttempted = true;
    }
    return null;
  }

  // If client exists and is open, return it
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  // If connection already failed, don't retry (prevents spam)
  if (connectionFailed) {
    return null;
  }

  // If we've already attempted connection and it failed, skip
  if (connectionAttempted && !redisClient) {
    return null;
  }

  try {
    connectionAttempted = true;

    // Redis Labs typically requires TLS - check if URL uses rediss://
    const isTLS = redisUrl.startsWith('rediss://');
    const isRedisLabs = redisUrl.includes('redislabs.com');
    
    // If it's Redis Labs but URL uses redis://, convert to rediss://
    // IMPORTANT: When using rediss://, the protocol handles TLS automatically
    // DO NOT set tls in socket config - it causes a conflict
    const urlToUse = isRedisLabs && !isTLS 
      ? redisUrl.replace('redis://', 'rediss://')
      : redisUrl;
    
    // Socket config - never set TLS when using rediss:// (protocol handles it)
    const socketConfig: any = {
      connectTimeout: 20000, // 20 second timeout for Redis Labs (increased for TLS handshake)
      reconnectStrategy: (retries: number) => {
        if (retries > 1) {
          // Stop retrying quickly to avoid spam
          return false;
        }
        return 1000;
      },
    };

    redisClient = createClient({
      url: urlToUse,
      socket: socketConfig,
    });

    redisClient.on('error', (err) => {
      // Only log first error to reduce noise
      if (!connectionFailed) {
        console.error('Redis Client Error:', err.message || err);
        connectionFailed = true;
      }
      // Reset client on error
      redisClient = null;
    });

    if (!redisClient.isOpen) {
      // Connect with timeout matching socket config (20s)
      await Promise.race([
        redisClient.connect(),
        new Promise((_, reject) => 
          setTimeout(() => {
            connectionFailed = true;
            reject(new Error('Redis connection timeout - check IP whitelist in Redis Labs dashboard'));
          }, 20000) // Match socket connectTimeout
        ),
      ]);
    }

    // Success - reset failure flag
    connectionFailed = false;
    return redisClient;
  } catch (error: any) {
    connectionFailed = true;
    // Only log first failure with helpful message
    if (connectionAttempted) {
      const errorMsg = error.message || String(error);
      if (errorMsg.includes('timeout') || errorMsg.includes('ECONNREFUSED')) {
        console.warn('Redis connection failed. This is OK - caching disabled. If using Redis Labs, check IP whitelist in dashboard.');
      } else {
        console.error('Failed to connect to Redis:', errorMsg);
      }
    }
    redisClient = null;
    return null; // Return null instead of throwing - graceful fallback
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
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const client = await getRedisClient();
    if (!client) {
      // Redis not available, return null (cache miss)
      return null;
    }
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
    return null; // Graceful fallback - return null on error
  }
}

/**
 * Set cached value with TTL
 */
export async function setCache<T>(key: string, value: T, ttl: number): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) {
      // Redis not available, silently skip caching
      return;
    }
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
