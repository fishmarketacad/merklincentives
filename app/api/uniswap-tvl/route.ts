import { NextRequest, NextResponse } from 'next/server';

// Uniswap V4 pools on Monad tracked for incentives
const TRACKED_POOLS: Record<string, { name: string; poolId: string }> = {
  'MON/AUSD': { name: 'MON/AUSD', poolId: '0xd63f84a5bdc7e1e9d2a01e2ed28a5d08668c9c8300000000000000000000000a' },
  'WBTC/MON': { name: 'WBTC/MON', poolId: '0x7b72f9a4310b6fd6b2afc26db23a9b32bd0ab6b500000000000000000000000f' },
  'WETH/MON': { name: 'WETH/MON', poolId: '0x5b2ebe36c2c57d73eb6bfaebb49fc0bffc4d5a4700000000000000000000000e' },
  'MON/USDT': { name: 'MON/USDT', poolId: '0x4a9b9f42c0ef48e4e9887078a4eb5a49f6e6fbb1000000000000000000000011' },
  'MON/USDC': { name: 'MON/USDC', poolId: '0xabb7bfcd51c0fc06fe718c4e8bdbc8d90edbd5e7000000000000000000000010' },
  'WETH/AUSD': { name: 'WETH/AUSD', poolId: '0x47be46c5e45ee9f6a93bef0c6bae3eda6c546dfc00000000000000000000000d' },
  'WBTC/AUSD': { name: 'WBTC/AUSD', poolId: '0x6aaebff8b305bcc8ba58f3a7d5cc22e364b23b2300000000000000000000000c' },
  'USDC/AUSD': { name: 'USDC/AUSD', poolId: '0x0ff34c96adbd16e6ceab5a31fdba2cd2e8e4be2800000000000000000000000b' },
  'MON/WMON': { name: 'MON/WMON', poolId: '0x7fd9f68ac6a25f7ac5b75fcc9e7ead55ad61c75b000000000000000000000012' },
  'USDT/AUSD': { name: 'USDT/AUSD', poolId: '0x65a3e5e51a28e9f9e2e1ae4a3c5c7e9f9f9f9f90000000000000000000000013' },
  'apMON/USDC': { name: 'apMON/USDC', poolId: '0x812a8a4005eca08c5dd04d4dd36f2e8e3a7e2ff2000000000000000000000014' },
  'wUSD+/USDC': { name: 'wUSD+/USDC', poolId: '0xfb5e0ea0b13f2bd3b2b7e37ad1eb6b3aa99c8f16000000000000000000000015' },
  'USDC/USDT': { name: 'USDC/USDT', poolId: '0xa3f0c39f3c4a22f26b90c20eb8eb29e0e5d1a7c1000000000000000000000016' },
  'stkMON/MON': { name: 'stkMON/MON', poolId: '0xb5c0e36f2a7ef9b6ea4e6f9e8e8e8e8e8e8e8e80000000000000000000000017' },
};

const SUBGRAPH_ID = '6CQtx9W4b9Kn9cjznXJNLeTvLV1hbpxkaJZkbyXirJuz';

// GET: Fetch TVL for all tracked Uniswap pools at a specific date
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date'); // YYYY-MM-DD

  if (!date) {
    return NextResponse.json({ error: 'Missing date parameter' }, { status: 400 });
  }

  const apiKey = process.env.THEGRAPH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: 'THEGRAPH_API_KEY not configured',
      note: 'Set THEGRAPH_API_KEY in environment variables'
    }, { status: 500 });
  }

  try {
    const results = await fetchUniswapPoolTVL(apiKey, date);
    return NextResponse.json({ date, pools: results });
  } catch (error) {
    console.error('Error fetching Uniswap TVL:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Uniswap TVL', details: String(error) },
      { status: 500 }
    );
  }
}

// POST: Fetch TVL for specific pools and date range
export async function POST(request: NextRequest) {
  const apiKey = process.env.THEGRAPH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: 'THEGRAPH_API_KEY not configured',
      note: 'Set THEGRAPH_API_KEY in environment variables'
    }, { status: 500 });
  }

  try {
    const { startDate, endDate, poolIds } = await request.json();

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Missing startDate or endDate' }, { status: 400 });
    }

    // Convert dates to timestamps for The Graph query
    const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
    const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);

    // Use provided pool IDs or all tracked pools
    const pools = poolIds || Object.values(TRACKED_POOLS).map(p => p.poolId);

    const results = await fetchPoolTVLRange(apiKey, pools, startTimestamp, endTimestamp);

    return NextResponse.json({
      startDate,
      endDate,
      pools: results
    });
  } catch (error) {
    console.error('Error fetching Uniswap TVL range:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Uniswap TVL', details: String(error) },
      { status: 500 }
    );
  }
}

async function fetchUniswapPoolTVL(
  apiKey: string,
  dateStr: string
): Promise<Record<string, { poolId: string; tvlUSD: number; date: string }>> {
  const subgraphUrl = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${SUBGRAPH_ID}`;

  // Convert date to timestamp (start of day)
  const targetDate = new Date(dateStr);
  const timestamp = Math.floor(targetDate.getTime() / 1000);

  const results: Record<string, { poolId: string; tvlUSD: number; date: string }> = {};

  // Query each pool individually to get TVL at specific date
  for (const [poolName, poolInfo] of Object.entries(TRACKED_POOLS)) {
    try {
      const query = `
        query GetPoolDayData($poolId: String!, $timestamp: Int!) {
          poolDayDatas(
            where: {
              pool: $poolId,
              date_lte: $timestamp
            }
            orderBy: date
            orderDirection: desc
            first: 1
          ) {
            date
            tvlUSD
          }
        }
      `;

      const response = await fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: {
            poolId: poolInfo.poolId,
            timestamp
          }
        }),
        cache: 'no-store',
      });

      if (!response.ok) {
        console.error(`[UniswapTVL] Failed to fetch ${poolName}:`, response.statusText);
        continue;
      }

      const data = await response.json();

      if (data.errors) {
        console.error(`[UniswapTVL] GraphQL errors for ${poolName}:`, data.errors);
        continue;
      }

      const poolDayData = data.data?.poolDayDatas?.[0];
      if (poolDayData) {
        results[poolName] = {
          poolId: poolInfo.poolId,
          tvlUSD: parseFloat(poolDayData.tvlUSD) || 0,
          date: new Date(poolDayData.date * 1000).toISOString().split('T')[0],
        };
      }
    } catch (err) {
      console.error(`[UniswapTVL] Error fetching ${poolName}:`, err);
    }
  }

  return results;
}

async function fetchPoolTVLRange(
  apiKey: string,
  poolIds: string[],
  startTimestamp: number,
  endTimestamp: number
): Promise<Record<string, { tvlAtStart: number; tvlAtEnd: number; avgTvl: number }>> {
  const subgraphUrl = `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${SUBGRAPH_ID}`;

  const results: Record<string, { tvlAtStart: number; tvlAtEnd: number; avgTvl: number }> = {};

  // Find pool name by ID
  const poolIdToName: Record<string, string> = {};
  for (const [name, info] of Object.entries(TRACKED_POOLS)) {
    poolIdToName[info.poolId] = name;
  }

  for (const poolId of poolIds) {
    const poolName = poolIdToName[poolId] || poolId;

    try {
      // Get TVL data points within the date range
      const query = `
        query GetPoolDayDataRange($poolId: String!, $startTimestamp: Int!, $endTimestamp: Int!) {
          poolDayDatas(
            where: {
              pool: $poolId,
              date_gte: $startTimestamp,
              date_lte: $endTimestamp
            }
            orderBy: date
            orderDirection: asc
          ) {
            date
            tvlUSD
          }
        }
      `;

      const response = await fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: {
            poolId,
            startTimestamp,
            endTimestamp
          }
        }),
        cache: 'no-store',
      });

      if (!response.ok) {
        console.error(`[UniswapTVL] Failed to fetch range for ${poolName}:`, response.statusText);
        continue;
      }

      const data = await response.json();

      if (data.errors) {
        console.error(`[UniswapTVL] GraphQL errors for ${poolName}:`, data.errors);
        continue;
      }

      const dayDatas = data.data?.poolDayDatas || [];

      if (dayDatas.length > 0) {
        const tvlValues = dayDatas.map((d: { tvlUSD: string }) => parseFloat(d.tvlUSD) || 0);
        const tvlAtStart = tvlValues[0];
        const tvlAtEnd = tvlValues[tvlValues.length - 1];
        const avgTvl = tvlValues.reduce((sum: number, v: number) => sum + v, 0) / tvlValues.length;

        results[poolName] = { tvlAtStart, tvlAtEnd, avgTvl };
      }
    } catch (err) {
      console.error(`[UniswapTVL] Error fetching range for ${poolName}:`, err);
    }
  }

  return results;
}

// Export tracked pools for use in other modules
export { TRACKED_POOLS };
