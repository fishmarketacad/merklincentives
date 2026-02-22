import { NextRequest, NextResponse } from 'next/server';
import { EPOCHS, getEpochByIdAsync, getAllEpochs, Epoch } from '@/lib/epochs';
import { getCachedEpochData, cacheEpochData } from '@/app/lib/cache';

export interface PoolData {
  protocol: string;
  pool: string;
  monQuantity: number;
  externalIncentiveUSD: number;
  tvl: number | null;
  volume: number | null;
  // Calculated fields
  monValueUSD: number;
  adjustedTotal: number;
}

export interface EpochData {
  epoch: Epoch;
  pools: PoolData[];
  protocolTotals: Record<string, PoolData>;
  funderTotals: Record<string, PoolData>; // Aggregates by funding protocol (e.g., RENZO, WLFI)
  fetchedAt: string;
  debug?: {
    baseUrl: string;
    monDataResults: number;
    tvlDataKeys: string[];
    volumeDataKeys: string[];
  };
}

// For TVL/Volume queries - individual protocols
const TVL_PROTOCOLS = [
  'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
  'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
  'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi',
  'neverland'
];

// For Merkl incentives queries - use 'all' to get all campaigns (avoids case-sensitivity issues)
const MERKL_PROTOCOLS = ['all'];

/** Base URL for self-requests (avoids "fetch failed" on localhost: use nextUrl.origin + IPv4 for reliability) */
function getBaseUrl(request: NextRequest): string {
  const origin = request.nextUrl?.origin;
  if (origin) {
    // Use 127.0.0.1 instead of localhost to avoid IPv6 vs IPv4 mismatch when server calls itself
    if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
      const port = request.nextUrl.port || (origin.startsWith('https') ? '3000' : '3000');
      return `http://127.0.0.1:${port}`;
    }
    return origin;
  }
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'http';
  if (host) {
    const base = `${proto}://${host}`;
    if (base.includes('localhost')) {
      const port = (host.split(':')[1]) || '3000';
      return `http://127.0.0.1:${port}`;
    }
    return base;
  }
  return 'http://127.0.0.1:3000';
}

// GET: List all epochs or get data for specific epoch
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const epochId = searchParams.get('epoch');
  const forceRefresh = searchParams.get('refresh') === 'true';

  // If no epoch specified, return list of all epochs (including dynamic)
  if (!epochId) {
    const allEpochs = await getAllEpochs();
    return NextResponse.json({
      epochs: allEpochs.map(e => ({
        id: e.id,
        name: e.name,
        startDate: e.startDate,
        endDate: e.endDate,
      }))
    });
  }

  // Get specific epoch (check both hardcoded and dynamic)
  const epoch = await getEpochByIdAsync(epochId);
  if (!epoch) {
    return NextResponse.json({ error: 'Epoch not found' }, { status: 404 });
  }

  // Check if this is a historical epoch (ended more than 1 day ago)
  const isHistorical = new Date(epoch.endDate).getTime() < Date.now() - 86400000;

  // Check Redis cache (unless force refresh)
  if (!forceRefresh) {
    const cached = await getCachedEpochData(epochId);
    if (cached) {
      console.log(`[EpochData] Cache hit for epoch ${epochId}`);
      return NextResponse.json(cached);
    }
  }

  try {
    const baseUrl = getBaseUrl(request);

    const data = await fetchEpochData(epoch, baseUrl);

    // Cache in Redis (longer TTL for historical epochs)
    await cacheEpochData(epochId, data, isHistorical);
    console.log(`[EpochData] Cached epoch ${epochId} (historical: ${isHistorical})`);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching epoch data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch epoch data', details: String(error) },
      { status: 500 }
    );
  }
}

// POST: Force refresh epoch data
export async function POST(request: NextRequest) {
  try {
    const { epochId } = await request.json();

    const epoch = await getEpochByIdAsync(epochId);
    if (!epoch) {
      return NextResponse.json({ error: 'Epoch not found' }, { status: 404 });
    }

    // Check if this is a historical epoch
    const isHistorical = new Date(epoch.endDate).getTime() < Date.now() - 86400000;

    const baseUrl = getBaseUrl(request);

    const data = await fetchEpochData(epoch, baseUrl);

    // Cache in Redis
    await cacheEpochData(epochId, data, isHistorical);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error refreshing epoch data:', error);
    return NextResponse.json(
      { error: 'Failed to refresh', details: String(error) },
      { status: 500 }
    );
  }
}

async function fetchEpochData(epoch: Epoch, baseUrl: string): Promise<EpochData> {
  console.log('[EpochData] Fetching for epoch:', epoch.id, 'dates:', epoch.startDate, 'to', epoch.endDate);
  console.log('[EpochData] Using baseUrl:', baseUrl);

  // Fetch incentives from Merkl (use 'all' to get all campaigns, avoids mainProtocolId case-sensitivity issues)
  const monResponse = await fetch(`${baseUrl}/api/query-mon-spent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocols: MERKL_PROTOCOLS,
      startDate: epoch.startDate,
      endDate: epoch.endDate,
      token: 'MON'
    }),
    cache: 'no-store',
  });

  if (!monResponse.ok) {
    const errorText = await monResponse.text();
    console.error('[EpochData] Failed to fetch incentives:', monResponse.status, errorText);
    throw new Error(`Failed to fetch incentives: ${errorText}`);
  }

  const monData = await monResponse.json();
  console.log('[EpochData] Merkl data results:', monData.results?.length || 0);
  if (monData.results && monData.results.length > 0) {
    console.log('[EpochData] First result platform:', monData.results[0].platformProtocol);
  } else {
    console.log('[EpochData] No Merkl results - check date range and API response');
  }

  // Fetch TVL/Volume (use individual protocols list)
  const tvlResponse = await fetch(`${baseUrl}/api/protocol-tvl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocols: TVL_PROTOCOLS,
      startDate: epoch.startDate,
      endDate: epoch.endDate
    }),
    cache: 'no-store',
  });

  const tvlData = tvlResponse.ok ? await tvlResponse.json() : { tvlData: {}, dexVolumeData: {} };

  // Fetch Uniswap V4 pool-level TVL from The Graph
  let uniswapPoolTvl: Record<string, number> = {};
  try {
    const uniswapResponse = await fetch(`${baseUrl}/api/uniswap-tvl?date=${epoch.endDate}`, {
      cache: 'no-store',
    });
    if (uniswapResponse.ok) {
      const uniswapData = await uniswapResponse.json();
      // Map pool names to TVL values
      for (const [poolName, poolInfo] of Object.entries(uniswapData.pools || {})) {
        uniswapPoolTvl[poolName] = (poolInfo as { tvlUSD: number }).tvlUSD;
      }
      console.log('[EpochData] Uniswap pool TVLs fetched:', Object.keys(uniswapPoolTvl).length);
    } else {
      console.log('[EpochData] Uniswap TVL fetch failed (may need THEGRAPH_API_KEY)');
    }
  } catch (e) {
    console.log('[EpochData] Uniswap TVL fetch error:', e);
  }
  console.log('[EpochData] TVL data keys:', Object.keys(tvlData.tvlData || {}));
  console.log('[EpochData] Volume data keys:', Object.keys(tvlData.dexVolumeData || {}));
  console.log('[EpochData] Uniswap pool TVL keys:', Object.keys(uniswapPoolTvl));

  // Fetch per-market volumes
  const markets: { protocol: string; marketName: string }[] = [];
  for (const platform of (monData.results || [])) {
    for (const funding of (platform.fundingProtocols || [])) {
      for (const market of (funding.markets || [])) {
        markets.push({
          protocol: platform.platformProtocol,
          marketName: market.marketName
        });
      }
    }
  }

  console.log('[EpochData] Markets to fetch volumes for:', markets.length);

  let marketVolumes: Record<string, { volumeInRange?: number; volume7d?: number }> = {};
  if (markets.length > 0) {
    try {
      const volResponse = await fetch(`${baseUrl}/api/protocol-tvl`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markets,
          startDate: epoch.startDate,
          endDate: epoch.endDate
        }),
        cache: 'no-store',
      });
      if (volResponse.ok) {
        const volData = await volResponse.json();
        marketVolumes = volData.marketVolumes || {};
        console.log('[EpochData] Market volumes fetched:', Object.keys(marketVolumes).length);
      }
    } catch (e) {
      console.error('[EpochData] Failed to fetch market volumes:', e);
    }
  }

  // Process pools
  const pools: PoolData[] = [];
  const protocolTotals: Record<string, PoolData> = {};
  const funderTotals: Record<string, PoolData> = {}; // Track by funding protocol
  const funderTvlMap: Record<string, number> = {}; // Aggregate TVL by funder

  for (const platform of (monData.results || [])) {
    const protocolKey = normalizeProtocol(platform.platformProtocol);

    // Initialize protocol total
    if (!protocolTotals[protocolKey]) {
      protocolTotals[protocolKey] = {
        protocol: platform.platformProtocol,
        pool: 'ALL',
        monQuantity: 0,
        externalIncentiveUSD: 0,
        tvl: tvlData.tvlData?.[protocolKey] || null,
        volume: tvlData.dexVolumeData?.[protocolKey]?.volumeInRange ||
                tvlData.dexVolumeData?.[protocolKey]?.volume7d || null,
        monValueUSD: 0,
        adjustedTotal: 0,
      };
    }

    for (const funding of (platform.fundingProtocols || [])) {
      const funderKey = normalizeProtocol(funding.fundingProtocol);

      // Initialize funder total if not exists
      if (!funderTotals[funderKey]) {
        funderTotals[funderKey] = {
          protocol: funding.fundingProtocol,
          pool: 'ALL (Funder)',
          monQuantity: 0,
          externalIncentiveUSD: 0,
          tvl: null, // Will be aggregated from markets
          volume: null,
          monValueUSD: 0,
          adjustedTotal: 0,
        };
        funderTvlMap[funderKey] = 0;
      }

      for (const market of (funding.markets || [])) {
        // Key format must match protocol-tvl PUT response: "protocol-marketName"
        const marketKey = `${platform.platformProtocol.toLowerCase()}-${market.marketName}`;
        const perMarketVol = marketVolumes[marketKey];

        const monQty = market.totalMON || 0;
        const extUSD = market.externalIncentiveUSD || 0;
        const monValueUSD = monQty * epoch.monTwap;

        // For Uniswap pools, try to get pool-level TVL from The Graph
        let poolTvl = market.tvl || null;
        if (platform.platformProtocol.toLowerCase().includes('uniswap')) {
          // Extract token pair from market name (e.g., "Provide liquidity to UniswapV4 MON-USDC 0.05%" -> "MON/USDC")
          const tokenPairMatch = market.marketName.match(/([A-Za-z0-9]+)-([A-Za-z0-9]+)/);
          if (tokenPairMatch) {
            const tokenPair = `${tokenPairMatch[1]}/${tokenPairMatch[2]}`.toUpperCase();
            const uniPoolTvl = uniswapPoolTvl[tokenPair];
            if (uniPoolTvl) {
              poolTvl = uniPoolTvl;
            } else {
              // Try reverse order (e.g., "USDC/MON" instead of "MON/USDC")
              const reversePair = `${tokenPairMatch[2]}/${tokenPairMatch[1]}`.toUpperCase();
              const reversePoolTvl = uniswapPoolTvl[reversePair];
              if (reversePoolTvl) {
                poolTvl = reversePoolTvl;
              }
            }
          }
        }

        const poolData: PoolData = {
          protocol: platform.platformProtocol,
          pool: market.marketName,
          monQuantity: monQty,
          externalIncentiveUSD: extUSD,
          tvl: poolTvl,
          volume: perMarketVol?.volumeInRange || perMarketVol?.volume7d || null,
          monValueUSD,
          adjustedTotal: monValueUSD + extUSD,
        };

        pools.push(poolData);

        // Aggregate to protocol total
        protocolTotals[protocolKey].monQuantity += monQty;
        protocolTotals[protocolKey].externalIncentiveUSD += extUSD;

        // Aggregate to funder total
        funderTotals[funderKey].monQuantity += monQty;
        funderTotals[funderKey].externalIncentiveUSD += extUSD;

        // Aggregate TVL for funder (sum of all markets they fund)
        if (poolTvl && poolTvl > 0) {
          funderTvlMap[funderKey] += poolTvl;
        }
      }
    }
  }

  // Calculate funder totals USD values and TVL
  for (const key of Object.keys(funderTotals)) {
    const total = funderTotals[key];
    total.monValueUSD = total.monQuantity * epoch.monTwap;
    total.adjustedTotal = total.monValueUSD + total.externalIncentiveUSD;
    total.tvl = funderTvlMap[key] > 0 ? funderTvlMap[key] : null;
  }

  // Calculate protocol totals USD values
  for (const key of Object.keys(protocolTotals)) {
    const total = protocolTotals[key];
    total.monValueUSD = total.monQuantity * epoch.monTwap;
    total.adjustedTotal = total.monValueUSD + total.externalIncentiveUSD;
  }

  // Add protocols that have TVL/Volume but no Merkl campaigns
  const protocolsWithTVL = Object.keys(tvlData.tvlData || {});
  const protocolsWithVolume = Object.keys(tvlData.dexVolumeData || {});
  const allProtocolsWithData = [...new Set([...protocolsWithTVL, ...protocolsWithVolume])];

  for (const protocolKey of allProtocolsWithData) {
    if (!protocolTotals[protocolKey]) {
      const tvl = tvlData.tvlData?.[protocolKey];
      const vol = tvlData.dexVolumeData?.[protocolKey];
      if (tvl || vol) {
        protocolTotals[protocolKey] = {
          protocol: protocolKey.toUpperCase(),
          pool: 'ALL',
          monQuantity: 0,
          externalIncentiveUSD: 0,
          tvl: tvl || null,
          volume: vol?.volumeInRange || vol?.volume7d || null,
          monValueUSD: 0,
          adjustedTotal: 0,
        };
      }
    }
  }

  console.log('[EpochData] Final pools:', pools.length, 'Protocol totals:', Object.keys(protocolTotals).length, 'Funder totals:', Object.keys(funderTotals).length);

  return {
    epoch,
    pools,
    protocolTotals,
    funderTotals,
    fetchedAt: new Date().toISOString(),
    debug: {
      baseUrl,
      monDataResults: monData.results?.length || 0,
      tvlDataKeys: Object.keys(tvlData.tvlData || {}),
      volumeDataKeys: Object.keys(tvlData.dexVolumeData || {}),
    },
  };
}

function normalizeProtocol(name: string): string {
  return name.toLowerCase()
    .replace(/[-_\s]+/g, '')
    .replace('pancake-swap', 'pancakeswap');
}
