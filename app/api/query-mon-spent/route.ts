import { NextRequest, NextResponse } from 'next/server';
import { getCachedMerklCampaigns, cacheMerklCampaigns } from '@/app/lib/cache';

const MERKL_API_BASE = 'https://api.merkl.xyz';
const MONAD_CHAIN_ID = 143;

interface Campaign {
  id?: string;
  campaignId?: string;
  rewardToken?: {
    symbol: string;
    price?: number;
  };
  startTimestamp?: string | number;
  endTimestamp?: string | number;
  opportunityId?: string;
  protocol?: {
    id: string;
  };
  mainProtocolId?: string;
  creator?: {
    tags?: string[];
  };
}

interface QueryParams {
  protocols: string[];
  startDate: string;
  endDate: string;
  token?: string;
}

/**
 * Make HTTP GET request to Merkl API
 */
async function fetchFromMerkl(url: string): Promise<any> {
  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch campaigns for a protocol (with caching)
 */
async function fetchCampaigns(protocolId: string): Promise<Campaign[]> {
  const campaigns: Campaign[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      // Check cache first
      const cached = await getCachedMerklCampaigns(protocolId, page);
      if (cached && cached.length > 0) {
        console.log(`Cache hit for campaigns: ${protocolId} page ${page}`);
        campaigns.push(...cached);
        if (cached.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
        continue;
      }

      // Cache miss - fetch from API
      let url;
      if (protocolId === 'all') {
        url = `${MERKL_API_BASE}/v4/campaigns?chainId=${MONAD_CHAIN_ID}&page=${page}&items=100`;
      } else {
        url = `${MERKL_API_BASE}/v4/campaigns?chainId=${MONAD_CHAIN_ID}&mainProtocolId=${protocolId}&page=${page}&items=100`;
      }

      const response = await globalThis.fetch(url);
      const data = await response.json();

      let pageCampaigns: Campaign[] = [];
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
        // Cache the fetched campaigns
        await cacheMerklCampaigns(protocolId, page, pageCampaigns);
        
        if (pageCampaigns.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }

      // Rate limiting (only for API calls, not cached)
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error fetching campaigns page ${page}:`, error);
      hasMore = false;
    }
  }

  return campaigns;
}

/**
 * Fetch campaign details
 */
async function fetchCampaignDetails(campaignId: string) {
  try {
    const url = `${MERKL_API_BASE}/v4/campaigns/${campaignId}`;
    const response = await globalThis.fetch(url);
    return await response.json();
  } catch (error) {
    return null;
  }
}

/**
 * Fetch opportunity details
 */
async function fetchOpportunity(opportunityId: string) {
  try {
    const url = `${MERKL_API_BASE}/v4/opportunities/${opportunityId}`;
    const response = await globalThis.fetch(url);
    return await response.json();
  } catch (error) {
    return null;
  }
}

/**
 * Fetch campaign metrics (returns full metrics object)
 */
async function fetchCampaignMetrics(campaignId: string) {
  try {
    const url = `${MERKL_API_BASE}/v4/campaigns/${campaignId}/metrics`;
    const response = await globalThis.fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    return { dailyRewardsRecords: [], aprRecords: [], tvlRecords: [] };
  }
}

/**
 * Get APR at the end of the date range from campaign metrics
 */
function getAPRAtDate(aprRecords: any[], endTimestamp: number): number | undefined {
  if (!aprRecords || aprRecords.length === 0) {
    return undefined;
  }

  // Find the APR record closest to (but not after) the end timestamp
  const validRecords = aprRecords.filter(record => {
    const recordTimestamp = parseInt(record.timestamp);
    return recordTimestamp <= endTimestamp;
  });

  if (validRecords.length === 0) {
    return undefined;
  }

  // Get the record closest to the end timestamp
  const closestRecord = validRecords.reduce((closest, current) => {
    const closestTime = parseInt(closest.timestamp);
    const currentTime = parseInt(current.timestamp);
    return Math.abs(currentTime - endTimestamp) < Math.abs(closestTime - endTimestamp)
      ? current
      : closest;
  });

  return closestRecord?.apr !== undefined ? parseFloat(String(closestRecord.apr)) : undefined;
}

/**
 * Get TVL at the end of the date range from campaign metrics
 */
function getTVLAtDate(tvlRecords: any[], endTimestamp: number): number | undefined {
  if (!tvlRecords || tvlRecords.length === 0) {
    return undefined;
  }

  // Find the TVL record closest to (but not after) the end timestamp
  const validRecords = tvlRecords.filter(record => {
    const recordTimestamp = parseInt(record.timestamp);
    return recordTimestamp <= endTimestamp;
  });

  if (validRecords.length === 0) {
    return undefined;
  }

  // Get the record closest to the end timestamp
  const closestRecord = validRecords.reduce((closest, current) => {
    const closestTime = parseInt(closest.timestamp);
    const currentTime = parseInt(current.timestamp);
    return Math.abs(currentTime - endTimestamp) < Math.abs(closestTime - endTimestamp)
      ? current
      : closest;
  });

  return closestRecord?.total !== undefined ? parseFloat(String(closestRecord.total)) : undefined;
}

/**
 * Calculate total MON spent
 */
function calculateTotalMONSpent(
  dailyRewardsRecords: any[],
  rewardToken: any,
  startTimestamp: number,
  endTimestamp: number
) {
  let totalMON = 0;
  let totalUSD = 0;

  if (!rewardToken || !rewardToken.price) {
    return { totalMON: 0, totalUSD: 0 };
  }

  const tokenPrice = parseFloat(rewardToken.price);

  for (const record of dailyRewardsRecords) {
    const timestamp = parseInt(record.timestamp);
    if (timestamp >= startTimestamp && timestamp <= endTimestamp) {
      const usdValue = parseFloat(record.total || 0);
      if (usdValue > 0) {
        const monAmount = usdValue / tokenPrice;
        totalMON += monAmount;
        totalUSD += usdValue;
      }
    }
  }

  return { totalMON, totalUSD };
}

export async function POST(request: NextRequest) {
  try {
    const body: QueryParams = await request.json();
    const { protocols, startDate, endDate, token = 'WMON' } = body;

    // Validate inputs
    if (!protocols || protocols.length === 0) {
      return NextResponse.json(
        { error: 'Protocols are required' },
        { status: 400 }
      );
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Start and end dates are required' },
        { status: 400 }
      );
    }

    // Parse dates
    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T23:59:59Z');
    const startTimestamp = Math.floor(start.getTime() / 1000);
    const endTimestamp = Math.floor(end.getTime() / 1000);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // Fetch campaigns for all protocols
    let allCampaigns: Campaign[] = [];

    if (protocols.length === 1 && protocols[0] === 'all') {
      allCampaigns = await fetchCampaigns('all');
    } else {
      for (const protocol of protocols) {
        const protocolCampaigns = await fetchCampaigns(protocol);
        allCampaigns.push(...protocolCampaigns);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Filter by token symbol
    const tokenSymbols = token === 'MON' ? ['MON', 'WMON', 'cWMON'] : ['WMON', 'MON', 'cWMON'];
    const relevantCampaigns = allCampaigns.filter(campaign => {
      const rewardToken = campaign.rewardToken;
      if (!rewardToken) return false;

      const isTargetToken = tokenSymbols.includes(rewardToken.symbol);
      if (!isTargetToken) return false;

      const startTime = campaign.startTimestamp ? parseInt(String(campaign.startTimestamp)) : 0;
      const endTime = campaign.endTimestamp ? parseInt(String(campaign.endTimestamp)) : Infinity;
      const overlaps = startTime <= endTimestamp && endTime >= startTimestamp;

      return overlaps;
    });

    // Group by platform protocol and funding protocol, with market breakdown
    // Structure: platformProtocol -> fundingProtocol -> markets -> total
    interface MarketData {
      marketName: string;
      totalMON: number;
      apr?: number; // APR in percentage (e.g., 8.08 means 8.08%)
      tvl?: number; // TVL in USD at the end of date range
      merklUrl?: string; // Link to Merkl opportunity/campaign page
    }
    
    interface FundingProtocolData {
      fundingProtocol: string;
      markets: MarketData[];
      totalMON: number;
    }
    
    interface PlatformData {
      platformProtocol: string;
      fundingProtocols: FundingProtocolData[];
      totalMON: number;
    }
    
    const platformData: Record<string, PlatformData> = {};

    for (const campaign of relevantCampaigns) {
      const campaignId = campaign.id || campaign.campaignId;
      if (!campaignId) continue;

      // Get campaign details to determine funding protocol
      const campaignDetails = await fetchCampaignDetails(String(campaignId));
      
      // Determine funding protocol (who paid for the campaign)
      let fundingProtocolId = 'unknown';
      if (campaignDetails?.protocol?.id) {
        fundingProtocolId = campaignDetails.protocol.id;
      } else if (campaign.mainProtocolId) {
        fundingProtocolId = campaign.mainProtocolId;
      } else if (campaign.creator?.tags && campaign.creator.tags.length > 0) {
        fundingProtocolId = campaign.creator.tags[0];
      }

      // Determine platform protocol (where the campaign runs) and get market name + APR + TVL + URL
      // Use the protocol we queried, or determine from opportunity
      let platformProtocolId = 'unknown';
      let marketName = 'Unknown Market';
      let marketAPR: number | undefined = undefined;
      let marketTVL: number | undefined = undefined;
      let merklUrl: string | undefined = undefined;
      let opportunityId: string | undefined = campaign.opportunityId;
      let opportunityData: any = null; // Store opportunity data to avoid double-fetching
      
      if (protocols.length === 1 && protocols[0] !== 'all') {
        // If we queried a specific protocol, that's the platform
        platformProtocolId = protocols[0];
        
        // Still fetch opportunity for market name, APR, TVL, and URL
        if (campaign.opportunityId) {
          try {
            opportunityData = await fetchOpportunity(String(campaign.opportunityId));
            marketName = opportunityData?.name || `Market ${campaign.opportunityId}`;
            marketAPR = opportunityData?.apr !== undefined ? parseFloat(String(opportunityData.apr)) : undefined;
            // Get TVL from opportunity as initial value (will be overridden by campaign metrics if available)
            if (opportunityData?.tvl !== undefined && opportunityData.tvl > 0) {
              marketTVL = parseFloat(String(opportunityData.tvl));
            }
            // Generate Merkl search page URL with protocol search
            // Using search page instead of direct opportunity links due to URL case sensitivity issues
            if (opportunityData?.chain?.name && opportunityData?.protocol?.id) {
              const chainName = opportunityData.chain.name.toLowerCase();
              const protocolId = opportunityData.protocol.id;
              merklUrl = `https://app.merkl.xyz/chains/${chainName}?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
            }
          } catch (e) {
            marketName = `Market ${campaign.opportunityId}`;
          }
        }
      } else {
        // For "all" queries, determine from opportunity
        if (campaign.opportunityId) {
          try {
            opportunityData = await fetchOpportunity(String(campaign.opportunityId));
            platformProtocolId = opportunityData?.protocol?.id || fundingProtocolId;
            marketName = opportunityData?.name || `Market ${campaign.opportunityId}`;
            marketAPR = opportunityData?.apr !== undefined ? parseFloat(String(opportunityData.apr)) : undefined;
            // Get TVL from opportunity as initial value (will be overridden by campaign metrics if available)
            if (opportunityData?.tvl !== undefined && opportunityData.tvl > 0) {
              marketTVL = parseFloat(String(opportunityData.tvl));
            }
            // Generate Merkl search page URL with protocol search
            // Using search page instead of direct opportunity links due to URL case sensitivity issues
            if (opportunityData?.chain?.name && opportunityData?.protocol?.id) {
              const chainName = opportunityData.chain.name.toLowerCase();
              const protocolId = opportunityData.protocol.id;
              merklUrl = `https://app.merkl.xyz/chains/${chainName}?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
            }
          } catch (e) {
            platformProtocolId = fundingProtocolId;
            marketName = `Market ${campaign.opportunityId}`;
          }
        } else {
          platformProtocolId = fundingProtocolId;
        }
      }

      const rewardToken = campaignDetails?.rewardToken || campaign.rewardToken;
      const metrics = await fetchCampaignMetrics(String(campaignId));
      const { totalMON } = calculateTotalMONSpent(
        metrics.dailyRewardsRecords || [],
        rewardToken,
        startTimestamp,
        endTimestamp
      );

      // Try to get APR and TVL at the end of the date range from campaign metrics
      // This is more accurate than current opportunity data for historical queries
      const aprAtEndDate = getAPRAtDate(metrics.aprRecords || [], endTimestamp);
      if (aprAtEndDate !== undefined) {
        marketAPR = aprAtEndDate;
      }
      
      const tvlAtEndDate = getTVLAtDate(metrics.tvlRecords || [], endTimestamp);
      if (tvlAtEndDate !== undefined && tvlAtEndDate > 0) {
        // Use TVL from campaign metrics (more accurate for historical queries)
        marketTVL = tvlAtEndDate;
      } else if (marketTVL === undefined && opportunityData?.tvl !== undefined && opportunityData.tvl > 0) {
        // Fallback to opportunity TVL if campaign metrics don't have TVL at end date
        // This can happen for active campaigns that haven't ended yet
        marketTVL = parseFloat(String(opportunityData.tvl));
      }

      if (totalMON <= 0) continue;

      // Initialize platform data structure
      if (!platformData[platformProtocolId]) {
        platformData[platformProtocolId] = {
          platformProtocol: platformProtocolId,
          fundingProtocols: [],
          totalMON: 0,
        };
      }

      // Find or create funding protocol entry
      let fundingProtocolData = platformData[platformProtocolId].fundingProtocols.find(
        fp => fp.fundingProtocol === fundingProtocolId
      );

      if (!fundingProtocolData) {
        fundingProtocolData = {
          fundingProtocol: fundingProtocolId,
          markets: [],
          totalMON: 0,
        };
        platformData[platformProtocolId].fundingProtocols.push(fundingProtocolData);
      }

      // Find or create market entry
      let marketData = fundingProtocolData.markets.find(m => m.marketName === marketName);
      if (!marketData) {
        marketData = {
          marketName,
          totalMON: 0,
          apr: marketAPR,
          tvl: marketTVL,
          merklUrl: merklUrl,
        };
        fundingProtocolData.markets.push(marketData);
      } else {
        // Update APR if we have a newer value (keep the highest APR if multiple campaigns)
        if (marketAPR !== undefined && (marketData.apr === undefined || marketAPR > marketData.apr)) {
          marketData.apr = marketAPR;
        }
        // Update TVL if we have a valid value
        // Always update if current TVL is undefined, or if new TVL is valid and greater
        if (marketTVL !== undefined && marketTVL > 0) {
          if (marketData.tvl === undefined || marketTVL > marketData.tvl) {
            marketData.tvl = marketTVL;
          }
        }
        // Update URL if not already set
        if (merklUrl && !marketData.merklUrl) {
          marketData.merklUrl = merklUrl;
        }
      }

      // Add to totals
      marketData.totalMON += totalMON;
      fundingProtocolData.totalMON += totalMON;
      platformData[platformProtocolId].totalMON += totalMON;

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Format results for API response
    const results = Object.values(platformData)
      .map(platform => ({
        platformProtocol: platform.platformProtocol,
        totalMON: parseFloat(platform.totalMON.toFixed(2)),
        fundingProtocols: platform.fundingProtocols
          .map(fp => ({
            fundingProtocol: fp.fundingProtocol,
            totalMON: parseFloat(fp.totalMON.toFixed(2)),
            markets: fp.markets
              .map(m => ({
                marketName: m.marketName,
                totalMON: parseFloat(m.totalMON.toFixed(2)),
                apr: m.apr !== undefined ? parseFloat(m.apr.toFixed(2)) : undefined,
                tvl: m.tvl !== undefined ? parseFloat(m.tvl.toFixed(2)) : undefined,
                merklUrl: m.merklUrl,
              }))
              .sort((a, b) => b.totalMON - a.totalMON), // Sort markets by MON descending
          }))
          .sort((a, b) => b.totalMON - a.totalMON), // Sort funding protocols by MON descending
      }))
      .sort((a, b) => a.platformProtocol.localeCompare(b.platformProtocol));

    return NextResponse.json({
      success: true,
      results,
      dateRange: {
        start: startDate,
        end: endDate,
      },
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
