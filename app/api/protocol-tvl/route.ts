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
  'pancakeswap': 'pancakeswap-v3',
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
    const { protocols, endDate } = body;

    if (!protocols || !Array.isArray(protocols) || protocols.length === 0) {
      return NextResponse.json(
        { error: 'Protocols array is required' },
        { status: 400 }
      );
    }

    // Convert end date to timestamp for historical TVL lookup
    let endTimestamp = Math.floor(Date.now() / 1000); // Default to current time
    if (endDate) {
      const end = new Date(endDate + 'T23:59:59Z');
      if (!isNaN(end.getTime())) {
        endTimestamp = Math.floor(end.getTime() / 1000);
      }
    }

    // Fetch TVL for each protocol
    const tvlData: Record<string, number | null> = {};
    const tvlMetadata: Record<string, { isHistorical: boolean }> = {};
    
    for (const protocol of protocols) {
      const protocolSlug = PROTOCOL_SLUG_MAP[protocol.toLowerCase()];
      if (protocolSlug) {
        const result = await fetchProtocolTVL(protocolSlug, endTimestamp);
        tvlData[protocol] = result.tvl;
        tvlMetadata[protocol] = { isHistorical: result.isHistorical };
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } else {
        tvlData[protocol] = null;
        tvlMetadata[protocol] = { isHistorical: false };
      }
    }

    return NextResponse.json({
      success: true,
      tvlData,
      tvlMetadata,
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
