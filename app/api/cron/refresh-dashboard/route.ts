import { NextRequest, NextResponse } from 'next/server';
import { setCache, updateAIAnalysis } from '@/app/lib/dashboardCache';

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
  const startTime = Date.now();
  try {
    console.log('[Cron] Starting dashboard refresh...');
    console.log('[Cron] Request URL:', request.url);
    console.log('[Cron] VERCEL_AUTOMATION_BYPASS_SECRET available:', !!process.env.VERCEL_AUTOMATION_BYPASS_SECRET);

    // Verify this is a cron request (Vercel adds this header)
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.log('[Cron] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Calculate dates
    const yesterday = getYesterdayUTC();
    const sevenDaysAgo = getSevenDaysAgoUTC();
    const { prevStartDate, prevEndDate } = getPreviousWeekDates(sevenDaysAgo, yesterday);

    console.log('[Cron] Fetching data for:', { startDate: sevenDaysAgo, endDate: yesterday });

    // Fetch MON price
    const monPrice = await fetchMonPrice();
    console.log('[Cron] MON price:', monPrice);

    // Construct base URL for internal API calls
    // Use VERCEL_URL if available, otherwise construct from request
    let baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL;
    
    if (!baseUrl) {
      try {
        const url = new URL(request.url);
        baseUrl = `${url.protocol}//${url.host}`;
      } catch {
        baseUrl = 'http://localhost:3000';
      }
    }

    console.log('[Cron] Using base URL:', baseUrl);

    // Fetch current week data using HTTP with bypass token for Vercel protection
    // Try multiple sources for bypass secret:
    // 1. VERCEL_AUTOMATION_BYPASS_SECRET (automatically set by Vercel)
    // 2. BYPASS_SECRET (manual fallback if Vercel doesn't set it automatically)
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || process.env.BYPASS_SECRET;
    const internalHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    // Add bypass header if available
    if (bypassSecret) {
      internalHeaders['x-vercel-protection-bypass'] = bypassSecret;
      console.log('[Cron] Using Vercel automation bypass token (length:', bypassSecret.length, ')');
    } else {
      console.log('[Cron] Warning: No bypass token found. Checked:');
      console.log('[Cron]   - VERCEL_AUTOMATION_BYPASS_SECRET:', !!process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
      console.log('[Cron]   - BYPASS_SECRET:', !!process.env.BYPASS_SECRET);
      console.log('[Cron]   May hit protection - requests will likely fail');
    }
    
    // Helper to add bypass token to URL as query parameter (Vercel supports both header and query param)
    function addBypassToUrl(url: string): string {
      if (bypassSecret) {
        const urlObj = new URL(url);
        urlObj.searchParams.set('x-vercel-protection-bypass', bypassSecret);
        console.log('[Cron] Added bypass token to URL:', urlObj.pathname);
        return urlObj.toString();
      }
      console.log('[Cron] No bypass token available, URL unchanged');
      return url;
    }
    
    // Helper to create fetch with timeout
    async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30000): Promise<Response> {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw error;
      }
    }

    console.log('[Cron] Fetching current week data...');
    
    let monSpentResponse, tvlResponse;
    try {
      const monSpentUrl = addBypassToUrl(`${baseUrl}/api/query-mon-spent`);
      const tvlUrl = addBypassToUrl(`${baseUrl}/api/protocol-tvl`);
      
      console.log('[Cron] Fetching MON spent from:', monSpentUrl.replace(/x-vercel-protection-bypass=[^&]+/, 'x-vercel-protection-bypass=***'));
      console.log('[Cron] Fetching TVL from:', tvlUrl.replace(/x-vercel-protection-bypass=[^&]+/, 'x-vercel-protection-bypass=***'));
      
      [monSpentResponse, tvlResponse] = await Promise.all([
        fetchWithTimeout(monSpentUrl, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: sevenDaysAgo,
            endDate: yesterday,
            token: 'WMON',
          }),
        }, 60000), // 60 second timeout
        fetchWithTimeout(tvlUrl, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: sevenDaysAgo,
            endDate: yesterday,
          }),
        }, 60000), // 60 second timeout
      ]);
      
      console.log('[Cron] Responses received:', {
        monSpent: monSpentResponse.status,
        tvl: tvlResponse.status,
      });
    } catch (fetchError: any) {
      console.error('[Cron] Fetch error:', fetchError);
      throw new Error(`Failed to fetch data from ${baseUrl}: ${fetchError.message || 'Unknown error'}`);
    }

    if (!monSpentResponse.ok) {
      const errorData = await monSpentResponse.json();
      console.error('[Cron] MON spent fetch failed:', monSpentResponse.status, errorData);
      throw new Error(`Failed to fetch MON spent data: ${monSpentResponse.status} - ${JSON.stringify(errorData)}`);
    }

    if (!tvlResponse.ok) {
      const errorData = await tvlResponse.json();
      console.error('[Cron] TVL fetch failed:', tvlResponse.status, errorData);
      throw new Error(`Failed to fetch TVL data: ${tvlResponse.status} - ${JSON.stringify(errorData)}`);
    }

    const monSpentData = await monSpentResponse.json();
    const tvlData = await tvlResponse.json();

    console.log('[Cron] Current week data fetched, results:', monSpentData.results?.length || 0);

    // Fetch previous week data
    let prevMonSpentResponse, prevTvlResponse;
    try {
      const prevMonSpentUrl = addBypassToUrl(`${baseUrl}/api/query-mon-spent`);
      const prevTvlUrl = addBypassToUrl(`${baseUrl}/api/protocol-tvl`);
      
      console.log('[Cron] Fetching previous week data...');
      
      [prevMonSpentResponse, prevTvlResponse] = await Promise.all([
        fetchWithTimeout(prevMonSpentUrl, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: prevStartDate,
            endDate: prevEndDate,
            token: 'WMON',
          }),
        }, 60000),
        fetchWithTimeout(prevTvlUrl, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: prevStartDate,
            endDate: prevEndDate,
          }),
        }, 60000),
      ]);
    } catch (fetchError: any) {
      console.error('[Cron] Previous week fetch error:', fetchError);
      throw new Error(`Failed to fetch previous week data from ${baseUrl}: ${fetchError.message || 'Unknown error'}`);
    }

    if (!prevMonSpentResponse.ok) {
      const errorData = await prevMonSpentResponse.json();
      console.error('[Cron] Previous week MON spent fetch failed:', prevMonSpentResponse.status, errorData);
      throw new Error(`Failed to fetch previous week MON spent data: ${prevMonSpentResponse.status} - ${JSON.stringify(errorData)}`);
    }

    if (!prevTvlResponse.ok) {
      const errorData = await prevTvlResponse.json();
      console.error('[Cron] Previous week TVL fetch failed:', prevTvlResponse.status, errorData);
      throw new Error(`Failed to fetch previous week TVL data: ${prevTvlResponse.status} - ${JSON.stringify(errorData)}`);
    }

    const prevMonSpentData = await prevMonSpentResponse.json();
    const prevTvlData = await prevTvlResponse.json();

    console.log('[Cron] Previous week data fetched, results:', prevMonSpentData.results?.length || 0);

    // Store in cache IMMEDIATELY (without AI analysis to avoid timeout)
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
      aiAnalysis: null, // Will be updated asynchronously
      timestamp: Date.now(),
      cacheDate: yesterday, // Use yesterday as the cache key
    });

    const duration = Date.now() - startTime;
    console.log('[Cron] Dashboard data cached in', duration, 'ms');

    // Run AI analysis ASYNCHRONOUSLY (fire-and-forget)
    // This prevents timeout - we return success immediately and update cache when AI completes
    const periodDays = Math.floor((new Date(yesterday).getTime() - new Date(sevenDaysAgo).getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    (async () => {
      try {
        console.log('[Cron] Running AI analysis asynchronously...');
        const aiUrl = addBypassToUrl(`${baseUrl}/api/ai-analysis`);
        
        const aiResponse = await fetchWithTimeout(aiUrl, {
          method: 'POST',
          headers: internalHeaders,
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
        }, 120000); // 2 minute timeout for AI analysis

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          updateAIAnalysis(aiData.analysis);
          console.log('[Cron] AI analysis complete and cache updated');
        } else {
          const errorData = await aiResponse.json();
          console.error('[Cron] AI analysis failed:', errorData);
        }
      } catch (aiError) {
        console.error('[Cron] AI analysis error:', aiError);
        // Cache already has data, AI analysis is optional
      }
    })(); // Fire-and-forget - don't await

    return NextResponse.json({
      success: true,
      date: yesterday,
      duration,
      poolsCount: monSpentData.results?.length || 0,
      aiAnalysisIncluded: false, // Will be updated asynchronously
      message: 'Dashboard data cached. AI analysis running in background.',
    });
  } catch (error: any) {
    console.error('[Cron] Dashboard refresh failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to refresh dashboard' },
      { status: 500 }
    );
  }
}
