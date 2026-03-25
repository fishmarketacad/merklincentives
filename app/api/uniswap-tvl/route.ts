import { NextRequest, NextResponse } from 'next/server';

// Uniswap V4 pools on Monad tracked for incentives (correct pool IDs from The Graph)
const TRACKED_POOLS: Record<string, { name: string; poolId: string }> = {
  'MON-AUSD': { name: 'MON-AUSD', poolId: '0xadaf30776f551bccdfb307c3fd8cdec198ca9a852434c8022ee32d1ccedd8219' },
  'WBTC-MON': { name: 'WBTC-MON', poolId: '0x1c93dd2f2f47439330150bf728c3beeaad71de45420a49183214898b044b65d1' },
  'WETH-MON': { name: 'WETH-MON', poolId: '0x3783b51e33900eb366a9e8473c76cda441e7170d2e5d96927f30c16a7add93aa' },
  'wstETH-WETH': { name: 'wstETH-WETH', poolId: '0x55d7ed991392eb9597a76a5f41dfb964e291452c15107c0e64fd3d25925394ce' },
  'weETH-WETH': { name: 'weETH-WETH', poolId: '0x2884b37c4a144e7047a1377ba7201d4b8ea318f0240369e01dc400f04e6cac40' },
  'WETH-USDC': { name: 'WETH-USDC', poolId: '0xad408916c1c310da9c258d4c128a7bf50fd9edc42a218cc970da39cfc8a05d93' },
  'MON-USDC': { name: 'MON-USDC', poolId: '0x18a9fc874581f3ba12b7898f80a683c66fd5877fd74b26a85ba9a3a79c549954' },
  'AUSD-USDC': { name: 'AUSD-USDC', poolId: '0xd112fde908d7342135fc7297cc53d25bf7a11d6c6e21fe7ac3e73c40f70827e8' }, // 0.0009% fee tier
  'AUSD-USDT0': { name: 'AUSD-USDT0', poolId: '0xe56868928b91fcd5ebeada3d0ec8767f2bbfeb1e7da181203d13f6af76b03bf9' },
  'AUSD-XAUt0': { name: 'AUSD-XAUt0', poolId: '0xe1a8600687e4d06ca4787e5d0ccdacb1d360bfc9ca6ca2a49a688e14d0ef37b4' },
  'AUSD-XAUt0-hook': { name: 'AUSD-XAUt0-hook', poolId: '0xbb790bd65e290ec6704d731e43fbbbcfa0521c67c608db989767cf22a59a9a92' }, // Second pool with Uniswap hook
  'WBTC-USDC': { name: 'WBTC-USDC', poolId: '0xd77c0f253764f5d5fbc78e13888afcc35c839262e6b21cd02baa9d8551a9898a' },
  'wstETH-MON': { name: 'wstETH-MON', poolId: '0xbfd64af1b32c101eeff4f7d51a0f1f522c6a6cdf4de45ae340a58c3d1309032c' },
  'WBTC-AUSD': { name: 'WBTC-AUSD', poolId: '0x6fed390faee91596851fdf2fa74c0f799d6bbe4f317b7d6ab16ef31fc974e4da' },
  'USDT0-XAUt0': { name: 'USDT0-XAUt0', poolId: '0xe3b329308be3b1b2bcc5a3a5301e905051bb2c04f145b33b39558baa1113bb78' },
  'cbBTC-MON': { name: 'cbBTC-MON', poolId: '0x45be07f23e76fc8d5f0de2164381805ef1ab5bc956b710e63d1a7d445065601a' },
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

  // Convert date to timestamp (start of day UTC)
  const targetDate = new Date(dateStr + 'T00:00:00Z');
  const timestamp = Math.floor(targetDate.getTime() / 1000);

  console.log(`[UniswapTVL] Fetching TVL for date ${dateStr}, timestamp ${timestamp}`);

  const results: Record<string, { poolId: string; tvlUSD: number; volumeUSD: number; date: string }> = {};

  // Query each pool individually to get TVL at specific date
  for (const [poolName, poolInfo] of Object.entries(TRACKED_POOLS)) {
    try {
      // Use exact date matching like the Google Apps Script
      const query = `
        query GetPoolDayData($poolId: String!, $timestamp: Int!) {
          poolDayDatas(
            where: {
              pool: $poolId,
              date: $timestamp
            }
            first: 1
          ) {
            date
            tvlUSD
            volumeUSD
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
          volumeUSD: parseFloat(poolDayData.volumeUSD) || 0,
          date: new Date(poolDayData.date * 1000).toISOString().split('T')[0],
        };
        console.log(`[UniswapTVL] ${poolName}: TVL=$${Math.round(parseFloat(poolDayData.tvlUSD)).toLocaleString()}`);
      } else {
        console.log(`[UniswapTVL] ${poolName}: No data found`);
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
