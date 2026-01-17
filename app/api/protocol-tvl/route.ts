import { NextRequest, NextResponse } from 'next/server';

const DEFILLAMA_API_BASE = 'https://api.llama.fi';

// Map our protocol IDs to DeFiLlama protocol slugs
const PROTOCOL_SLUG_MAP: Record<string, string> = {
  'clober': 'clober',
  'curvance': 'curvance',
  'gearbox': 'gearbox',
  'kuru': 'kuru',
  'morpho': 'morpho',
  'euler': 'euler',
  'pancake-swap': 'pancakeswap-v3', // Merkl uses "pancake-swap", DeFiLlama uses "pancakeswap-v3"
  'uniswap': 'uniswap', // Added: Uniswap protocol
  'monday-trade': 'monday-trade',
  'renzo': 'renzo',
  'upshift': 'upshift',
  'townsquare': 'townsquare',
};

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
 * Fetch DEX volume from DeFiLlama API
 */
async function fetchDEXVolume(protocolSlug: string, startTimestamp: number, endTimestamp: number): Promise<{ 
  volumeInRange: number | null; // Volume for the exact date range
  volume24h: number | null;
  volume7d: number | null;
  volume30d: number | null;
  isHistorical: boolean;
}> {
  try {
    const url = `${DEFILLAMA_API_BASE}/summary/dexs/${protocolSlug}?excludeTotalDataChart=false&excludeTotalDataChartBreakdown=true`;
    const response = await globalThis.fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { volumeInRange: null, volume24h: null, volume7d: null, volume30d: null, isHistorical: false };
      }
      return { volumeInRange: null, volume24h: null, volume7d: null, volume30d: null, isHistorical: false };
    }
    
    const data = await response.json();
    
    // Get current 24h volume
    const volume24h = data.total24h !== undefined ? parseFloat(String(data.total24h)) : null;
    
    // Calculate volumes from totalDataChart
    let volumeInRange: number | null = null;
    let volume7d: number | null = null;
    let volume30d: number | null = null;
    let isHistorical = false;
    
    if (data.totalDataChart && Array.isArray(data.totalDataChart) && data.totalDataChart.length > 0) {
      // Calculate volume for the exact date range
      volumeInRange = calculateVolumeInRange(data.totalDataChart, startTimestamp, endTimestamp);
      
      // Also calculate 7d and 30d as fallbacks/reference
      const sevenDaysAgo = endTimestamp - (7 * 24 * 60 * 60);
      const thirtyDaysAgo = endTimestamp - (30 * 24 * 60 * 60);
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
    };
  } catch (error) {
    console.error(`Error fetching DEX volume for ${protocolSlug}:`, error);
    return { volumeInRange: null, volume24h: null, volume7d: null, volume30d: null, isHistorical: false };
  }
}

/**
 * Fetch protocol TVL from DeFiLlama API at a specific date
 * Returns TVL value and whether it's historical or current (fallback)
 */
async function fetchProtocolTVL(protocolSlug: string, endTimestamp: number): Promise<{ tvl: number | null; isHistorical: boolean }> {
  try {
    const url = `${DEFILLAMA_API_BASE}/protocol/${protocolSlug}`;
    const response = await globalThis.fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) {
        return { tvl: null, isHistorical: false }; // Protocol not found in DeFiLlama
      }
      return { tvl: null, isHistorical: false };
    }
    
    const data = await response.json();
    
    // Try to get historical TVL for Monad chain at end date
    if (data.chainTvls && typeof data.chainTvls === 'object') {
      // Try different case variations for Monad chain
      const monadChainData = data.chainTvls['Monad'] || 
                             data.chainTvls['monad'] || 
                             data.chainTvls['MONAD'];
      
      if (monadChainData && monadChainData.tvl && Array.isArray(monadChainData.tvl)) {
        const historicalTVL = getTVLAtDate(monadChainData.tvl, endTimestamp);
        if (historicalTVL !== null) {
          return { tvl: historicalTVL, isHistorical: true };
        }
      }
    }
    
    // Fallback to current TVL if historical data not available
    if (data.currentChainTvls && typeof data.currentChainTvls === 'object') {
      const monadTVL = data.currentChainTvls['Monad'] || 
                       data.currentChainTvls['monad'] || 
                       data.currentChainTvls['MONAD'];
      
      if (monadTVL !== undefined && monadTVL !== null) {
        return { tvl: parseFloat(String(monadTVL)), isHistorical: false };
      }
      
      // If no Monad-specific TVL, return total TVL for single-chain protocols
      if (data.chains && Array.isArray(data.chains) && data.chains.length === 1) {
        return { tvl: data.tvl || null, isHistorical: false };
      }
    }
    
    return { tvl: null, isHistorical: false };
  } catch (error) {
    console.error(`Error fetching TVL for ${protocolSlug}:`, error);
    return { tvl: null, isHistorical: false };
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
      volume24h: number | null;
      volume7d: number | null;
      volume30d: number | null;
      volumeAtDate: number | null;
      isHistorical: boolean;
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
