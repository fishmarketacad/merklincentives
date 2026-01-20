/**
 * Shared cache for default dashboard data
 * Uses Redis for persistence across serverless function instances
 * Falls back to in-memory cache if Redis is not available
 */

import { getCache as getRedisCache, setCache as setRedisCache } from './cache';

interface DashboardData {
  startDate: string;
  endDate: string;
  monPrice: number;
  protocols: string[];
  results: any[];
  previousWeekResults: any[];
  protocolTVL: any;
  protocolTVLMetadata: any;
  protocolDEXVolume: any;
  marketVolumes: any;
  previousWeekProtocolTVL: any;
  previousWeekProtocolDEXVolume: any;
  previousWeekMarketVolumes: any;
  aiAnalysis: any | null;
  timestamp: number;
  cacheDate: string; // YYYY-MM-DD format - used to invalidate cache
}

const CACHE_KEY = 'dashboard:default';
const CACHE_TTL = 86400; // 24 hours (dashboard refreshes daily)

// In-memory fallback cache (used if Redis is not available)
let inMemoryCache: DashboardData | null = null;

/**
 * Get cached dashboard data
 * Tries Redis first, falls back to in-memory cache
 */
export async function getCache(): Promise<DashboardData | null> {
  try {
    // Try Redis first
    const redisCache = await getRedisCache<DashboardData>(CACHE_KEY);
    if (redisCache) {
      console.log('[DashboardCache] Cache hit from Redis');
      // Also update in-memory cache as backup
      inMemoryCache = redisCache;
      return redisCache;
    }
  } catch (error) {
    console.warn('[DashboardCache] Redis get failed, using in-memory fallback:', error);
  }

  // Fallback to in-memory cache
  if (inMemoryCache) {
    console.log('[DashboardCache] Cache hit from in-memory fallback');
    return inMemoryCache;
  }

  return null;
}

/**
 * Set cached dashboard data
 * Stores in both Redis (if available) and in-memory cache
 */
export async function setCache(data: DashboardData): Promise<void> {
  // Update in-memory cache immediately
  inMemoryCache = data;
  
  try {
    // Try to store in Redis for persistence
    await setRedisCache(CACHE_KEY, data, CACHE_TTL);
    console.log('[DashboardCache] Cache updated in Redis for date:', data.cacheDate);
  } catch (error) {
    console.warn('[DashboardCache] Redis set failed, using in-memory only:', error);
    console.log('[DashboardCache] Cache updated in-memory for date:', data.cacheDate);
  }
}

/**
 * Update AI analysis in cache
 */
export async function updateAIAnalysis(aiAnalysis: any): Promise<void> {
  const currentCache = await getCache();
  if (currentCache) {
    currentCache.aiAnalysis = aiAnalysis;
    currentCache.timestamp = Date.now();
    await setCache(currentCache);
    console.log('[DashboardCache] AI analysis updated in cache');
  } else {
    console.warn('[DashboardCache] Cannot update AI analysis - cache not initialized');
  }
}

/**
 * Check if cache is valid for target date
 */
export async function isCacheValid(targetDate: string): Promise<boolean> {
  const cache = await getCache();
  if (!cache) return false;
  const isValid = cache.cacheDate === targetDate;
  console.log('[DashboardCache] Cache valid check:', { cacheDate: cache.cacheDate, targetDate, isValid });
  return isValid;
}

/**
 * Clear cache
 */
export async function clearCache(): Promise<void> {
  inMemoryCache = null;
  try {
    // Try to clear Redis cache by setting with short TTL
    await setRedisCache(CACHE_KEY, null, 1);
  } catch (error) {
    // Ignore Redis errors
  }
  console.log('[DashboardCache] Cache cleared');
}
