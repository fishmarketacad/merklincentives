import { NextRequest, NextResponse } from 'next/server';
import { getEpochByIdAsync, Epoch } from '@/lib/epochs';
import { PoolData } from '../epoch-data/route';

// Base URL helper (copied from epoch-data/route.ts)
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

// Progressive loading endpoint
// Stage 1: MON incentive data from Merkl (fast - 2-3s)
// Stage 2: TVL data added (additional 1-2s)
// Stage 3: Volume data added (additional 2-3s)
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

    if (stage === 1) {
      // Stage 1: Fetch MON incentive data only
      const data = await fetchStage1(epoch, baseUrl);
      return NextResponse.json(data);
    } else if (stage === 2) {
      // Stage 2: Fetch MON + TVL data
      const data = await fetchStage2(epoch, baseUrl);
      return NextResponse.json(data);
    } else {
      // Stage 3: Fetch MON + TVL + Volume data (complete)
      const data = await fetchStage3(epoch, baseUrl);
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

// Stage 1: MON data from Merkl
async function fetchStage1(epoch: Epoch, baseUrl: string): Promise<ProgressiveResponse> {
  console.log('[Progressive Stage 1] Fetching MON incentives');

  // Fetch incentives from Merkl
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

  // Process pools with MON data only (no TVL/volume yet)
  const pools: PoolData[] = [];
  const protocolTotals: Record<string, PoolData> = {};
  const funderTotals: Record<string, PoolData> = {};
  const funderTvlMap: Record<string, number> = {};

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
        funderTvlMap[funderKey] = 0;
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
          tvl: null, // Stage 1: no TVL yet
          volume: null, // Stage 1: no volume yet
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
  for (const key of Object.keys(funderTotals)) {
    const total = funderTotals[key];
    total.monValueUSD = total.monQuantity * epoch.monTwap;
    total.adjustedTotal = total.monValueUSD + total.externalIncentiveUSD;
  }

  for (const key of Object.keys(protocolTotals)) {
    const total = protocolTotals[key];
    total.monValueUSD = total.monQuantity * epoch.monTwap;
    total.adjustedTotal = total.monValueUSD + total.externalIncentiveUSD;
  }

  console.log('[Progressive Stage 1] Complete. Pools:', pools.length);

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

// Stage 2: MON + TVL data
async function fetchStage2(epoch: Epoch, baseUrl: string): Promise<ProgressiveResponse> {
  console.log('[Progressive Stage 2] Fetching MON + TVL');

  // First get Stage 1 data
  const stage1Data = await fetchStage1(epoch, baseUrl);

  // Now fetch TVL data
  const TVL_PROTOCOLS = [
    'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
    'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
    'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi'
  ];

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

  // Fetch Uniswap V4 pool-level TVL
  let uniswapPoolTvl: Record<string, number> = {};
  try {
    const uniswapResponse = await fetch(`${baseUrl}/api/uniswap-tvl?date=${epoch.snapshotDate}`, {
      cache: 'no-store',
    });
    if (uniswapResponse.ok) {
      const uniswapData = await uniswapResponse.json();
      for (const [poolName, poolInfo] of Object.entries(uniswapData.pools || {})) {
        uniswapPoolTvl[poolName] = (poolInfo as { tvlUSD: number }).tvlUSD;
      }
      console.log('[Progressive Stage 2] Uniswap pool TVLs:', Object.keys(uniswapPoolTvl).length);
    }
  } catch (e) {
    console.log('[Progressive Stage 2] Uniswap TVL fetch error:', e);
  }

  // Update pools with TVL data
  const updatedPools = stage1Data.pools.map(pool => {
    const protocolKey = normalizeProtocol(pool.protocol);
    let poolTvl = null;

    // For Uniswap pools, try pool-level TVL
    if (pool.protocol.toLowerCase().includes('uniswap')) {
      const tokenPairMatch = pool.pool.match(/([A-Za-z0-9]+)-([A-Za-z0-9]+)/);
      if (tokenPairMatch) {
        const tokenPair = `${tokenPairMatch[1]}/${tokenPairMatch[2]}`.toUpperCase();
        poolTvl = uniswapPoolTvl[tokenPair] || uniswapPoolTvl[`${tokenPairMatch[2]}/${tokenPairMatch[1]}`.toUpperCase()] || null;
      }
    }

    return {
      ...pool,
      tvl: poolTvl,
    };
  });

  // Update protocol totals with TVL
  const updatedProtocolTotals = { ...stage1Data.protocolTotals };
  for (const [key, total] of Object.entries(updatedProtocolTotals)) {
    total.tvl = tvlData.tvlData?.[key] || null;
  }

  // Add protocols with TVL but no Merkl campaigns
  const protocolsWithTVL = Object.keys(tvlData.tvlData || {});
  for (const protocolKey of protocolsWithTVL) {
    if (!updatedProtocolTotals[protocolKey]) {
      const tvl = tvlData.tvlData?.[protocolKey];
      if (tvl) {
        updatedProtocolTotals[protocolKey] = {
          protocol: protocolKey.toUpperCase(),
          pool: 'ALL',
          monQuantity: 0,
          externalIncentiveUSD: 0,
          tvl,
          volume: null,
          monValueUSD: 0,
          adjustedTotal: 0,
        };
      }
    }
  }

  // Update funder totals with aggregated TVL
  const updatedFunderTotals = { ...stage1Data.funderTotals };
  const funderTvlMap: Record<string, number> = {};
  for (const pool of updatedPools) {
    // Find which funder(s) funded this pool
    for (const [funderKey] of Object.entries(updatedFunderTotals)) {
      if (!funderTvlMap[funderKey]) funderTvlMap[funderKey] = 0;
      if (pool.tvl && pool.tvl > 0) {
        // Simple aggregation - this may need refinement based on your data structure
        funderTvlMap[funderKey] += pool.tvl / Object.keys(updatedFunderTotals).length; // Simplified
      }
    }
  }

  for (const [key, total] of Object.entries(updatedFunderTotals)) {
    total.tvl = funderTvlMap[key] > 0 ? funderTvlMap[key] : null;
  }

  console.log('[Progressive Stage 2] Complete with TVL data');

  return {
    stage: 2,
    completed: false,
    pools: updatedPools,
    protocolTotals: updatedProtocolTotals,
    funderTotals: updatedFunderTotals,
    epoch,
    fetchedAt: new Date().toISOString(),
  };
}

// Stage 3: Complete data with volumes
async function fetchStage3(epoch: Epoch, baseUrl: string): Promise<ProgressiveResponse> {
  console.log('[Progressive Stage 3] Fetching complete data with volumes');

  // Get Stage 2 data first
  const stage2Data = await fetchStage2(epoch, baseUrl);

  // Fetch protocol-level volumes
  const TVL_PROTOCOLS = [
    'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
    'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
    'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi'
  ];

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

  // Fetch per-market volumes
  const markets: { protocol: string; marketName: string }[] = stage2Data.pools.map(pool => ({
    protocol: pool.protocol,
    marketName: pool.pool
  }));

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
        console.log('[Progressive Stage 3] Market volumes:', Object.keys(marketVolumes).length);
      }
    } catch (e) {
      console.error('[Progressive Stage 3] Volume fetch error:', e);
    }
  }

  // Update pools with volume data
  const updatedPools = stage2Data.pools.map(pool => {
    const marketKey = `${pool.protocol.toLowerCase()}-${pool.pool}`;
    const perMarketVol = marketVolumes[marketKey];
    return {
      ...pool,
      volume: perMarketVol?.volumeInRange || perMarketVol?.volume7d || null,
    };
  });

  // Update protocol totals with volume
  const updatedProtocolTotals = { ...stage2Data.protocolTotals };
  for (const [key, total] of Object.entries(updatedProtocolTotals)) {
    total.volume = tvlData.dexVolumeData?.[key]?.volumeInRange ||
                   tvlData.dexVolumeData?.[key]?.volume7d || null;
  }

  // Add protocols with volume but no Merkl campaigns
  const protocolsWithVolume = Object.keys(tvlData.dexVolumeData || {});
  for (const protocolKey of protocolsWithVolume) {
    if (!updatedProtocolTotals[protocolKey]) {
      const vol = tvlData.dexVolumeData?.[protocolKey];
      if (vol) {
        updatedProtocolTotals[protocolKey] = {
          protocol: protocolKey.toUpperCase(),
          pool: 'ALL',
          monQuantity: 0,
          externalIncentiveUSD: 0,
          tvl: null,
          volume: vol?.volumeInRange || vol?.volume7d || null,
          monValueUSD: 0,
          adjustedTotal: 0,
        };
      }
    }
  }

  console.log('[Progressive Stage 3] Complete with all data');

  return {
    stage: 3,
    completed: true,
    pools: updatedPools,
    protocolTotals: updatedProtocolTotals,
    funderTotals: stage2Data.funderTotals,
    epoch,
    fetchedAt: new Date().toISOString(),
  };
}
