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

// Helper: Extract token pair from market name
function extractTokenPair(marketName: string): string {
  const match = marketName.match(/([A-Z0-9]+)[-\/]([A-Z0-9]+)/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return '';
}

// Helper: Calculate TVL Cost
function calculateTVLCost(incentivesUSD: number, tvl: number, periodDays: number): number | null {
  if (!tvl || tvl === 0 || !incentivesUSD) return null;
  const annualizedIncentives = (incentivesUSD / periodDays) * 365;
  return (annualizedIncentives / tvl) * 100;
}

// Helper: Prepare AI analysis data with TVL, volume, TVL Cost, and WoW changes
function prepareAIData(
  results: any[],
  previousWeekResults: any[],
  protocolTVL: any,
  protocolDEXVolume: any,
  previousWeekProtocolTVL: any,
  previousWeekProtocolDEXVolume: any,
  monPrice: number,
  periodDays: number
) {
  // Create a map to find previous week pools
  const prevPoolMap = new Map<string, any>();
  (previousWeekResults || []).forEach((platform: any) => {
    platform.fundingProtocols?.forEach((funding: any) => {
      funding.markets?.forEach((market: any) => {
        const key = `${platform.platformProtocol}-${funding.fundingProtocol}-${market.marketName}`;
        prevPoolMap.set(key.toLowerCase(), {
          protocol: platform.platformProtocol,
          fundingProtocol: funding.fundingProtocol,
          marketName: market.marketName,
          incentivesMON: market.totalMON || 0,
          incentivesUSD: (market.totalMON || 0) * monPrice,
          tvl: market.tvl || null,
        });
      });
    });
  });

  // Prepare current week pools
  const currentPools = (results || []).flatMap((platform: any) =>
    platform.fundingProtocols.flatMap((funding: any) =>
      funding.markets.map((market: any) => {
        const protocolKey = platform.platformProtocol.toLowerCase();
        const marketKey = `${platform.platformProtocol}-${funding.fundingProtocol}-${market.marketName}`.toLowerCase();
        
        // Get TVL from protocolTVL (prefer protocol-level TVL over market-level)
        let tvl = market.tvl || null;
        if (protocolTVL[protocolKey]?.tvl) {
          tvl = protocolTVL[protocolKey].tvl;
        }
        
        // Get volume from protocolDEXVolume
        const tokenPair = extractTokenPair(market.marketName);
        let volume = null;
        if (protocolDEXVolume[protocolKey] && tokenPair) {
          const volumeData = protocolDEXVolume[protocolKey][tokenPair];
          if (volumeData?.volumeInRange) {
            volume = volumeData.volumeInRange;
          }
        }
        
        // Calculate TVL Cost
        const incentivesUSD = (market.totalMON || 0) * monPrice;
        const tvlCost = calculateTVLCost(incentivesUSD, tvl || 0, periodDays);
        
        // Find previous week pool
        const prevPool = prevPoolMap.get(marketKey);
        let wowChange = null;
        if (prevPool && tvlCost !== null) {
          const prevTvl = prevPool.tvl || null;
          const prevIncentivesUSD = prevPool.incentivesUSD || 0;
          const prevTVLCost = calculateTVLCost(prevIncentivesUSD, prevTvl || 0, periodDays);
          if (prevTVLCost !== null && prevTVLCost !== 0) {
            wowChange = ((tvlCost - prevTVLCost) / prevTVLCost) * 100;
          }
        }
        
        return {
          protocol: platform.platformProtocol,
          fundingProtocol: funding.fundingProtocol,
          marketName: market.marketName,
          tokenPair,
          incentivesMON: market.totalMON || 0,
          incentivesUSD,
          tvl,
          volume,
          apr: market.apr || null,
          tvlCost,
          wowChange,
          periodDays,
          merklUrl: market.merklUrl || null,
        };
      })
    )
  );

  // Prepare previous week pools
  const previousPools = (previousWeekResults || []).flatMap((platform: any) =>
    platform.fundingProtocols.flatMap((funding: any) =>
      funding.markets.map((market: any) => {
        const protocolKey = platform.platformProtocol.toLowerCase();
        const tokenPair = extractTokenPair(market.marketName);
        
        // Get TVL from previousWeekProtocolTVL
        let tvl = market.tvl || null;
        if (previousWeekProtocolTVL[protocolKey]?.tvl) {
          tvl = previousWeekProtocolTVL[protocolKey].tvl;
        }
        
        // Get volume from previousWeekProtocolDEXVolume
        let volume = null;
        if (previousWeekProtocolDEXVolume[protocolKey] && tokenPair) {
          const volumeData = previousWeekProtocolDEXVolume[protocolKey][tokenPair];
          if (volumeData?.volumeInRange) {
            volume = volumeData.volumeInRange;
          }
        }
        
        const incentivesUSD = (market.totalMON || 0) * monPrice;
        const tvlCost = calculateTVLCost(incentivesUSD, tvl || 0, periodDays);
        
        return {
          protocol: platform.platformProtocol,
          fundingProtocol: funding.fundingProtocol,
          marketName: market.marketName,
          tokenPair,
          incentivesMON: market.totalMON || 0,
          incentivesUSD,
          tvl,
          volume,
          apr: market.apr || null,
          tvlCost,
          wowChange: null, // Will be calculated by comparing with current week
          periodDays,
        };
      })
    )
  );

  return { currentPools, previousPools };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    console.log('[Cron] Starting dashboard refresh...');
    console.log('[Cron] Request URL:', request.url);
    console.log('[Cron] VERCEL_AUTOMATION_BYPASS_SECRET available:', !!process.env.VERCEL_AUTOMATION_BYPASS_SECRET);

    // Verify this is a cron request
    // Vercel Cron Jobs may send 'x-vercel-cron' header, but it's not always reliable
    // Check for Vercel-specific indicators or require authorization
    const vercelCronHeader = request.headers.get('x-vercel-cron');
    const authHeader = request.headers.get('authorization');
    const host = request.headers.get('host') || '';
    
    // Parse hostname from request URL (more reliable than host header)
    let requestHostname = '';
    try {
      const url = new URL(request.url);
      requestHostname = url.hostname;
    } catch {
      // If URL parsing fails, use host header
      requestHostname = host;
    }
    
    // Check if this is a Vercel Cron Job
    // Vercel cron jobs come from vercel.app domains and may send x-vercel-cron header
    const isVercelDomain = host.includes('vercel.app') || requestHostname.includes('vercel.app');
    const isVercelCron = !!vercelCronHeader || isVercelDomain;
    
    // Check if this is an authorized manual call
    const isAuthorized = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
    
    // Allow if:
    // 1. Vercel Cron Job (from vercel.app domain OR has x-vercel-cron header)
    // 2. Authorized manual call (has valid CRON_SECRET)
    const shouldAllow = isVercelCron || isAuthorized;
    
    if (!shouldAllow) {
      console.log('[Cron] Unauthorized request');
      console.log('[Cron] Headers:', {
        'x-vercel-cron': vercelCronHeader,
        'authorization': authHeader ? 'present' : 'missing',
        'host': host,
        'requestHostname': requestHostname,
        'CRON_SECRET set': !!process.env.CRON_SECRET,
        'isVercelDomain': isVercelDomain,
        'isVercelCron': isVercelCron,
        'isAuthorized': isAuthorized,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    if (isVercelCron && !isAuthorized) {
      console.log('[Cron] Request from Vercel Cron Job');
    } else if (isAuthorized) {
      console.log('[Cron] Request from manual/GitHub Actions');
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
        }, 90000), // 90 second timeout (Redis retries can cause delays)
        fetchWithTimeout(tvlUrl, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: sevenDaysAgo,
            endDate: yesterday,
          }),
        }, 90000), // 90 second timeout
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
        }, 90000), // 90 second timeout (Redis retries can cause delays)
        fetchWithTimeout(prevTvlUrl, {
          method: 'POST',
          headers: internalHeaders,
          body: JSON.stringify({
            protocols: commonProtocols,
            startDate: prevStartDate,
            endDate: prevEndDate,
          }),
        }, 90000), // 90 second timeout
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
    await setCache({
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

    // Run AI analysis ASYNCHRONOUSLY using waitUntil to keep function alive
    // This prevents timeout - we return success immediately and update cache when AI completes
    const periodDays = Math.floor((new Date(yesterday).getTime() - new Date(sevenDaysAgo).getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Prepare AI analysis data with TVL, volume, TVL Cost, and WoW changes
    console.log('[Cron] Preparing AI analysis data...');
    let currentPools: any[] = [];
    let previousPools: any[] = [];
    try {
      const prepared = prepareAIData(
        monSpentData.results || [],
        prevMonSpentData.results || [],
        tvlData.tvlData || {},
        tvlData.dexVolumeData || {},
        prevTvlData.tvlData || {},
        prevTvlData.dexVolumeData || {},
        monPrice,
        periodDays
      );
      currentPools = prepared.currentPools;
      previousPools = prepared.previousPools;
      console.log('[Cron] AI data prepared successfully:', { currentPools: currentPools.length, previousPools: previousPools.length });
    } catch (prepareError: any) {
      console.error('[Cron] ❌ Failed to prepare AI data:', prepareError?.message || prepareError);
      console.error('[Cron] ❌ Prepare error stack:', prepareError?.stack?.substring(0, 500));
    }
    
    // Trigger AI analysis as a separate HTTP request (runs in its own function instance)
    // Use fetch() without await so it runs independently and doesn't block the response
    // This ensures it runs in a separate function instance and won't be killed when this function returns
    console.log('[Cron] Triggering AI analysis as separate HTTP request...');
    console.log('[Cron] Prepared', currentPools.length, 'current pools and', previousPools.length, 'previous pools');
    const aiUrl = addBypassToUrl(`${baseUrl}/api/ai-analysis`);
    
    // Fire-and-forget: Start the fetch but don't await it
    // This will run in a separate function instance and won't be killed when this function returns
    fetch(aiUrl, {
      method: 'POST',
      headers: {
        ...internalHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentWeek: {
          pools: currentPools,
          startDate: sevenDaysAgo,
          endDate: yesterday,
          monPrice,
        },
        previousWeek: {
          pools: previousPools,
          startDate: prevStartDate,
          endDate: prevEndDate,
        },
        includeAllData: true,
      }),
    })
      .then(async (aiResponse) => {
        console.log('[Cron] AI analysis request completed, status:', aiResponse.status);

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          console.log('[Cron] AI analysis response keys:', Object.keys(aiData || {}));
          console.log('[Cron] AI analysis.analysis exists:', !!aiData.analysis);
          
          if (aiData.analysis) {
            await updateAIAnalysis(aiData.analysis);
            console.log('[Cron] ✅ AI analysis complete and cache updated successfully');
          } else {
            console.error('[Cron] ❌ AI analysis response missing analysis field:', JSON.stringify(aiData).substring(0, 500));
          }
        } else {
          const errorText = await aiResponse.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = errorText;
          }
          console.error('[Cron] ❌ AI analysis failed with status', aiResponse.status, ':', JSON.stringify(errorData).substring(0, 1000));
        }
      })
      .catch((aiError: any) => {
        console.error('[Cron] ❌ AI analysis error (exception):', aiError?.message || aiError);
        console.error('[Cron] ❌ AI analysis error stack:', aiError?.stack?.substring(0, 500));
        // Cache already has data, AI analysis is optional
      });
    
    console.log('[Cron] AI analysis HTTP request initiated (running in separate function instance)');

    return NextResponse.json({
      success: true,
      date: yesterday,
      duration,
      poolsCount: monSpentData.results?.length || 0,
      aiAnalysisIncluded: false, // Will be updated asynchronously
      aiAnalysisError: aiAnalysisError?.message || null,
      message: aiAnalysisCompleted 
        ? 'Dashboard data cached. AI analysis completed.'
        : 'Dashboard data cached. AI analysis may still be running.',
    });
  } catch (error: any) {
    console.error('[Cron] Dashboard refresh failed:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to refresh dashboard' },
      { status: 500 }
    );
  }
}
