import { NextRequest, NextResponse } from 'next/server';
import {
  saveDailyIndex,
  getDailyIndex,
  isDateIndexed,
  getIndexedDates,
  DailyIndex,
  DailyPoolData,
  DailyProtocolData,
  DailyFunderData,
  DailyMarketData,
  DailyMeta,
} from '@/app/lib/cache';
import { getMonPrice } from '@/app/lib/monPrice';

// Protocols to fetch TVL/volume for
const TVL_PROTOCOLS = [
  'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
  'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
  'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi',
  'neverland'
];

// Current schema version
const SCHEMA_VERSION = 1;

/**
 * GET: Check index status or retrieve indexed data
 *
 * Query params:
 * - date: Get index for specific date (YYYY-MM-DD)
 * - list: If 'true', return list of all indexed dates
 * - check: If date provided, check if indexed without returning full data
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');
  const list = searchParams.get('list') === 'true';
  const check = searchParams.get('check') === 'true';

  // List all indexed dates
  if (list) {
    const dates = await getIndexedDates();
    return NextResponse.json({ indexedDates: dates, count: dates.length });
  }

  // Check or get specific date
  if (date) {
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, { status: 400 });
    }

    // Just check if indexed
    if (check) {
      const indexed = await isDateIndexed(date);
      return NextResponse.json({ date, indexed });
    }

    // Get full index data
    const index = await getDailyIndex(date);
    if (!index) {
      return NextResponse.json({ error: 'Date not indexed', date }, { status: 404 });
    }

    return NextResponse.json(index);
  }

  return NextResponse.json({
    message: 'Daily Index API',
    usage: {
      'GET ?list=true': 'List all indexed dates',
      'GET ?date=YYYY-MM-DD': 'Get index for specific date',
      'GET ?date=YYYY-MM-DD&check=true': 'Check if date is indexed',
      'POST { date }': 'Index a specific date',
      'POST { startDate, endDate }': 'Index a date range',
    },
  });
}

/**
 * POST: Index data for a specific date or date range
 *
 * Body:
 * - date: Single date to index (YYYY-MM-DD)
 * - startDate/endDate: Date range to index
 * - force: Re-index even if already indexed
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, startDate, endDate, force = false } = body;

    // Determine dates to index
    let datesToIndex: string[] = [];

    if (date) {
      datesToIndex = [date];
    } else if (startDate && endDate) {
      // Generate date range
      const start = new Date(startDate + 'T00:00:00Z');
      const end = new Date(endDate + 'T00:00:00Z');

      if (start > end) {
        return NextResponse.json({ error: 'startDate must be before endDate' }, { status: 400 });
      }

      const current = new Date(start);
      while (current <= end) {
        datesToIndex.push(current.toISOString().split('T')[0]);
        current.setUTCDate(current.getUTCDate() + 1);
      }
    } else {
      return NextResponse.json({ error: 'Provide date or startDate/endDate' }, { status: 400 });
    }

    // Validate dates
    const today = new Date().toISOString().split('T')[0];
    const minDate = '2025-11-24'; // Monad mainnet launch

    for (const d of datesToIndex) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return NextResponse.json({ error: `Invalid date format: ${d}` }, { status: 400 });
      }
      if (d < minDate) {
        return NextResponse.json({ error: `Date ${d} is before Monad mainnet launch (${minDate})` }, { status: 400 });
      }
      if (d > today) {
        return NextResponse.json({ error: `Cannot index future date: ${d}` }, { status: 400 });
      }
    }

    // Get base URL for internal API calls
    const baseUrl = getBaseUrl(request);

    // Index each date
    const results: { date: string; status: 'indexed' | 'skipped' | 'error'; error?: string }[] = [];

    for (const dateToIndex of datesToIndex) {
      // Check if already indexed
      if (!force && await isDateIndexed(dateToIndex)) {
        results.push({ date: dateToIndex, status: 'skipped' });
        continue;
      }

      try {
        const index = await indexDate(dateToIndex, baseUrl);
        await saveDailyIndex(index);
        results.push({ date: dateToIndex, status: 'indexed' });
      } catch (error: any) {
        console.error(`[DailyIndex] Error indexing ${dateToIndex}:`, error);
        results.push({ date: dateToIndex, status: 'error', error: error.message });
      }

      // Rate limiting between dates
      if (datesToIndex.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const indexed = results.filter(r => r.status === 'indexed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const errors = results.filter(r => r.status === 'error').length;

    return NextResponse.json({
      success: true,
      summary: { total: datesToIndex.length, indexed, skipped, errors },
      results,
    });
  } catch (error: any) {
    console.error('[DailyIndex] POST error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

/**
 * Index a single date
 */
async function indexDate(date: string, baseUrl: string): Promise<DailyIndex> {
  console.log(`[DailyIndex] Indexing ${date}...`);

  // Fetch MON price for the date
  const monPriceResult = await getMonPrice(date);

  // Fetch incentives data from Merkl
  const incentivesResponse = await fetch(`${baseUrl}/api/query-mon-spent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocols: ['all'],
      startDate: date,
      endDate: date,
      token: 'MON',
    }),
    cache: 'no-store',
  });

  const incentivesData = incentivesResponse.ok ? await incentivesResponse.json() : { results: [] };

  // Fetch TVL/volume for protocols
  const tvlResponse = await fetch(`${baseUrl}/api/protocol-tvl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      protocols: TVL_PROTOCOLS,
      startDate: date,
      endDate: date,
    }),
    cache: 'no-store',
  });

  const tvlData = tvlResponse.ok ? await tvlResponse.json() : { tvlData: {}, dexVolumeData: {} };

  // Collect markets for volume queries
  const markets: { protocol: string; marketName: string }[] = [];
  for (const platform of (incentivesData.results || [])) {
    for (const funding of (platform.fundingProtocols || [])) {
      for (const market of (funding.markets || [])) {
        markets.push({
          protocol: platform.platformProtocol,
          marketName: market.marketName,
        });
      }
    }
  }

  // Fetch market volumes
  let marketVolumes: Record<string, any> = {};
  if (markets.length > 0) {
    try {
      const volResponse = await fetch(`${baseUrl}/api/protocol-tvl`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markets, startDate: date, endDate: date }),
        cache: 'no-store',
      });
      if (volResponse.ok) {
        const volData = await volResponse.json();
        marketVolumes = volData.marketVolumes || {};
      }
    } catch (e) {
      console.error('[DailyIndex] Market volume fetch error:', e);
    }
  }

  // Process data into daily index format
  const pools: DailyPoolData[] = [];
  const protocols: Record<string, DailyProtocolData> = {};
  const funders: Record<string, DailyFunderData> = {};
  const marketsIndex: Record<string, DailyMarketData> = {};

  const monPrice = monPriceResult.price || 0;

  // Process incentives data
  for (const platform of (incentivesData.results || [])) {
    const protocolKey = normalizeProtocol(platform.platformProtocol);

    // Initialize protocol if needed
    if (!protocols[protocolKey]) {
      protocols[protocolKey] = {
        tvl: tvlData.tvlData?.[platform.platformProtocol] || tvlData.tvlData?.[protocolKey] || null,
        volume: tvlData.dexVolumeData?.[platform.platformProtocol]?.volumeInRange ||
                tvlData.dexVolumeData?.[platform.platformProtocol]?.volume7d || null,
        monSpent: 0,
        monValueUSD: 0,
        externalIncentiveUSD: 0,
        isMonadSpecific: tvlData.dexVolumeData?.[platform.platformProtocol]?.isMonadSpecific || false,
        poolCount: 0,
      };
    }

    for (const funding of (platform.fundingProtocols || [])) {
      const funderKey = normalizeProtocol(funding.fundingProtocol);

      // Initialize funder if needed
      if (!funders[funderKey]) {
        funders[funderKey] = {
          tvl: null,
          monSpent: 0,
          monValueUSD: 0,
          externalIncentiveUSD: 0,
          poolCount: 0,
          protocols: [],
        };
      }

      // Track protocols funded
      if (!funders[funderKey].protocols.includes(protocolKey)) {
        funders[funderKey].protocols.push(protocolKey);
      }

      for (const market of (funding.markets || [])) {
        const marketKey = `${platform.platformProtocol.toLowerCase()}-${market.marketName}`;
        const monQty = market.totalMON || 0;
        const extUSD = market.externalIncentiveUSD || 0;
        const monValueUSD = monQty * monPrice;

        // Get market volume
        const marketVol = marketVolumes[marketKey];

        // Add pool
        pools.push({
          protocol: platform.platformProtocol,
          pool: market.marketName,
          tvl: market.tvl || null,
          volume: marketVol?.volumeInRange || marketVol?.volume7d || null,
          monQuantity: monQty,
          monValueUSD,
          externalIncentiveUSD: extUSD,
          funder: funding.fundingProtocol,
        });

        // Update protocol totals
        protocols[protocolKey].monSpent += monQty;
        protocols[protocolKey].monValueUSD += monValueUSD;
        protocols[protocolKey].externalIncentiveUSD += extUSD;
        protocols[protocolKey].poolCount += 1;

        // Update funder totals
        funders[funderKey].monSpent += monQty;
        funders[funderKey].monValueUSD += monValueUSD;
        funders[funderKey].externalIncentiveUSD += extUSD;
        funders[funderKey].poolCount += 1;
        if (market.tvl && market.tvl > 0) {
          funders[funderKey].tvl = (funders[funderKey].tvl || 0) + market.tvl;
        }

        // Add market volume
        marketsIndex[marketKey] = {
          volume: marketVol?.volumeInRange || marketVol?.volume7d || null,
          volumeSource: marketVol?.isMonadSpecific ? 'dune' : (marketVol ? 'defillama' : null),
          isMonadSpecific: marketVol?.isMonadSpecific || false,
        };
      }
    }
  }

  // Add protocols that have TVL but no incentives
  for (const [protocol, tvl] of Object.entries(tvlData.tvlData || {})) {
    const protocolKey = normalizeProtocol(protocol);
    if (!protocols[protocolKey] && tvl) {
      const volData = tvlData.dexVolumeData?.[protocol];
      protocols[protocolKey] = {
        tvl: tvl as number,
        volume: volData?.volumeInRange || volData?.volume7d || null,
        monSpent: 0,
        monValueUSD: 0,
        externalIncentiveUSD: 0,
        isMonadSpecific: volData?.isMonadSpecific || false,
        poolCount: 0,
      };
    }
  }

  const meta: DailyMeta = {
    monPrice: monPriceResult.price,
    monPriceSource: monPriceResult.source,
    fetchedAt: new Date().toISOString(),
    version: SCHEMA_VERSION,
  };

  console.log(`[DailyIndex] Indexed ${date}: ${pools.length} pools, ${Object.keys(protocols).length} protocols, ${Object.keys(funders).length} funders`);

  return {
    date,
    pools,
    protocols,
    funders,
    markets: marketsIndex,
    meta,
  };
}

/**
 * Normalize protocol name for consistent keys
 */
function normalizeProtocol(name: string): string {
  return name.toLowerCase().replace(/[-_\s]+/g, '').replace('pancake-swap', 'pancakeswap');
}

/**
 * Get base URL for internal API calls
 */
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
