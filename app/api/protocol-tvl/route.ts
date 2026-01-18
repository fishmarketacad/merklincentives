import { NextRequest, NextResponse } from 'next/server';
import { 
  getCachedDefillamaTVL, 
  cacheDefillamaTVL,
  getCachedDuneVolume,
  cacheDuneVolume 
} from '@/app/lib/cache';

const DEFILLAMA_API_BASE = 'https://api.llama.fi';
const DUNE_API_BASE = 'https://api.dune.com/api/v1';

// Map our protocol IDs to DeFiLlama protocol slugs
const PROTOCOL_SLUG_MAP: Record<string, string> = {
  'clober': 'clober',
  'curvance': 'curvance',
  'gearbox': 'gearbox',
  'kuru': 'kuru',
  'morpho': 'morpho',
  'euler': 'euler',
  'pancake-swap': 'pancakeswap', // Merkl uses "pancake-swap", DeFiLlama uses "pancakeswap"
  'uniswap': 'uniswap', // Added: Uniswap protocol
  'monday-trade': 'monday-trade',
  'renzo': 'renzo',
  'upshift': 'upshift',
  'townsquare': 'townsquare',
  'beefy': 'beefy',
  'accountable': 'accountable',
  'curve': 'curve',
};

// Map protocols to Dune query IDs
const DUNE_QUERY_MAP: Record<string, number> = {
  'uniswap': 6436010,      // Uniswap V4 pair volumes (has token_pair)
  'pancake-swap': 6436185, // PancakeSwap V3 volumes (aggregated, NO token_pair)
  'curve': 6530575,        // Curve volumes (has token_pair but with pool names like "3pool")
  'kuru': 6436201,         // Kuru volumes (has token_pair)
};

// Protocols that don't have per-pool token pairs in Dune (aggregated volume only)
const AGGREGATED_VOLUME_PROTOCOLS = ['pancake-swap'];

// Protocols that use pool names instead of token pairs in Dune
const POOL_NAME_PROTOCOLS = ['curve'];

// Create reverse map for O(1) protocol ID lookup (slug -> protocol ID)
const SLUG_TO_PROTOCOL_ID_MAP: Record<string, string> = {};
for (const [protocolId, slug] of Object.entries(PROTOCOL_SLUG_MAP)) {
  SLUG_TO_PROTOCOL_ID_MAP[slug] = protocolId;
}

/**
 * Extract Curve pool name from market name
 * Examples:
 * - "Provide liquidity to the Curve WBTC-LBTC-BTC.b pool" -> "bitcoin converter"
 * - "Provide liquidity to Curve WMON-shMON-sMON-gMON" -> "mon lsts"
 * - "Provide liquidity to the Curve AUSD-USDC-USDT0 pool" -> "3pool"
 */
function extractCurvePoolName(marketName: string): string | null {
  const lowerName = marketName.toLowerCase();
  
  // Map market name patterns to Dune pool names
  if (lowerName.includes('wbtc') && lowerName.includes('lbtc') && lowerName.includes('btc.b')) {
    return 'bitcoin converter';
  }
  if (lowerName.includes('wmon') && (lowerName.includes('shmon') || lowerName.includes('smon') || lowerName.includes('gmon'))) {
    return 'mon lsts';
  }
  if (lowerName.includes('ausd') && lowerName.includes('usdc') && lowerName.includes('usdt0')) {
    return '3pool';
  }
  
  // Try to find other patterns
  if (lowerName.includes('3pool')) {
    return '3pool';
  }
  
  return null;
}

// Dune API key (from environment variable)
const DUNE_API_KEY = process.env.DUNE_API_KEY || 'qxl7au2ERbgbit3OzNYVWIwtmFkzJ2vt';

/**
 * Get TVL at a specific date from historical chain TVL data
 */
function getTVLAtDate(chainTvlHistory: any[], endTimestamp: number): number | null {
  if (!chainTvlHistory || chainTvlHistory.length === 0) {
    return null;
  }

  // Find the TVL record closest to (but not after) the end timestamp
  const validRecords = chainTvlHistory.filter(record => {
    const recordDate = parseInt(String(record.date));
    return recordDate <= endTimestamp;
  });

  if (validRecords.length === 0) {
    return null;
  }

  // Get the record closest to the end timestamp
  const closestRecord = validRecords.reduce((closest, current) => {
    const closestTime = parseInt(String(closest.date));
    const currentTime = parseInt(String(current.date));
    return Math.abs(currentTime - endTimestamp) < Math.abs(closestTime - endTimestamp)
      ? current
      : closest;
  });

  return closestRecord?.totalLiquidityUSD !== undefined 
    ? parseFloat(String(closestRecord.totalLiquidityUSD)) 
    : null;
}

/**
 * Get volume at a specific date from historical volume data
 */
function getVolumeAtDate(volumeHistory: any[], endTimestamp: number): number | null {
  if (!volumeHistory || volumeHistory.length === 0) {
    return null;
  }

  // Find the volume record closest to (but not after) the end timestamp
  const validRecords = volumeHistory.filter(record => {
    const recordTimestamp = Array.isArray(record) ? record[0] : parseInt(String(record.timestamp || record.date));
    return recordTimestamp <= endTimestamp;
  });

  if (validRecords.length === 0) {
    return null;
  }

  // Get the record closest to the end timestamp
  const closestRecord = validRecords.reduce((closest, current) => {
    const closestTime = Array.isArray(closest) ? closest[0] : parseInt(String(closest.timestamp || closest.date));
    const currentTime = Array.isArray(current) ? current[0] : parseInt(String(current.timestamp || current.date));
    return Math.abs(currentTime - endTimestamp) < Math.abs(closestTime - endTimestamp)
      ? current
      : closest;
  });

  // Extract volume value (could be array [timestamp, volume] or object with volume property)
  if (Array.isArray(closestRecord)) {
    return closestRecord[1] !== undefined ? parseFloat(String(closestRecord[1])) : null;
  }
  return closestRecord?.volume !== undefined ? parseFloat(String(closestRecord.volume)) : null;
}

/**
 * Extract token pair from market name (e.g., "UniswapV4 MON-USDC 0.05%" -> "MON-USDC")
 * Handles case-insensitive matching and ensures we get the full token pair
 */
function extractTokenPair(marketName: string): string | null {
  // Extract token pair from market name
  // Market names are typically: "ProtocolName TOKEN1-TOKEN2 Fee%"
  // We want to match the token pair that appears before the fee percentage
  // Examples: "UniswapV4 AUSD-XAUt0 0.05%" -> "AUSD-XAUt0"
  //           "UniswapV4 wstETH-WETH 0.01%" -> "wstETH-WETH"
  
  // Match all token pairs (case-insensitive, includes lowercase)
  const matches = marketName.match(/([A-Z0-9a-z]+)-([A-Z0-9a-z]+)/gi);
  if (!matches || matches.length === 0) {
    return null;
  }
  
  // Return the longest match (most likely to be the full token pair)
  // This handles cases where there might be multiple matches
  let longestMatch = matches[0];
  for (const m of matches) {
    if (m.length > longestMatch.length) {
      longestMatch = m;
    }
  }
  
  return longestMatch;
}

/**
 * Normalize token pair for matching (handle case differences, etc.)
 */
function normalizeTokenPair(pair: string): string {
  return pair.toUpperCase().trim();
}

/**
 * Match token pairs (handles both directions: MON-USDC matches USDC-MON)
 * Also handles case-insensitive matching (AUSD-XAUT0 matches AUSD-XAUto)
 */
function tokenPairsMatch(pair1: string | null, pair2: string | null): boolean {
  if (!pair1 || !pair2) return false;
  const normalized1 = normalizeTokenPair(pair1);
  const normalized2 = normalizeTokenPair(pair2);
  
  // Try exact match
  if (normalized1 === normalized2) return true;
  
  // Try swapped direction
  const swapped2 = normalized2.split('-').reverse().join('-');
  if (normalized1 === swapped2) return true;
  
  return false;
}

/**
 * Fetch volume from Dune API for a specific protocol
 */
async function fetchDuneVolume(
  protocolId: string,
  queryId: number,
  startTimestamp: number,
  endTimestamp: number,
  tokenPair?: string | null
): Promise<{
  volumeInRange: number | null;
  volume24h: number | null;
  volume7d: number | null;
  volume30d: number | null;
  isHistorical: boolean;
  isMonadSpecific: boolean;
}> {
  try {
    // NOTE: Dune queries don't accept date parameters - we fetch ALL results
    // and filter client-side by date range. This is because Dune queries are
    // pre-defined SQL queries that return all historical data.
    // We filter by checking if weeks overlap with the requested date range.
    
    // Check cache first - cache the entire query result set (all rows)
    const cachedRows = await getCachedDuneVolume(queryId, null);
    let allRows: any[] = [];
    
    if (cachedRows && Array.isArray(cachedRows) && cachedRows.length > 0) {
      console.log(`Cache hit for Dune query ${queryId} (${cachedRows.length} rows)`);
      allRows = cachedRows;
    } else {
      // Cache miss - fetch all results from Dune (handle pagination)
      let offset = 0;
      const limit = 1000;
      let hasMore = true;

      while (hasMore) {
        const url = `${DUNE_API_BASE}/query/${queryId}/results?limit=${limit}&offset=${offset}`;
        const response = await fetch(url, {
          headers: {
            'x-dune-api-key': DUNE_API_KEY,
          },
        });

        if (!response.ok) {
          console.error(`Dune API error for query ${queryId}:`, response.status, response.statusText);
          return {
            volumeInRange: null,
            volume24h: null,
            volume7d: null,
            volume30d: null,
            isHistorical: false,
            isMonadSpecific: false,
          };
        }

        const data = await response.json();
        
        if (data.result && data.result.rows) {
          allRows = allRows.concat(data.result.rows);
          
          // Check if there are more results
          if (data.result.rows.length < limit || !data.next_uri) {
            hasMore = false;
          } else {
            offset += limit;
          }
        } else {
          hasMore = false;
        }
      }
      
      // Cache the entire result set
      if (allRows.length > 0) {
        await cacheDuneVolume(queryId, null, allRows);
      }
    }

    if (allRows.length === 0) {
      return {
        volumeInRange: null,
        volume24h: null,
        volume7d: null,
        volume30d: null,
        isHistorical: false,
        isMonadSpecific: true, // Dune data is Monad-specific
      };
    }

    // Determine date column name (could be "week", "week_start", etc.)
    const firstRow = allRows[0];
    const dateColumn = firstRow.week_start ? 'week_start' : firstRow.week ? 'week' : null;
    
    if (!dateColumn) {
      console.error(`No date column found in Dune query ${queryId}`);
      return {
        volumeInRange: null,
        volume24h: null,
        volume7d: null,
        volume30d: null,
        isHistorical: false,
        isMonadSpecific: true,
      };
    }

    // Helper function to filter rows by date range and token pair
    const filterRowsByTokenPair = (rows: any[], pairToMatch: string | null): any[] => {
      return rows.filter((row: any) => {
        // Parse date from row
        const dateStr = row[dateColumn];
        if (!dateStr) return false;
        
        // Handle different date formats
        let weekTimestamp: number;
        if (typeof dateStr === 'string') {
          // Parse date string (could be "2026-01-12" or "2026-01-12 00:00:00.000 UTC")
          const date = new Date(dateStr.split(' ')[0] + 'T00:00:00Z');
          weekTimestamp = Math.floor(date.getTime() / 1000);
        } else {
          weekTimestamp = Math.floor(new Date(dateStr).getTime() / 1000);
        }

        // Check if week falls within our date range
        // For weekly data, we include weeks that overlap with our range
        const weekEnd = weekTimestamp + (7 * 24 * 60 * 60); // End of week
        const overlaps = weekTimestamp <= endTimestamp && weekEnd >= startTimestamp;

        if (!overlaps) return false;

        // If token pair/pool name is specified, match it (case-insensitive)
        if (pairToMatch && row.token_pair) {
          // Normalize both to lowercase for comparison (handles pool names like "mon lsts", "bitcoin converter")
          const normalizedPair = pairToMatch.toLowerCase().trim();
          const normalizedRowPair = String(row.token_pair).toLowerCase().trim();
          
          // Try exact match first (for pool names like "3pool", "mon lsts", "bitcoin converter")
          if (normalizedPair === normalizedRowPair) return true;
          
          // For token pairs (e.g., "MON-USDC"), try normalized uppercase match
          const normalizedPairUpper = normalizeTokenPair(pairToMatch);
          const normalizedRowPairUpper = normalizeTokenPair(row.token_pair);
          
          // Try exact match
          if (normalizedPairUpper === normalizedRowPairUpper) return true;
          
          // Try swapped direction (MON-USDC matches USDC-MON)
          const swappedRowPair = normalizedRowPairUpper.split('-').reverse().join('-');
          if (normalizedPairUpper === swappedRowPair) return true;
          
          return false;
        }

        return true;
      });
    };

    // Filter rows by token pair (matching logic already handles both directions)
    const filteredRows = filterRowsByTokenPair(allRows, tokenPair || null);

    // Sum volumes for the date range
    let volumeInRange = 0;
    let volume7d = 0;
    let volume30d = 0;
    let hasData = false;

    const sevenDaysAgo = endTimestamp - (7 * 24 * 60 * 60);
    const thirtyDaysAgo = endTimestamp - (30 * 24 * 60 * 60);

    for (const row of filteredRows) {
      const dateStr = row[dateColumn];
      let weekTimestamp: number;
      if (typeof dateStr === 'string') {
        const date = new Date(dateStr.split(' ')[0] + 'T00:00:00Z');
        weekTimestamp = Math.floor(date.getTime() / 1000);
      } else {
        weekTimestamp = Math.floor(new Date(dateStr).getTime() / 1000);
      }

      const volume = parseFloat(String(row.volume || 0));
      if (isNaN(volume) || volume <= 0) continue;

      hasData = true;
      const weekEnd = weekTimestamp + (7 * 24 * 60 * 60);

      // Add to volumeInRange if week overlaps with our range
      if (weekTimestamp <= endTimestamp && weekEnd >= startTimestamp) {
        // Calculate the portion of the week that overlaps with our range
        const overlapStart = Math.max(weekTimestamp, startTimestamp);
        const overlapEnd = Math.min(weekEnd, endTimestamp);
        const overlapDays = (overlapEnd - overlapStart) / (24 * 60 * 60);
        const weekDays = 7;
        const proratedVolume = volume * (overlapDays / weekDays);
        volumeInRange += proratedVolume;
      }

      // Add to 7d and 30d volumes
      if (weekTimestamp >= sevenDaysAgo && weekTimestamp <= endTimestamp) {
        volume7d += volume;
      }
      if (weekTimestamp >= thirtyDaysAgo && weekTimestamp <= endTimestamp) {
        volume30d += volume;
      }
    }

    return {
      volumeInRange: hasData ? volumeInRange : null,
      volume24h: null, // Dune provides weekly data, not 24h
      volume7d: hasData ? volume7d : null,
      volume30d: hasData ? volume30d : null,
      isHistorical: true,
      isMonadSpecific: true, // Dune data is Monad-specific
    };
  } catch (error) {
    console.error(`Error fetching Dune volume for ${protocolId}:`, error);
    return {
      volumeInRange: null,
      volume24h: null,
      volume7d: null,
      volume30d: null,
      isHistorical: false,
      isMonadSpecific: false,
    };
  }
}

/**
 * Calculate volume for a date range (e.g., 7d, 30d) from historical data
 */
function calculateVolumeInRange(volumeHistory: any[], startTimestamp: number, endTimestamp: number): number | null {
  if (!volumeHistory || volumeHistory.length === 0) {
    return null;
  }

  let totalVolume = 0;
  let hasData = false;

  for (const record of volumeHistory) {
    const recordTimestamp = Array.isArray(record) ? record[0] : parseInt(String(record.timestamp || record.date));
    
    if (recordTimestamp >= startTimestamp && recordTimestamp <= endTimestamp) {
      const volume = Array.isArray(record) ? record[1] : record.volume;
      if (volume !== undefined && volume !== null) {
        totalVolume += parseFloat(String(volume));
        hasData = true;
      }
    }
  }

  return hasData ? totalVolume : null;
}

/**
 * Fetch DEX volume from Dune API (preferred) or DeFiLlama API (fallback)
 */
async function fetchDEXVolume(protocolSlug: string, startTimestamp: number, endTimestamp: number): Promise<{ 
  volumeInRange: number | null; // Volume for the exact date range
  volume24h: number | null;
  volume7d: number | null;
  volume30d: number | null;
  isHistorical: boolean;
  isMonadSpecific: boolean; // True if volume is Monad-specific, false if all-chain fallback
}> {
  // Pre-calculate time ranges (used multiple times)
  const sevenDaysAgo = endTimestamp - (7 * 24 * 60 * 60);
  const thirtyDaysAgo = endTimestamp - (30 * 24 * 60 * 60);
  
  // Optimize protocol ID resolution: O(1) lookup instead of O(n) find
  const protocolId = SLUG_TO_PROTOCOL_ID_MAP[protocolSlug] || protocolSlug.toLowerCase().replace(' ', '-');
  const normalizedSlug = protocolSlug.toLowerCase();
  
  // Check for Dune query (check both protocolId and direct slug match)
  const duneQueryId = DUNE_QUERY_MAP[protocolId] || DUNE_QUERY_MAP[normalizedSlug];
  
  if (duneQueryId) {
    const effectiveProtocolId = DUNE_QUERY_MAP[protocolId] ? protocolId : normalizedSlug;
    
    // For protocols with Dune queries, handle aggregated volume protocols specially
    if (AGGREGATED_VOLUME_PROTOCOLS.includes(effectiveProtocolId) || POOL_NAME_PROTOCOLS.includes(effectiveProtocolId)) {
      // PancakeSwap and Curve: Return aggregated volume (no token pair needed)
      console.log(`Fetching aggregated volume for ${effectiveProtocolId} from Dune`);
      return await fetchDuneVolume(
        effectiveProtocolId,
        duneQueryId,
        startTimestamp,
        endTimestamp,
        null // No token pair - return aggregated volume
      );
    } else {
      // Uniswap, Kuru: Per-pool volumes should be fetched via PUT endpoint
      console.log(`Protocol ${protocolSlug} has Dune query but fetchDEXVolume called without token pair. Use PUT endpoint for per-pool volumes.`);
      return {
        volumeInRange: null,
        volume24h: null,
        volume7d: null,
        volume30d: null,
        isHistorical: false,
        isMonadSpecific: true,
      };
    }
  }

  // Fallback to DeFiLlama (only for protocols without Dune queries)
  // Use /overview/dexs/monad - robust for protocol name matching and handles variations automatically
  // This endpoint provides Monad-specific data and aggregates multiple protocol versions (e.g., "Uniswap V2" + "Uniswap V4")
  try {
    const chainOverviewUrl = `${DEFILLAMA_API_BASE}/overview/dexs/monad?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=false`;
    const chainResponse = await globalThis.fetch(chainOverviewUrl);
    
    if (chainResponse.ok) {
        const chainData = await chainResponse.json();
        
        // Find ALL protocol variations in the Monad chain overview
        // e.g., "Uniswap V2", "Uniswap V4" should both match "uniswap"
        if (chainData.protocols && Array.isArray(chainData.protocols)) {
          const slugMatch = normalizedSlug.replace('-', ' ');
          const slugFirstWord = slugMatch.split(' ')[0];
          
          // Find all protocol variations that match (optimized matching)
          const matchingProtocols = chainData.protocols.filter((p: any) => {
            const protocolName = p.name?.toLowerCase() || '';
            if (!protocolName) return false;
            
            // Optimized: Check most common cases first
            if (protocolName.startsWith(slugMatch)) return true;
            if (protocolName.includes(slugMatch)) return true;
            
            // Check first word match (e.g., "uniswap" matches "Uniswap V4")
            const protocolFirstWord = protocolName.split(' ')[0];
            if (protocolFirstWord === slugFirstWord) return true;
            
            return false;
          });
          
          if (matchingProtocols.length > 0 && chainData.totalDataChartBreakdown) {
            const monadVolumeData: any[] = [];
            
            // Extract from chain's totalDataChartBreakdown by protocol name(s)
            // Format: [timestamp, { "Protocol Name": volume }]
            // Sum volumes from all matching protocol names (e.g., "Uniswap V2" + "Uniswap V4")
            for (const record of chainData.totalDataChartBreakdown) {
              if (Array.isArray(record) && record.length >= 2) {
                const timestamp = record[0];
                const breakdown = record[1];
                
                if (typeof breakdown === 'object' && breakdown !== null) {
                  // Sum volumes from all matching protocol names
                  let totalProtocolVolume = 0;
                  for (const protocol of matchingProtocols) {
                    const protocolName = protocol.name;
                    const protocolVolume = breakdown[protocolName];
                    if (protocolVolume !== undefined && protocolVolume !== null && typeof protocolVolume === 'number') {
                      totalProtocolVolume += protocolVolume;
                    }
                  }
                  
                  if (totalProtocolVolume > 0) {
                    monadVolumeData.push([timestamp, totalProtocolVolume]);
                  }
                }
              }
            }
            
            if (monadVolumeData.length > 0) {
              // Calculate volumes (using pre-calculated time ranges)
              const volumeInRange = calculateVolumeInRange(monadVolumeData, startTimestamp, endTimestamp);
              const volume7d = calculateVolumeInRange(monadVolumeData, sevenDaysAgo, endTimestamp);
              const volume30d = calculateVolumeInRange(monadVolumeData, thirtyDaysAgo, endTimestamp);
              
              // Sum 24h volume from all matching protocols
              let total24h = 0;
              for (const protocol of matchingProtocols) {
                if (protocol.total24h !== undefined) {
                  total24h += parseFloat(String(protocol.total24h));
                }
              }
              
              return {
                volumeInRange,
                volume24h: total24h > 0 ? total24h : null,
                volume7d,
                volume30d,
                isHistorical: true,
                isMonadSpecific: true,
              };
            }
          }
        }
    }
    
    // Fallback to all-chain volume if Monad-specific not available
    const url = `${DEFILLAMA_API_BASE}/summary/dexs/${protocolSlug}?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true`;
    const response = await globalThis.fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { volumeInRange: null, volume24h: null, volume7d: null, volume30d: null, isHistorical: false, isMonadSpecific: false };
      }
      return { volumeInRange: null, volume24h: null, volume7d: null, volume30d: null, isHistorical: false, isMonadSpecific: false };
    }
    
    const data = await response.json();
    
    // Get current 24h volume
    const volume24h = data.total24h !== undefined ? parseFloat(String(data.total24h)) : null;
    
    // Calculate volumes from totalDataChart (all-chain - unreliable fallback)
    let volumeInRange: number | null = null;
    let volume7d: number | null = null;
    let volume30d: number | null = null;
    let isHistorical = false;
    
    if (data.totalDataChart && Array.isArray(data.totalDataChart) && data.totalDataChart.length > 0) {
      // Calculate volumes (using pre-calculated time ranges)
      volumeInRange = calculateVolumeInRange(data.totalDataChart, startTimestamp, endTimestamp);
      volume7d = calculateVolumeInRange(data.totalDataChart, sevenDaysAgo, endTimestamp);
      volume30d = calculateVolumeInRange(data.totalDataChart, thirtyDaysAgo, endTimestamp);
      
      if (volumeInRange !== null || volume7d !== null || volume30d !== null) {
        isHistorical = true;
      }
    }
    
    return {
      volumeInRange,
      volume24h,
      volume7d,
      volume30d,
      isHistorical,
      isMonadSpecific: false, // This is all-chain volume, not Monad-specific
    };
  } catch (error) {
    console.error(`Error fetching DEX volume for ${protocolSlug}:`, error);
    return { volumeInRange: null, volume24h: null, volume7d: null, volume30d: null, isHistorical: false, isMonadSpecific: false };
  }
}

/**
 * Fetch protocol TVL from DeFiLlama API at a specific date
 * Returns TVL value and whether it's historical or current (fallback)
 */
async function fetchProtocolTVL(protocolSlug: string, endTimestamp: number): Promise<{ tvl: number | null; isHistorical: boolean }> {
  try {
    // Generate cache key from date
    const endDate = new Date(endTimestamp * 1000).toISOString().split('T')[0];
    
    // Check cache first
    const cachedTVL = await getCachedDefillamaTVL(protocolSlug, endDate);
    if (cachedTVL !== null) {
      console.log(`Cache hit for TVL: ${protocolSlug} on ${endDate}`);
      // We can't determine if cached value is historical, so assume it is
      return { tvl: cachedTVL, isHistorical: true };
    }

    // Cache miss - fetch from API
    const url = `${DEFILLAMA_API_BASE}/protocol/${protocolSlug}`;
    const response = await globalThis.fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { tvl: null, isHistorical: false }; // Protocol not found in DeFiLlama
      }
      return { tvl: null, isHistorical: false };
    }
    
    const data = await response.json();
    
    let resultTVL: number | null = null;
    let isHistorical = false;
    
    // Try to get historical TVL for Monad chain at end date
    if (data.chainTvls && typeof data.chainTvls === 'object') {
      // Try different case variations for Monad chain
      const monadChainData = data.chainTvls['Monad'] || 
                             data.chainTvls['monad'] || 
                             data.chainTvls['MONAD'];
      
      if (monadChainData && monadChainData.tvl && Array.isArray(monadChainData.tvl)) {
        const historicalTVL = getTVLAtDate(monadChainData.tvl, endTimestamp);
        if (historicalTVL !== null) {
          resultTVL = historicalTVL;
          isHistorical = true;
        }
      }
    }
    
    // Fallback to current TVL if historical data not available
    if (resultTVL === null && data.currentChainTvls && typeof data.currentChainTvls === 'object') {
      const monadTVL = data.currentChainTvls['Monad'] || 
                       data.currentChainTvls['monad'] || 
                       data.currentChainTvls['MONAD'];
      
      if (monadTVL !== undefined && monadTVL !== null) {
        resultTVL = parseFloat(String(monadTVL));
        isHistorical = false;
      }
      
      // If no Monad-specific TVL, return total TVL for single-chain protocols
      if (resultTVL === null && data.chains && Array.isArray(data.chains) && data.chains.length === 1) {
        resultTVL = data.tvl || null;
        isHistorical = false;
      }
    }
    
    // Cache the result if we got a value
    if (resultTVL !== null) {
      await cacheDefillamaTVL(protocolSlug, endDate, resultTVL);
    }
    
    return { tvl: resultTVL, isHistorical };
  } catch (error) {
    console.error(`Error fetching TVL for ${protocolSlug}:`, error);
    return { tvl: null, isHistorical: false };
  }
}

/**
 * Fetch volume for specific markets (per-pool volume from Dune)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { markets, startDate, endDate } = body;

    if (!markets || !Array.isArray(markets) || markets.length === 0) {
      return NextResponse.json(
        { error: 'Markets array is required' },
        { status: 400 }
      );
    }

    // Convert dates to timestamps
    let startTimestamp = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    let endTimestamp = Math.floor(Date.now() / 1000);
    
    if (startDate) {
      const start = new Date(startDate + 'T00:00:00Z');
      if (!isNaN(start.getTime())) {
        startTimestamp = Math.floor(start.getTime() / 1000);
      }
    }
    
    if (endDate) {
      const end = new Date(endDate + 'T23:59:59Z');
      if (!isNaN(end.getTime())) {
        endTimestamp = Math.floor(end.getTime() / 1000);
      }
    }

    // Fetch volume for each market
    const marketVolumes: Record<string, {
      volumeInRange: number | null;
      volume24h: number | null;
      volume7d: number | null;
      volume30d: number | null;
      isHistorical: boolean;
      isMonadSpecific: boolean;
      error?: string;
    }> = {};

    for (const market of markets) {
      const { protocol, marketName, tokenPair } = market;
      const marketKey = `${protocol}-${marketName}`;
      
      // Extract token pair from market name if not provided
      const extractedTokenPair = tokenPair || extractTokenPair(marketName);
      
      // Map protocol to Dune query
      const protocolId = Object.keys(PROTOCOL_SLUG_MAP).find(
        key => PROTOCOL_SLUG_MAP[key] === protocol.toLowerCase() || key === protocol.toLowerCase()
      ) || protocol.toLowerCase().replace(' ', '-');
      
      const duneQueryId = DUNE_QUERY_MAP[protocolId];
      
      if (duneQueryId) {
        // Handle different Dune query structures
        if (AGGREGATED_VOLUME_PROTOCOLS.includes(protocolId)) {
          // PancakeSwap: Volume is aggregated (no per-pool breakdown available)
          // Return "Not Found" for individual pools
          marketVolumes[marketKey] = {
            volumeInRange: null,
            volume24h: null,
            volume7d: null,
            volume30d: null,
            isHistorical: false,
            isMonadSpecific: true,
            error: 'PancakeSwap volume is aggregated and not available per-pool',
          };
        } else if (POOL_NAME_PROTOCOLS.includes(protocolId)) {
          // Curve: Has token_pair but with pool names (e.g., "3pool", "mon lsts", "bitcoin converter")
          // Extract pool name from market name and match it
          // Only return volume if we can match a known pool name, otherwise "Not Found"
          const curvePoolName = extractCurvePoolName(marketName);
          
          if (curvePoolName) {
            // Match by pool name (case-insensitive)
            const duneResult = await fetchDuneVolume(
              protocolId,
              duneQueryId,
              startTimestamp,
              endTimestamp,
              curvePoolName // Use pool name instead of token pair
            );
            
            if (duneResult.volumeInRange !== null || duneResult.volume7d !== null) {
              marketVolumes[marketKey] = duneResult;
            } else {
              marketVolumes[marketKey] = {
                volumeInRange: null,
                volume24h: null,
                volume7d: null,
                volume30d: null,
                isHistorical: false,
                isMonadSpecific: true,
                error: `No volume data found in Dune for pool "${curvePoolName}"`,
              };
            }
          } else {
            // Couldn't extract pool name - return "Not Found" (e.g., "Stake into the Curve stMONMON gauge")
            marketVolumes[marketKey] = {
              volumeInRange: null,
              volume24h: null,
              volume7d: null,
              volume30d: null,
              isHistorical: false,
              isMonadSpecific: true,
              error: 'Could not extract Curve pool name from market name',
            };
          }
        } else {
          // Uniswap, Kuru: Have token_pair, filter by token pair
          if (!extractedTokenPair) {
            marketVolumes[marketKey] = {
              volumeInRange: null,
              volume24h: null,
              volume7d: null,
              volume30d: null,
              isHistorical: false,
              isMonadSpecific: true,
              error: 'Could not extract token pair from market name',
            };
          } else {
            const duneResult = await fetchDuneVolume(
              protocolId,
              duneQueryId,
              startTimestamp,
              endTimestamp,
              extractedTokenPair
            );
            
            if (duneResult.volumeInRange !== null || duneResult.volume7d !== null) {
              marketVolumes[marketKey] = duneResult;
            } else {
              marketVolumes[marketKey] = {
                volumeInRange: null,
                volume24h: null,
                volume7d: null,
                volume30d: null,
                isHistorical: false,
                isMonadSpecific: true,
                error: 'No volume data found in Dune for this token pair',
              };
            }
          }
        }
      } else {
        // No Dune query for this protocol - return error instead of falling back
        marketVolumes[marketKey] = {
          volumeInRange: null,
          volume24h: null,
          volume7d: null,
          volume30d: null,
          isHistorical: false,
          isMonadSpecific: false,
          error: 'No Dune query available for this protocol',
        };
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    return NextResponse.json({
      success: true,
      marketVolumes,
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { protocols, startDate, endDate } = body;

    if (!protocols || !Array.isArray(protocols) || protocols.length === 0) {
      return NextResponse.json(
        { error: 'Protocols array is required' },
        { status: 400 }
      );
    }

    // Convert dates to timestamps for historical lookup
    let startTimestamp = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60); // Default to 30 days ago
    let endTimestamp = Math.floor(Date.now() / 1000); // Default to current time
    
    if (startDate) {
      const start = new Date(startDate + 'T00:00:00Z');
      if (!isNaN(start.getTime())) {
        startTimestamp = Math.floor(start.getTime() / 1000);
      }
    }
    
    if (endDate) {
      const end = new Date(endDate + 'T23:59:59Z');
      if (!isNaN(end.getTime())) {
        endTimestamp = Math.floor(end.getTime() / 1000);
      }
    }

    // Fetch TVL and DEX volume for each protocol
    const tvlData: Record<string, number | null> = {};
    const tvlMetadata: Record<string, { isHistorical: boolean }> = {};
    const dexVolumeData: Record<string, {
      volumeInRange: number | null;
      volume24h: number | null;
      volume7d: number | null;
      volume30d: number | null;
      isHistorical: boolean;
      isMonadSpecific: boolean;
    }> = {};
    
    for (const protocol of protocols) {
      const protocolSlug = PROTOCOL_SLUG_MAP[protocol.toLowerCase()];
      if (protocolSlug) {
        // Fetch TVL and DEX volume in parallel
        const [tvlResult, dexVolumeResult] = await Promise.all([
          fetchProtocolTVL(protocolSlug, endTimestamp),
          fetchDEXVolume(protocolSlug, startTimestamp, endTimestamp),
        ]);
        
        tvlData[protocol] = tvlResult.tvl;
        tvlMetadata[protocol] = { isHistorical: tvlResult.isHistorical };
        dexVolumeData[protocol] = dexVolumeResult;
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } else {
        tvlData[protocol] = null;
        tvlMetadata[protocol] = { isHistorical: false };
        dexVolumeData[protocol] = {
          volumeInRange: null,
          volume24h: null,
          volume7d: null,
          volume30d: null,
          isHistorical: false,
          isMonadSpecific: false,
        };
      }
    }

    return NextResponse.json({
      success: true,
      tvlData,
      tvlMetadata,
      dexVolumeData,
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
