import { NextRequest, NextResponse } from 'next/server';
import { 
  getCachedMerklCampaigns, 
  cacheMerklCampaigns,
  getCachedMerklOpportunities,
  cacheMerklOpportunities 
} from '@/app/lib/cache';

const MERKL_API_BASE = 'https://api.merkl.xyz';
const MONAD_CHAIN_ID = 143;

interface BulkAnalysisRequest {
  protocols: string[];
  startDate: string;
  endDate: string;
  monPrice: number | null;
}

/**
 * Fetch campaigns for a protocol (with caching)
 */
async function fetchCampaignsForProtocol(protocolId: string, startTimestamp: number, endTimestamp: number): Promise<any[]> {
  const campaigns: any[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const cached = await getCachedMerklCampaigns(protocolId, page);
      if (cached && cached.length > 0) {
        campaigns.push(...cached);
        if (cached.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
        continue;
      }

      const url = `${MERKL_API_BASE}/v4/campaigns?chainId=${MONAD_CHAIN_ID}&mainProtocolId=${protocolId}&page=${page}&items=100`;
      const response = await globalThis.fetch(url);
      
      if (!response.ok) {
        console.error(`Failed to fetch campaigns for ${protocolId} page ${page}: ${response.status}`);
        hasMore = false;
        break;
      }

      const data = await response.json();
      let pageCampaigns: any[] = [];
      
      if (Array.isArray(data)) {
        pageCampaigns = data;
      } else if (data.data && Array.isArray(data.data)) {
        pageCampaigns = data.data;
      } else if (data.campaigns && Array.isArray(data.campaigns)) {
        pageCampaigns = data.campaigns;
      }

      if (pageCampaigns.length === 0) {
        hasMore = false;
      } else {
        // Filter campaigns that overlap with date range
        const filteredCampaigns = pageCampaigns.filter((campaign: any) => {
          const campaignStart = campaign.startTimestamp ? parseInt(String(campaign.startTimestamp)) : 0;
          const campaignEnd = campaign.endTimestamp ? parseInt(String(campaign.endTimestamp)) : Infinity;
          return campaignStart <= endTimestamp && campaignEnd >= startTimestamp;
        });
        
        campaigns.push(...filteredCampaigns);
        await cacheMerklCampaigns(protocolId, page, pageCampaigns);
        
        if (pageCampaigns.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error fetching campaigns for ${protocolId} page ${page}:`, error);
      hasMore = false;
    }
  }

  return campaigns;
}

/**
 * Fetch all campaigns on Monad chain (with caching)
 */
async function fetchAllCampaignsOnMonad(): Promise<any[]> {
  const campaigns: any[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const cached = await getCachedMerklCampaigns('all', page);
      if (cached && cached.length > 0) {
        campaigns.push(...cached);
        if (cached.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
        continue;
      }

      const url = `${MERKL_API_BASE}/v4/campaigns?chainId=${MONAD_CHAIN_ID}&page=${page}&items=100`;
      const response = await globalThis.fetch(url);
      
      if (!response.ok) {
        console.error(`Failed to fetch campaigns page ${page}: ${response.status}`);
        hasMore = false;
        break;
      }

      const data = await response.json();
      let pageCampaigns: any[] = [];
      
      if (Array.isArray(data)) {
        pageCampaigns = data;
      } else if (data.data && Array.isArray(data.data)) {
        pageCampaigns = data.data;
      } else if (data.campaigns && Array.isArray(data.campaigns)) {
        pageCampaigns = data.campaigns;
      }

      if (pageCampaigns.length === 0) {
        hasMore = false;
      } else {
        campaigns.push(...pageCampaigns);
        await cacheMerklCampaigns('all', page, pageCampaigns);
        
        if (pageCampaigns.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error fetching campaigns page ${page}:`, error);
      hasMore = false;
    }
  }

  return campaigns;
}

/**
 * Fetch all opportunities on Monad chain (with caching)
 */
async function fetchAllOpportunitiesOnMonad(): Promise<any[]> {
  const opportunities: any[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const cached = await getCachedMerklOpportunities(page);
      if (cached && cached.length > 0) {
        opportunities.push(...cached);
        if (cached.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
        continue;
      }

      const url = `${MERKL_API_BASE}/v4/opportunities?chainId=${MONAD_CHAIN_ID}&page=${page}&items=100&status=LIVE,PAST,SOON`;
      const response = await globalThis.fetch(url);
      
      if (!response.ok) {
        console.error(`Failed to fetch opportunities page ${page}: ${response.status}`);
        hasMore = false;
        break;
      }

      const data = await response.json();
      let pageOpportunities: any[] = [];
      
      if (Array.isArray(data)) {
        pageOpportunities = data;
      } else if (data.data && Array.isArray(data.data)) {
        pageOpportunities = data.data;
      } else if (data.opportunities && Array.isArray(data.opportunities)) {
        pageOpportunities = data.opportunities;
      }

      if (pageOpportunities.length === 0) {
        hasMore = false;
      } else {
        opportunities.push(...pageOpportunities);
        await cacheMerklOpportunities(page, pageOpportunities);
        
        if (pageOpportunities.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error fetching opportunities page ${page}:`, error);
      hasMore = false;
    }
  }

    return opportunities;
}

/**
 * Aggregate protocol-level metrics from query results
 */
function aggregateProtocolMetrics(queryData: any, monPrice: number | null, startDate: string, endDate: string) {
  if (!queryData.success || !queryData.results || queryData.results.length === 0) {
    return null;
  }

  const periodDays = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const monPriceNum = monPrice || 0;

  let totalIncentivesMON = 0;
  let totalIncentivesUSD = 0;
  let totalTVL = 0;
  let totalVolume = 0;
  let poolCount = 0;
  const tvlCosts: number[] = [];
  const volumeCosts: number[] = [];
  const pools: any[] = [];

  for (const platform of queryData.results) {
    for (const funding of platform.fundingProtocols) {
      for (const market of funding.markets) {
        poolCount++;
        const incentivesMON = market.totalMON || 0;
        const incentivesUSD = monPriceNum > 0 ? incentivesMON * monPriceNum : 0;
        const tvl = market.tvl || 0;
        
        totalIncentivesMON += incentivesMON;
        totalIncentivesUSD += incentivesUSD;
        totalTVL += tvl;

        // Calculate TVL Cost
        if (tvl > 0 && incentivesUSD > 0) {
          const annualizedIncentives = (incentivesUSD / periodDays) * 365;
          const tvlCost = (annualizedIncentives / tvl) * 100;
          tvlCosts.push(tvlCost);
        }

        pools.push({
          protocol: platform.platformProtocol,
          fundingProtocol: funding.fundingProtocol,
          marketName: market.marketName,
          incentivesMON,
          incentivesUSD,
          tvl,
          apr: market.apr,
          merklUrl: market.merklUrl,
        });
      }
    }
  }

  const avgTVLCost = tvlCosts.length > 0 
    ? tvlCosts.reduce((a, b) => a + b, 0) / tvlCosts.length 
    : null;
  const maxTVLCost = tvlCosts.length > 0 ? Math.max(...tvlCosts) : null;
  const minTVLCost = tvlCosts.length > 0 ? Math.min(...tvlCosts) : null;

  return {
    totalIncentivesMON,
    totalIncentivesUSD,
    totalTVL,
    totalVolume,
    poolCount,
    avgTVLCost,
    maxTVLCost,
    minTVLCost,
    pools,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: BulkAnalysisRequest = await request.json();
    const { protocols, startDate, endDate, monPrice } = body;

    if (!protocols || protocols.length === 0) {
      return NextResponse.json(
        { error: 'No protocols selected' },
        { status: 400 }
      );
    }

    // Convert dates to timestamps
    const startTimestamp = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
    const endTimestamp = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000);
    
    // Calculate previous week dates
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - daysDiff - 1);
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStartDate = prevStart.toISOString().split('T')[0];
    const prevEndDate = prevEnd.toISOString().split('T')[0];
    const prevStartTimestamp = Math.floor(prevStart.getTime() / 1000);
    const prevEndTimestamp = Math.floor(prevEnd.getTime() / 1000);

    // Fetch data for all protocols
    const protocolData: Record<string, any> = {};
    const protocolProgress: Record<string, { status: string; progress: number }> = {};

    // Initialize progress tracking
    for (const protocol of protocols) {
      protocolProgress[protocol] = { status: 'pending', progress: 0 };
    }

    // Construct base URL for internal API calls
    const baseUrl = request.headers.get('host') 
      ? `${request.headers.get('x-forwarded-proto') || 'http'}://${request.headers.get('host')}`
      : request.nextUrl.origin;

    // Fetch current week data for all protocols
    const totalProtocols = protocols.length;
    for (let i = 0; i < protocols.length; i++) {
      const protocol = protocols[i];
      try {
        const baseProgress = Math.floor((i / totalProtocols) * 30);
        protocolProgress[protocol] = { status: 'fetching_current', progress: baseProgress };
        
        const campaigns = await fetchCampaignsForProtocol(protocol, startTimestamp, endTimestamp);
        
        // Call query-mon-spent API to get processed data
        const queryResponse = await fetch(`${baseUrl}/api/query-mon-spent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            protocols: [protocol],
            startDate,
            endDate,
            token: 'WMON',
          }),
        });

        if (queryResponse.ok) {
          const queryData = await queryResponse.json();
          const aggregated = aggregateProtocolMetrics(queryData, monPrice, startDate, endDate);
          protocolData[protocol] = {
            currentWeek: {
              raw: queryData,
              aggregated,
            },
            campaigns: campaigns.length,
          };
        }

        protocolProgress[protocol] = { status: 'current_done', progress: baseProgress + 15 };
      } catch (error) {
        console.error(`Error fetching data for ${protocol}:`, error);
        protocolProgress[protocol] = { status: 'error', progress: 0 };
      }
    }

    // Fetch previous week data for all protocols
    for (let i = 0; i < protocols.length; i++) {
      const protocol = protocols[i];
      try {
        const baseProgress = 30 + Math.floor((i / totalProtocols) * 30);
        protocolProgress[protocol] = { status: 'fetching_previous', progress: baseProgress };
        
        const prevQueryResponse = await fetch(`${baseUrl}/api/query-mon-spent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            protocols: [protocol],
            startDate: prevStartDate,
            endDate: prevEndDate,
            token: 'WMON',
          }),
        });

        if (prevQueryResponse.ok) {
          const prevQueryData = await prevQueryResponse.json();
          if (!protocolData[protocol]) {
            protocolData[protocol] = {};
          }
          const prevAggregated = aggregateProtocolMetrics(prevQueryData, monPrice, prevStartDate, prevEndDate);
          protocolData[protocol].previousWeek = {
            raw: prevQueryData,
            aggregated: prevAggregated,
          };
        }

        protocolProgress[protocol] = { status: 'previous_done', progress: baseProgress + 15 };
      } catch (error) {
        console.error(`Error fetching previous week data for ${protocol}:`, error);
      }
    }

    // Fetch all campaigns and opportunities for competitive context
    protocolProgress['_global'] = { status: 'fetching_context', progress: 70 };
    const [allCampaigns, allOpportunities] = await Promise.all([
      fetchAllCampaignsOnMonad(),
      fetchAllOpportunitiesOnMonad(),
    ]);

    protocolProgress['_global'] = { status: 'context_done', progress: 80 };

    // Prepare protocol-level data for AI analysis
    const protocolSummaries = protocols.map(protocol => {
      const current = protocolData[protocol]?.currentWeek?.aggregated;
      const previous = protocolData[protocol]?.previousWeek?.aggregated;
      
      // Calculate WoW changes
      let incentivesWoW = null;
      let tvlWoW = null;
      let avgTVLCostWoW = null;
      
      if (current && previous) {
        if (previous.totalIncentivesMON > 0) {
          incentivesWoW = ((current.totalIncentivesMON - previous.totalIncentivesMON) / previous.totalIncentivesMON) * 100;
        }
        if (previous.totalTVL > 0) {
          tvlWoW = ((current.totalTVL - previous.totalTVL) / previous.totalTVL) * 100;
        }
        if (previous.avgTVLCost && current.avgTVLCost) {
          avgTVLCostWoW = ((current.avgTVLCost - previous.avgTVLCost) / previous.avgTVLCost) * 100;
        }
      }

      return {
        protocol,
        currentWeek: {
          totalIncentivesMON: current?.totalIncentivesMON || 0,
          totalIncentivesUSD: current?.totalIncentivesUSD || 0,
          totalTVL: current?.totalTVL || 0,
          poolCount: current?.poolCount || 0,
          avgTVLCost: current?.avgTVLCost || null,
          maxTVLCost: current?.maxTVLCost || null,
          minTVLCost: current?.minTVLCost || null,
          pools: current?.pools || [],
        },
        previousWeek: previous ? {
          totalIncentivesMON: previous.totalIncentivesMON || 0,
          totalIncentivesUSD: previous.totalIncentivesUSD || 0,
          totalTVL: previous.totalTVL || 0,
          poolCount: previous.poolCount || 0,
          avgTVLCost: previous.avgTVLCost || null,
          maxTVLCost: previous.maxTVLCost || null,
          minTVLCost: previous.minTVLCost || null,
          pools: previous.pools || [],
        } : null,
        wowChanges: {
          incentives: incentivesWoW,
          tvl: tvlWoW,
          avgTVLCost: avgTVLCostWoW,
        },
        campaigns: protocolData[protocol]?.campaigns || 0,
      };
    });

    const analysisData = {
      protocols: protocolSummaries,
      startDate,
      endDate,
      prevStartDate,
      prevEndDate,
      monPrice,
      allCampaigns,
      allOpportunities,
    };

    // Call AI analysis API
    protocolProgress['_global'] = { status: 'analyzing', progress: 90 };
    
    const aiResponse = await fetch(`${baseUrl}/api/ai-analysis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bulkAnalysis: true,
        protocolData: analysisData,
        includeAllData: true,
      }),
    });

    if (!aiResponse.ok) {
      const errorData = await aiResponse.json();
      throw new Error(errorData.error || 'AI analysis failed');
    }

    const aiAnalysis = await aiResponse.json();
    protocolProgress['_global'] = { status: 'done', progress: 100 };

    return NextResponse.json({
      success: true,
      analysis: aiAnalysis.analysis || aiAnalysis, // Return only analysis, not raw data
      progress: protocolProgress,
    });
  } catch (error: any) {
    console.error('Bulk Protocol Analysis Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to perform bulk protocol analysis' },
      { status: 500 }
    );
  }
}
