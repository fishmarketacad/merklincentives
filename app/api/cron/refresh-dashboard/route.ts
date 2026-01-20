import { NextResponse } from 'next/server';
import { setCache } from '@/app/lib/dashboardCache';

// Common protocols list (same as frontend)
const commonProtocols = [
  'clober',
  'curvance',
  'gearbox',
  'kuru',
  'morpho',
  'euler',
  'pancake-swap',
  'monday-trade',
  'renzo',
  'upshift',
  'townsquare',
  'uniswap',
  'beefy',
  'accountable',
  'curve',
];

// Date utilities
function getYesterdayUTC(): string {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

function getSevenDaysAgoUTC(): string {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 8);
  return sevenDaysAgo.toISOString().split('T')[0];
}

function getPreviousWeekDates(startDate: string, endDate: string) {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);

  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - daysDiff + 1);

  return {
    prevStartDate: prevStart.toISOString().split('T')[0],
    prevEndDate: prevEnd.toISOString().split('T')[0],
  };
}

// Fetch MON price
async function fetchMonPrice(): Promise<number> {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd', {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return 0.025;
    const data = await response.json();
    return data?.monad?.usd || 0.025;
  } catch {
    return 0.025;
  }
}

export async function GET(request: Request) {
  try {
    console.log('[Cron] Starting dashboard refresh...');
    const startTime = Date.now();

    // Verify this is a cron request (Vercel adds this header)
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('[Cron] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Construct base URL for internal API calls
    // Priority: VERCEL_URL env var > NEXT_PUBLIC_BASE_URL > construct from request headers
    let baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL;
    
    if (!baseUrl) {
      // Try to construct from request URL
      try {
        const url = new URL(request.url);
        baseUrl = `${url.protocol}//${url.host}`;
      } catch {
        // Fallback to localhost for local development
        baseUrl = 'http://localhost:3000';
      }
    }

    console.log('[Cron] Using base URL:', baseUrl);

    // Calculate dates
    const yesterday = getYesterdayUTC();
    const sevenDaysAgo = getSevenDaysAgoUTC();
    const { prevStartDate, prevEndDate } = getPreviousWeekDates(sevenDaysAgo, yesterday);

    console.log('[Cron] Fetching data for:', { startDate: sevenDaysAgo, endDate: yesterday });

    // Fetch MON price
    const monPrice = await fetchMonPrice();
    console.log('[Cron] MON price:', monPrice);

    // Fetch current week data
    let monSpentResponse, tvlResponse;
    try {
      [monSpentResponse, tvlResponse] = await Promise.all([
        fetch(`${baseUrl}/api/query-mon-spent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: sevenDaysAgo,
            endDate: yesterday,
            token: 'WMON',
          }),
        }),
        fetch(`${baseUrl}/api/protocol-tvl`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: sevenDaysAgo,
            endDate: yesterday,
          }),
        }),
      ]);
    } catch (fetchError: any) {
      console.error('[Cron] Fetch error:', fetchError);
      throw new Error(`Failed to fetch data from ${baseUrl}: ${fetchError.message || 'Unknown error'}`);
    }

    if (!monSpentResponse.ok) {
      const errorText = await monSpentResponse.text();
      console.error('[Cron] MON spent fetch failed:', monSpentResponse.status, errorText);
      throw new Error(`Failed to fetch MON spent data: ${monSpentResponse.status} - ${errorText}`);
    }

    if (!tvlResponse.ok) {
      const errorText = await tvlResponse.text();
      console.error('[Cron] TVL fetch failed:', tvlResponse.status, errorText);
      throw new Error(`Failed to fetch TVL data: ${tvlResponse.status} - ${errorText}`);
    }

    const monSpentData = await monSpentResponse.json();
    const tvlData = await tvlResponse.json();

    console.log('[Cron] Current week data fetched, results:', monSpentData.results?.length || 0);

    // Fetch previous week data
    let prevMonSpentResponse, prevTvlResponse;
    try {
      [prevMonSpentResponse, prevTvlResponse] = await Promise.all([
        fetch(`${baseUrl}/api/query-mon-spent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: prevStartDate,
            endDate: prevEndDate,
            token: 'WMON',
          }),
        }),
        fetch(`${baseUrl}/api/protocol-tvl`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: prevStartDate,
            endDate: prevEndDate,
          }),
        }),
      ]);
    } catch (fetchError: any) {
      console.error('[Cron] Previous week fetch error:', fetchError);
      throw new Error(`Failed to fetch previous week data from ${baseUrl}: ${fetchError.message || 'Unknown error'}`);
    }

    if (!prevMonSpentResponse.ok) {
      const errorText = await prevMonSpentResponse.text();
      console.error('[Cron] Previous week MON spent fetch failed:', prevMonSpentResponse.status, errorText);
      throw new Error(`Failed to fetch previous week MON spent data: ${prevMonSpentResponse.status} - ${errorText}`);
    }

    if (!prevTvlResponse.ok) {
      const errorText = await prevTvlResponse.text();
      console.error('[Cron] Previous week TVL fetch failed:', prevTvlResponse.status, errorText);
      throw new Error(`Failed to fetch previous week TVL data: ${prevTvlResponse.status} - ${errorText}`);
    }

    const prevMonSpentData = await prevMonSpentResponse.json();
    const prevTvlData = await prevTvlResponse.json();

    console.log('[Cron] Previous week data fetched, results:', prevMonSpentData.results?.length || 0);

    // Prepare data for AI analysis
    const periodDays = Math.floor((new Date(yesterday).getTime() - new Date(sevenDaysAgo).getTime()) / (1000 * 60 * 60 * 24)) + 1;

    // Run AI analysis
    let aiAnalysis = null;
    try {
      console.log('[Cron] Running AI analysis...');
      const aiResponse = await fetch(`${baseUrl}/api/ai-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentWeek: {
            pools: (monSpentData.results || []).flatMap((platform: any) =>
              platform.fundingProtocols.flatMap((funding: any) =>
                funding.markets.map((market: any) => ({
                  protocol: platform.platformProtocol,
                  fundingProtocol: funding.fundingProtocol,
                  marketName: market.marketName,
                  tokenPair: '',
                  incentivesMON: market.totalMON,
                  incentivesUSD: market.totalMON * monPrice,
                  tvl: market.tvl || null,
                  volume: null,
                  apr: market.apr || null,
                  tvlCost: null,
                  wowChange: null,
                  periodDays,
                  merklUrl: market.merklUrl,
                }))
              )
            ),
            startDate: sevenDaysAgo,
            endDate: yesterday,
            monPrice,
          },
          previousWeek: {
            pools: (prevMonSpentData.results || []).flatMap((platform: any) =>
              platform.fundingProtocols.flatMap((funding: any) =>
                funding.markets.map((market: any) => ({
                  protocol: platform.platformProtocol,
                  fundingProtocol: funding.fundingProtocol,
                  marketName: market.marketName,
                  tokenPair: '',
                  incentivesMON: market.totalMON,
                  incentivesUSD: market.totalMON * monPrice,
                  tvl: market.tvl || null,
                  volume: null,
                  apr: market.apr || null,
                  tvlCost: null,
                  wowChange: null,
                  periodDays,
                }))
              )
            ),
            startDate: prevStartDate,
            endDate: prevEndDate,
          },
          includeAllData: true,
        }),
      });

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        aiAnalysis = aiData.analysis;
        console.log('[Cron] AI analysis complete');
      } else {
        console.error('[Cron] AI analysis failed:', await aiResponse.text());
      }
    } catch (aiError) {
      console.error('[Cron] AI analysis error:', aiError);
      // Continue without AI analysis
    }

    // Store in cache
    setCache({
      startDate: sevenDaysAgo,
      endDate: yesterday,
      monPrice,
      protocols: commonProtocols,
      results: monSpentData.results || [],
      previousWeekResults: prevMonSpentData.results || [],
      protocolTVL: tvlData.tvlData || {},
      protocolTVLMetadata: tvlData.tvlMetadata || {},
      protocolDEXVolume: tvlData.dexVolumeData || {},
      marketVolumes: {},
      previousWeekProtocolTVL: prevTvlData.tvlData || {},
      previousWeekProtocolDEXVolume: prevTvlData.dexVolumeData || {},
      previousWeekMarketVolumes: {},
      aiAnalysis,
      timestamp: Date.now(),
      cacheDate: yesterday, // Use yesterday as the cache key
    });

    const duration = Date.now() - startTime;
    console.log('[Cron] Dashboard refresh complete in', duration, 'ms');

    return NextResponse.json({
      success: true,
      date: yesterday,
      duration,
      poolsCount: monSpentData.results?.length || 0,
      aiAnalysisIncluded: !!aiAnalysis,
    });
  } catch (error: any) {
    console.error('[Cron] Dashboard refresh failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to refresh dashboard' },
      { status: 500 }
    );
  }
}
