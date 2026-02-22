/**
 * MON Token Price Fetcher
 *
 * Fetches MON token prices from CoinGecko (historical) and DeFiLlama (current).
 * Caches historical prices in Redis since they never change.
 */

import { getCache, setCache } from './cache';

const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const DEFILLAMA_COINS_API = 'https://coins.llama.fi';
const COINGECKO_COIN_ID = 'monad';

// Cache TTLs
const CACHE_TTL = {
  HISTORICAL_PRICE: 60 * 60 * 24 * 30, // 30 days - historical prices never change
  CURRENT_PRICE: 60 * 60, // 1 hour - current price updates frequently
};

// Rate limiting for CoinGecko (free tier: 10-30 calls/minute)
let lastCoinGeckoCall = 0;
const COINGECKO_RATE_LIMIT_MS = 2500; // 2.5 seconds between calls

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const timeSinceLastCall = now - lastCoinGeckoCall;

  if (timeSinceLastCall < COINGECKO_RATE_LIMIT_MS) {
    await new Promise(resolve => setTimeout(resolve, COINGECKO_RATE_LIMIT_MS - timeSinceLastCall));
  }

  lastCoinGeckoCall = Date.now();
  return fetch(url);
}

/**
 * Cache key for MON price
 */
function getPriceCacheKey(date: string): string {
  return `mon:price:${date}`;
}

/**
 * Format date for CoinGecko API (DD-MM-YYYY)
 */
function formatDateForCoinGecko(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}-${month}-${year}`;
}

/**
 * Get MON price for a specific date
 *
 * @param date - Date in YYYY-MM-DD format
 * @returns Price in USD or null if not available
 */
export async function getMonPrice(date: string): Promise<{
  price: number | null;
  source: 'cache' | 'coingecko' | 'defillama' | null;
}> {
  // Check cache first
  const cacheKey = getPriceCacheKey(date);
  const cachedPrice = await getCache<number>(cacheKey);

  if (cachedPrice !== null) {
    console.log(`[MonPrice] Cache hit for ${date}: $${cachedPrice}`);
    return { price: cachedPrice, source: 'cache' };
  }

  // Check if this is today's date (use current price endpoint)
  const today = new Date().toISOString().split('T')[0];
  const isToday = date === today;

  if (isToday) {
    // Use DeFiLlama for current price (more reliable, no rate limits)
    try {
      const response = await fetch(
        `${DEFILLAMA_COINS_API}/prices/current/monad:0x0000000000000000000000000000000000000000`
      );

      if (response.ok) {
        const data = await response.json();
        const coinKey = Object.keys(data.coins)[0];
        const price = data.coins[coinKey]?.price;

        if (price !== undefined && price !== null) {
          // Cache current price with shorter TTL
          await setCache(cacheKey, price, CACHE_TTL.CURRENT_PRICE);
          console.log(`[MonPrice] DeFiLlama price for ${date}: $${price}`);
          return { price, source: 'defillama' };
        }
      }
    } catch (error) {
      console.error('[MonPrice] DeFiLlama fetch error:', error);
    }
  }

  // Fetch historical price from CoinGecko
  try {
    const formattedDate = formatDateForCoinGecko(date);
    const url = `${COINGECKO_API_BASE}/coins/${COINGECKO_COIN_ID}/history?date=${formattedDate}&localization=false`;

    console.log(`[MonPrice] Fetching from CoinGecko: ${url}`);
    const response = await rateLimitedFetch(url);

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('[MonPrice] CoinGecko rate limit hit');
        return { price: null, source: null };
      }
      console.error(`[MonPrice] CoinGecko error: ${response.status}`);
      return { price: null, source: null };
    }

    const data = await response.json();
    const price = data.market_data?.current_price?.usd;

    if (price !== undefined && price !== null) {
      // Cache historical price with long TTL
      await setCache(cacheKey, price, CACHE_TTL.HISTORICAL_PRICE);
      console.log(`[MonPrice] CoinGecko price for ${date}: $${price}`);
      return { price, source: 'coingecko' };
    }

    console.warn(`[MonPrice] No price data from CoinGecko for ${date}`);
    return { price: null, source: null };
  } catch (error) {
    console.error('[MonPrice] CoinGecko fetch error:', error);
    return { price: null, source: null };
  }
}

/**
 * Get MON prices for a date range
 *
 * @param startDate - Start date in YYYY-MM-DD format
 * @param endDate - End date in YYYY-MM-DD format
 * @returns Map of date -> price
 */
export async function getMonPriceRange(
  startDate: string,
  endDate: string
): Promise<Record<string, number | null>> {
  const prices: Record<string, number | null> = {};

  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');

  const current = new Date(start);

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const result = await getMonPrice(dateStr);
    prices[dateStr] = result.price;

    // Move to next day
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return prices;
}

/**
 * Get current MON price (today)
 */
export async function getCurrentMonPrice(): Promise<{
  price: number | null;
  source: 'cache' | 'coingecko' | 'defillama' | null;
}> {
  const today = new Date().toISOString().split('T')[0];
  return getMonPrice(today);
}

/**
 * Batch fetch MON prices for multiple dates
 * More efficient than calling getMonPrice for each date
 *
 * @param dates - Array of dates in YYYY-MM-DD format
 * @returns Map of date -> price
 */
export async function batchGetMonPrices(
  dates: string[]
): Promise<Record<string, { price: number | null; source: string | null }>> {
  const results: Record<string, { price: number | null; source: string | null }> = {};

  // First, check cache for all dates
  const uncachedDates: string[] = [];

  for (const date of dates) {
    const cacheKey = getPriceCacheKey(date);
    const cachedPrice = await getCache<number>(cacheKey);

    if (cachedPrice !== null) {
      results[date] = { price: cachedPrice, source: 'cache' };
    } else {
      uncachedDates.push(date);
    }
  }

  console.log(`[MonPrice] Batch: ${dates.length - uncachedDates.length} cached, ${uncachedDates.length} to fetch`);

  // Fetch uncached dates (with rate limiting)
  for (const date of uncachedDates) {
    const result = await getMonPrice(date);
    results[date] = { price: result.price, source: result.source };
  }

  return results;
}
