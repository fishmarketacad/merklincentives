/**
 * Shared cache for default dashboard data
 * Used by both the public API endpoint and the cron job
 */

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

// In-memory cache (survives across requests in same instance)
let cache: DashboardData | null = null;

export function getCache(): DashboardData | null {
  return cache;
}

export function setCache(data: DashboardData): void {
  cache = data;
  console.log('[DashboardCache] Cache updated for date:', data.cacheDate);
}

export function isCacheValid(targetDate: string): boolean {
  if (!cache) return false;
  const isValid = cache.cacheDate === targetDate;
  console.log('[DashboardCache] Cache valid check:', { cacheDate: cache.cacheDate, targetDate, isValid });
  return isValid;
}

export function clearCache(): void {
  cache = null;
  console.log('[DashboardCache] Cache cleared');
}
