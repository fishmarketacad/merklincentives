import { NextRequest, NextResponse } from 'next/server';
import { getEpochByIdAsync, Epoch } from '@/lib/epochs';
import { PoolData } from '../epoch-data/route';

function getBaseUrl(request: NextRequest): string {
  const origin = request.nextUrl?.origin;
  if (origin) {
    if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
      const port = request.nextUrl.port || '3000';
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

function normalizeProtocol(name: string): string {
  return name.toLowerCase()
    .replace(/[-_\s]+/g, '')
    .replace('pancake-swap', 'pancakeswap');
}

interface ProgressiveResponse {
  stage: 1 | 2 | 3;
  completed: boolean;
  pools: PoolData[];
  protocolTotals: Record<string, PoolData>;
  funderTotals: Record<string, PoolData>;
  epoch: Epoch;
  fetchedAt: string;
}

// Optimized progressive loading endpoint
// Uses parallel fetching where possible, only fetches what's needed per stage
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const epochId = searchParams.get('epoch');
  const stage = parseInt(searchParams.get('stage') || '1', 10) as 1 | 2 | 3;

  if (!epochId) {
    return NextResponse.json({ error: 'Missing epoch parameter' }, { status: 400 });
  }

  if (![1, 2, 3].includes(stage)) {
    return NextResponse.json({ error: 'Invalid stage. Must be 1, 2, or 3' }, { status: 400 });
  }

  const epoch = await getEpochByIdAsync(epochId);
  if (!epoch) {
    return NextResponse.json({ error: 'Epoch not found' }, { status: 404 });
  }

  try {
    const baseUrl = getBaseUrl(request);

    // All stages fetch in parallel now!
    // Stage 1: MON only
    // Stage 2: MON + TVL (parallel)
    // Stage 3: MON + TVL (parallel) + Volumes (sequential, depends on MON)

    if (stage === 1) {
      const data = await fetchMONOnly(epoch, baseUrl);
      return NextResponse.json(data);
    } else if (stage === 2) {
      // Fetch MON and TVL in parallel
      const data = await fetchWithTVL(epoch, baseUrl);
      return NextResponse.json(data);
    } else {
      // Fetch MON + TVL in parallel, then volumes
      const data = await fetchComplete(epoch, baseUrl);
      return NextResponse.json(data);
    }
  } catch (error) {
    console.error(`[Progressive] Stage ${stage} error:`, error);
    return NextResponse.json(
      { error: `Failed to fetch stage ${stage}`, details: String(error) },
      { status: 500 }
    );
  }
}

// Stage 1: MON data only (fastest)
async function fetchMONOnly(epoch: Epoch, baseUrl: string): Promise<ProgressiveResponse> {
  console.log('[Progressive Stage 1] Fetching MON incentives only');

  const monResponse = await fetch(`${baseUrl}/api/query-mon-spent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocols: ['all'],
      startDate: epoch.startDate,
      endDate: epoch.endDate,
      token: 'MON'
    }),
    cache: 'no-store',
  });

  if (!monResponse.ok) {
    throw new Error(`Merkl API failed: ${await monResponse.text()}`);
  }

  const monData = await monResponse.json();
  console.log('[Progressive Stage 1] Merkl results:', monData.results?.length || 0);

  const { pools, protocolTotals, funderTotals } = processMONData(monData, epoch);

  return {
    stage: 1,
    completed: false,
    pools,
    protocolTotals,
    funderTotals,
    epoch,
    fetchedAt: new Date().toISOString(),
  };
}

// Stage 2: MON + TVL (parallel fetch)
async function fetchWithTVL(epoch: Epoch, baseUrl: string): Promise<ProgressiveResponse> {
  console.log('[Progressive Stage 2] Fetching MON + TVL in parallel');

  const TVL_PROTOCOLS = [
    'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
    'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
    'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi'
  ];

  // Fetch MON, protocol TVL, and Uniswap TVL all in parallel!
  const [monResponse, tvlResponse, uniswapResponse] = await Promise.all([
    fetch(`${baseUrl}/api/query-mon-spent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocols: ['all'],
        startDate: epoch.startDate,
        endDate: epoch.endDate,
        token: 'MON'
      }),
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/protocol-tvl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocols: TVL_PROTOCOLS,
        startDate: epoch.startDate,
        endDate: epoch.endDate
      }),
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/uniswap-tvl?date=${epoch.snapshotDate}`, {
      cache: 'no-store',
    }).catch(() => null)
  ]);

  if (!monResponse.ok) {
    throw new Error(`Merkl API failed: ${await monResponse.text()}`);
  }

  const monData = await monResponse.json();
  const tvlData = tvlResponse.ok ? await tvlResponse.json() : { tvlData: {}, dexVolumeData: {} };

  let uniswapPoolTvl: Record<string, number> = {};
  if (uniswapResponse && uniswapResponse.ok) {
    const uniswapData = await uniswapResponse.json();
    for (const [poolName, poolInfo] of Object.entries(uniswapData.pools || {})) {
      uniswapPoolTvl[poolName] = (poolInfo as { tvlUSD: number }).tvlUSD;
    }
    console.log('[Progressive Stage 2] Uniswap pool TVLs:', Object.keys(uniswapPoolTvl).length);
  }

  const { pools, protocolTotals, funderTotals } = processMONData(monData, epoch);

  // Override TVL data for Uniswap pools with The Graph data (more accurate)
  const poolsWithTVL = pools.map(pool => {
    // Start with existing TVL from Merkl
    let poolTvl = pool.tvl;

    // Override with The Graph TVL for Uniswap pools (more accurate)
    if (pool.protocol.toLowerCase().includes('uniswap')) {
      const tokenPairMatch = pool.pool.match(/([A-Za-z0-9]+)-([A-Za-z0-9]+)/);
      if (tokenPairMatch) {
        const tokenPair = `${tokenPairMatch[1]}/${tokenPairMatch[2]}`.toUpperCase();
        const graphTvl = uniswapPoolTvl[tokenPair] || uniswapPoolTvl[`${tokenPairMatch[2]}/${tokenPairMatch[1]}`.toUpperCase()];
        if (graphTvl) {
          poolTvl = graphTvl;
        }
      }
    }
    return { ...pool, tvl: poolTvl };
  });

  // Add TVL to protocol totals
  for (const [key, total] of Object.entries(protocolTotals)) {
    total.tvl = tvlData.tvlData?.[key] || null;
  }

  // Add protocols with TVL but no campaigns
  for (const protocolKey of Object.keys(tvlData.tvlData || {})) {
    if (!protocolTotals[protocolKey] && tvlData.tvlData[protocolKey]) {
      protocolTotals[protocolKey] = {
        protocol: protocolKey.toUpperCase(),
        pool: 'ALL',
        monQuantity: 0,
        externalIncentiveUSD: 0,
        tvl: tvlData.tvlData[protocolKey],
        volume: null,
        monValueUSD: 0,
        adjustedTotal: 0,
      };
    }
  }

  console.log('[Progressive Stage 2] Complete with TVL data');

  return {
    stage: 2,
    completed: false,
    pools: poolsWithTVL,
    protocolTotals,
    funderTotals,
    epoch,
    fetchedAt: new Date().toISOString(),
  };
}

// Stage 3: Complete (MON + TVL parallel + Volumes sequential)
async function fetchComplete(epoch: Epoch, baseUrl: string): Promise<ProgressiveResponse> {
  console.log('[Progressive Stage 3] Fetching complete data');

  // Get Stage 2 data (MON + TVL in parallel)
  const stage2Data = await fetchWithTVL(epoch, baseUrl);

  const TVL_PROTOCOLS = [
    'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
    'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
    'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi'
  ];

  // Fetch protocol volumes and per-market volumes in parallel
  const [tvlResponse, marketVolumesResponse] = await Promise.all([
    fetch(`${baseUrl}/api/protocol-tvl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocols: TVL_PROTOCOLS,
        startDate: epoch.startDate,
        endDate: epoch.endDate
      }),
      cache: 'no-store',
    }),
    fetch(`${baseUrl}/api/protocol-tvl`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        markets: stage2Data.pools.map(p => ({
          protocol: p.protocol,
          marketName: p.pool
        })),
        startDate: epoch.startDate,
        endDate: epoch.endDate
      }),
      cache: 'no-store',
    }).catch(() => null)
  ]);

  const tvlData = tvlResponse.ok ? await tvlResponse.json() : { dexVolumeData: {} };
  const marketVolumes = (marketVolumesResponse && marketVolumesResponse.ok)
    ? (await marketVolumesResponse.json()).marketVolumes || {}
    : {};

  // Add volumes to pools
  const poolsWithVolumes = stage2Data.pools.map(pool => {
    const marketKey = `${pool.protocol.toLowerCase()}-${pool.pool}`;
    const perMarketVol = marketVolumes[marketKey];
    return {
      ...pool,
      volume: perMarketVol?.volumeInRange || perMarketVol?.volume7d || null,
    };
  });

  // Add volumes to protocol totals
  for (const [key, total] of Object.entries(stage2Data.protocolTotals)) {
    total.volume = tvlData.dexVolumeData?.[key]?.volumeInRange ||
                   tvlData.dexVolumeData?.[key]?.volume7d || null;
  }

  console.log('[Progressive Stage 3] Complete with all data');

  return {
    stage: 3,
    completed: true,
    pools: poolsWithVolumes,
    protocolTotals: stage2Data.protocolTotals,
    funderTotals: stage2Data.funderTotals,
    epoch,
    fetchedAt: new Date().toISOString(),
  };
}

// Helper to process MON data into pools
function processMONData(monData: any, epoch: Epoch) {
  const pools: PoolData[] = [];
  const protocolTotals: Record<string, PoolData> = {};
  const funderTotals: Record<string, PoolData> = {};

  for (const platform of (monData.results || [])) {
    const protocolKey = normalizeProtocol(platform.platformProtocol);

    if (!protocolTotals[protocolKey]) {
      protocolTotals[protocolKey] = {
        protocol: platform.platformProtocol,
        pool: 'ALL',
        monQuantity: 0,
        externalIncentiveUSD: 0,
        tvl: null,
        volume: null,
        monValueUSD: 0,
        adjustedTotal: 0,
      };
    }

    for (const funding of (platform.fundingProtocols || [])) {
      const funderKey = normalizeProtocol(funding.fundingProtocol);

      if (!funderTotals[funderKey]) {
        funderTotals[funderKey] = {
          protocol: funding.fundingProtocol,
          pool: 'ALL (Funder)',
          monQuantity: 0,
          externalIncentiveUSD: 0,
          tvl: null,
          volume: null,
          monValueUSD: 0,
          adjustedTotal: 0,
        };
      }

      for (const market of (funding.markets || [])) {
        const monQty = market.totalMON || 0;
        const extUSD = market.externalIncentiveUSD || 0;
        const monValueUSD = monQty * epoch.monTwap;

        const poolData: PoolData = {
          protocol: platform.platformProtocol,
          pool: market.marketName,
          monQuantity: monQty,
          externalIncentiveUSD: extUSD,
          tvl: market.tvl || null,  // Use TVL from Merkl market data
          volume: null,
          monValueUSD,
          adjustedTotal: monValueUSD + extUSD,
        };

        pools.push(poolData);

        protocolTotals[protocolKey].monQuantity += monQty;
        protocolTotals[protocolKey].externalIncentiveUSD += extUSD;

        funderTotals[funderKey].monQuantity += monQty;
        funderTotals[funderKey].externalIncentiveUSD += extUSD;
      }
    }
  }

  // Calculate USD values
  for (const total of Object.values(funderTotals)) {
    total.monValueUSD = total.monQuantity * epoch.monTwap;
    total.adjustedTotal = total.monValueUSD + total.externalIncentiveUSD;
  }

  for (const total of Object.values(protocolTotals)) {
    total.monValueUSD = total.monQuantity * epoch.monTwap;
    total.adjustedTotal = total.monValueUSD + total.externalIncentiveUSD;
  }

  return { pools, protocolTotals, funderTotals };
}
