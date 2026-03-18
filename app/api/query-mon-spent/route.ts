import { NextRequest, NextResponse } from 'next/server';
import { 
  getCachedMerklCampaigns, 
  cacheMerklCampaigns,
  getCachedMerklCampaignDetails,
  cacheMerklCampaignDetails,
  getCachedMerklCampaignMetrics,
  cacheMerklCampaignMetrics,
  getCachedMerklOpportunity,
  cacheMerklOpportunity
} from '@/app/lib/cache';

const MERKL_API_BASE = 'https://api.merkl.xyz';
const MONAD_CHAIN_ID = 143;

// Funder address to protocol name mapping
// Maps campaign creator addresses to human-readable protocol names
const FUNDER_ADDRESS_MAP: Record<string, string> = {
  // Neverland addresses
  '0xb83a6637c87e6a7192b3ada845c0745f815e9006': 'neverland', // Neverland Safe multisig
  '0xcb69535abbc95a042914507f963bdd74ad0025ff': 'neverland', // Neverland-associated wallet
  '0x909b176220b7e782c0f3ceccab4b19d2c433c6bb': 'neverland', // Neverland funder wallet
  // Balancer addresses
  '0xf3b4829c8b9e2910c2396538f49a12b0c2475a7e': 'balancer', // Balancer v3 Safe multisig
};

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
  noCache?: boolean; // Skip cache lookup if true
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
 * @param endDate - Optional end date to determine if this is historical data
 * @param noCache - Skip cache lookup if true
 */
async function fetchCampaigns(protocolId: string, endDate?: string, noCache?: boolean): Promise<Campaign[]> {
  const campaigns: Campaign[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      // Check cache first (unless noCache is true)
      if (!noCache) {
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
      } else {
        console.log(`[noCache] Bypassing cache for campaigns: ${protocolId} page ${page}`);
      }

      // Cache miss - fetch from API
      // NOTE: mainProtocolId parameter is case-sensitive and must match Merkl's exact protocol IDs
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
        // Determine if this is historical data (endDate is in the past)
        // Historical campaigns never change, so cache longer
        const isHistorical = endDate ? (new Date(endDate).getTime() < Date.now() - 86400000) : false; // More than 1 day ago
        await cacheMerklCampaigns(protocolId, page, pageCampaigns, isHistorical);
        
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
 * Fetch campaign details (with caching)
 */
async function fetchCampaignDetails(campaignId: string, isHistorical: boolean = false) {
  try {
    // Check cache first
    const cached = await getCachedMerklCampaignDetails(campaignId);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from API
    const url = `${MERKL_API_BASE}/v4/campaigns/${campaignId}`;
    const response = await globalThis.fetch(url);
    const data = await response.json();
    
    // Cache the result
    await cacheMerklCampaignDetails(campaignId, data, isHistorical);
    
    return data;
  } catch (error) {
    return null;
  }
}

/**
 * Fetch opportunity details (with caching)
 */
async function fetchOpportunity(opportunityId: string, isHistorical: boolean = false) {
  try {
    // Check cache first
    const cached = await getCachedMerklOpportunity(opportunityId);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from API
    const url = `${MERKL_API_BASE}/v4/opportunities/${opportunityId}`;
    const response = await globalThis.fetch(url);
    const data = await response.json();
    
    // Cache the result
    await cacheMerklOpportunity(opportunityId, data, isHistorical);
    
    return data;
  } catch (error) {
    return null;
  }
}

/**
 * Fetch campaign metrics (returns full metrics object) (with caching)
 */
async function fetchCampaignMetrics(campaignId: string, isHistorical: boolean = false) {
  try {
    // Check cache first
    const cached = await getCachedMerklCampaignMetrics(campaignId);
    if (cached) {
      return cached;
    }

    // Cache miss - fetch from API
    const url = `${MERKL_API_BASE}/v4/campaigns/${campaignId}/metrics`;
    const response = await globalThis.fetch(url);
    const data = await response.json();
    
    // Cache the result
    await cacheMerklCampaignMetrics(campaignId, data, isHistorical);
    
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
 * Calculate total MON spent using pro-rated token amount from campaign
 * Uses actual token quantity from campaign.amount, pro-rated by overlap with query date range
 */
function calculateTotalMONSpent(
  campaign: any,
  queryStartTimestamp: number,
  queryEndTimestamp: number
) {
  // Get campaign's total token amount (in wei, 18 decimals)
  const totalAmountWei = campaign.amount ? BigInt(campaign.amount) : BigInt(0);
  if (totalAmountWei === BigInt(0)) {
    return { totalMON: 0 };
  }

  // Get campaign duration
  const campaignStart = parseInt(String(campaign.startTimestamp));
  const campaignEnd = parseInt(String(campaign.endTimestamp));
  const campaignDuration = campaignEnd - campaignStart;

  if (campaignDuration <= 0) {
    return { totalMON: 0 };
  }

  // Calculate overlap between campaign and query date range
  const overlapStart = Math.max(campaignStart, queryStartTimestamp);
  const overlapEnd = Math.min(campaignEnd, queryEndTimestamp);
  const overlapDuration = Math.max(0, overlapEnd - overlapStart);

  if (overlapDuration <= 0) {
    return { totalMON: 0 };
  }

  // Pro-rate the token amount based on overlap
  // totalMON = totalAmount * (overlapDuration / campaignDuration)
  const totalAmountNumber = Number(totalAmountWei) / 1e18; // Convert from wei to tokens
  const proRatedMON = totalAmountNumber * (overlapDuration / campaignDuration);

  return { totalMON: proRatedMON };
}

/**
 * Calculate total USD spent for external (non-MON) tokens
 */
function calculateExternalIncentiveUSD(
  dailyRewardsRecords: any[],
  startTimestamp: number,
  endTimestamp: number
) {
  let totalUSD = 0;

  for (const record of dailyRewardsRecords) {
    const timestamp = parseInt(record.timestamp);
    if (timestamp >= startTimestamp && timestamp <= endTimestamp) {
      const usdValue = parseFloat(record.total || 0);
      if (usdValue > 0) {
        totalUSD += usdValue;
      }
    }
  }

  return totalUSD;
}

export async function POST(request: NextRequest) {
  try {
    // Check if request has body
    const contentType = request.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type must be application/json' },
        { status: 400 }
      );
    }

    let body: QueryParams;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const { protocols, startDate, endDate, token = 'WMON', noCache = false } = body;

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
    
    // Determine if this is historical data (for caching)
    const isHistorical = end.getTime() < Date.now() - 86400000; // More than 1 day ago

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // Fetch campaigns for all protocols
    // Pass endDate to determine if this is historical data (for longer cache TTL)
    // NOTE: mainProtocolId parameter is case-sensitive and must match Merkl's exact protocol IDs
    let allCampaigns: Campaign[] = [];

    if (protocols.length === 1 && protocols[0] === 'all') {
      allCampaigns = await fetchCampaigns('all', endDate, noCache);
    } else {
      for (const protocol of protocols) {
        const protocolCampaigns = await fetchCampaigns(protocol, endDate, noCache);
        allCampaigns.push(...protocolCampaigns);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // MON token symbols - used to separate MON incentives from external incentives
    const monTokenSymbols = ['MON', 'WMON', 'cWMON'];

    // Filter campaigns that overlap with date range (include ALL token types)
    // IMPORTANT: Exclude child campaigns to prevent double counting
    // Merkl creates child campaigns when tokens flow to downstream protocols
    // (e.g., earnAUSD campaign creates children for Neverland, Curvance where earnAUSD is deposited)
    const relevantCampaigns = allCampaigns.filter((campaign: any) => {
      const rewardToken = campaign.rewardToken;
      if (!rewardToken) return false;

      // Skip child campaigns - they are auto-generated and cause double counting
      // A campaign is a child if it has a parentCampaignId that differs from its own id
      if (campaign.parentCampaignId && campaign.parentCampaignId !== campaign.id) {
        return false;
      }

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
      externalIncentiveUSD: number; // USD value of non-MON incentives (e.g., AUSD)
      apr?: number; // APR in percentage (e.g., 8.08 means 8.08%)
      tvl?: number; // TVL in USD at the end of date range
      merklUrl?: string; // Link to Merkl opportunity/campaign page
    }

    interface FundingProtocolData {
      fundingProtocol: string;
      markets: MarketData[];
      totalMON: number;
      externalIncentiveUSD: number;
    }

    interface PlatformData {
      platformProtocol: string;
      fundingProtocols: FundingProtocolData[];
      totalMON: number;
      externalIncentiveUSD: number;
    }

    const platformData: Record<string, PlatformData> = {};

    // Process campaigns in batches to avoid timeout
    const BATCH_SIZE = 50;
    const BATCH_DELAY_MS = 100;

    interface CampaignResult {
      platformProtocolId: string;
      fundingProtocolId: string;
      marketName: string;
      totalMON: number;
      externalUSD: number;
      marketAPR?: number;
      marketTVL?: number;
      merklUrl?: string;
    }

    async function processCampaign(campaign: any): Promise<CampaignResult | null> {
      const campaignId = campaign.id || campaign.campaignId;
      if (!campaignId) return null;

      try {
        // Get funder from campaign data first (avoid unnecessary fetch)
        // Prefer tags[0] over creatorId if creatorId looks like an address (starts with 0x)
        let fundingProtocolId = 'unknown';
        const creatorId = campaign.creator?.creatorId;
        const creatorTag = campaign.creator?.tags?.[0];

        if (creatorTag && (!creatorId || creatorId.startsWith('0x'))) {
          // Use tag if creatorId is missing or is an address
          fundingProtocolId = creatorTag;
        } else if (creatorId) {
          fundingProtocolId = creatorId;
        } else if (campaign.creator?.tags && campaign.creator.tags.length > 0) {
          fundingProtocolId = campaign.creator.tags[0];
        } else if (campaign.mainProtocolId) {
          fundingProtocolId = campaign.mainProtocolId;
        }

        // Apply funder address mapping (convert addresses to protocol names)
        const normalizedFunderId = fundingProtocolId.toLowerCase();
        const mappedFunder = FUNDER_ADDRESS_MAP[normalizedFunderId];
        if (mappedFunder) {
          fundingProtocolId = mappedFunder;
        }

        // Fetch opportunity and metrics in parallel
        const [opportunityData, metrics] = await Promise.all([
          campaign.opportunityId ? fetchOpportunity(String(campaign.opportunityId), isHistorical) : null,
          fetchCampaignMetrics(String(campaignId), isHistorical)
        ]);

        // Determine platform protocol
        let platformProtocolId = opportunityData?.protocol?.id || fundingProtocolId;
        let marketName = opportunityData?.name || `Market ${campaign.opportunityId || campaignId}`;
        let marketAPR = opportunityData?.apr !== undefined ? parseFloat(String(opportunityData.apr)) : undefined;
        let marketTVL = opportunityData?.tvl !== undefined && opportunityData.tvl > 0
          ? parseFloat(String(opportunityData.tvl)) : undefined;
        let merklUrl: string | undefined;

        if (opportunityData?.chain?.name && opportunityData?.protocol?.id) {
          const chainName = opportunityData.chain.name.toLowerCase();
          const protocolId = opportunityData.protocol.id;
          merklUrl = `https://app.merkl.xyz/chains/${chainName}?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
        }

        const rewardToken = campaign.rewardToken;
        const tokenSymbol = rewardToken?.symbol || '';
        const isMonToken = monTokenSymbols.includes(tokenSymbol);

        let totalMON = 0;
        let externalUSD = 0;

        if (isMonToken) {
          const result = calculateTotalMONSpent(
            campaign,
            startTimestamp,
            endTimestamp
          );
          totalMON = result.totalMON;
        } else {
          externalUSD = calculateExternalIncentiveUSD(
            metrics.dailyRewardsRecords || [],
            startTimestamp,
            endTimestamp
          );
        }

        // Get APR and TVL at end date from metrics
        const aprAtEndDate = getAPRAtDate(metrics.aprRecords || [], endTimestamp);
        if (aprAtEndDate !== undefined) {
          marketAPR = aprAtEndDate;
        }

        const tvlAtEndDate = getTVLAtDate(metrics.tvlRecords || [], endTimestamp);
        if (tvlAtEndDate !== undefined && tvlAtEndDate > 0) {
          marketTVL = tvlAtEndDate;
        }

        if (totalMON <= 0 && externalUSD <= 0) return null;

        return {
          platformProtocolId,
          fundingProtocolId,
          marketName,
          totalMON,
          externalUSD,
          marketAPR,
          marketTVL,
          merklUrl,
        };
      } catch (e) {
        return null;
      }
    }

    // Process in batches
    for (let i = 0; i < relevantCampaigns.length; i += BATCH_SIZE) {
      const batch = relevantCampaigns.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(processCampaign));

      // Aggregate batch results
      for (const result of batchResults) {
        if (!result) continue;

        const { platformProtocolId, fundingProtocolId, marketName, totalMON, externalUSD, marketAPR, marketTVL, merklUrl } = result;

        // Initialize platform data structure
        if (!platformData[platformProtocolId]) {
          platformData[platformProtocolId] = {
            platformProtocol: platformProtocolId,
            fundingProtocols: [],
            totalMON: 0,
            externalIncentiveUSD: 0,
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
            externalIncentiveUSD: 0,
          };
          platformData[platformProtocolId].fundingProtocols.push(fundingProtocolData);
        }

        // Find or create market entry
        let marketData = fundingProtocolData.markets.find(m => m.marketName === marketName);
        if (!marketData) {
          marketData = {
            marketName,
            totalMON: 0,
            externalIncentiveUSD: 0,
            apr: marketAPR,
            tvl: marketTVL,
            merklUrl: merklUrl,
          };
          fundingProtocolData.markets.push(marketData);
        } else {
          if (marketAPR !== undefined && (marketData.apr === undefined || marketAPR > marketData.apr)) {
            marketData.apr = marketAPR;
          }
          if (marketTVL !== undefined && marketTVL > 0) {
            if (marketData.tvl === undefined || marketTVL > marketData.tvl) {
              marketData.tvl = marketTVL;
            }
          }
          if (merklUrl && !marketData.merklUrl) {
            marketData.merklUrl = merklUrl;
          }
        }

        // Add to totals
        marketData.totalMON += totalMON;
        marketData.externalIncentiveUSD += externalUSD;
        fundingProtocolData.totalMON += totalMON;
        fundingProtocolData.externalIncentiveUSD += externalUSD;
        platformData[platformProtocolId].totalMON += totalMON;
        platformData[platformProtocolId].externalIncentiveUSD += externalUSD;
      }

      // Small delay between batches
      if (i + BATCH_SIZE < relevantCampaigns.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // Format results for API response
    const results = Object.values(platformData)
      .map(platform => ({
        platformProtocol: platform.platformProtocol,
        totalMON: parseFloat(platform.totalMON.toFixed(2)),
        externalIncentiveUSD: parseFloat(platform.externalIncentiveUSD.toFixed(2)),
        fundingProtocols: platform.fundingProtocols
          .map(fp => ({
            fundingProtocol: fp.fundingProtocol,
            totalMON: parseFloat(fp.totalMON.toFixed(2)),
            externalIncentiveUSD: parseFloat(fp.externalIncentiveUSD.toFixed(2)),
            markets: fp.markets
              .map(m => ({
                marketName: m.marketName,
                totalMON: parseFloat(m.totalMON.toFixed(2)),
                externalIncentiveUSD: parseFloat(m.externalIncentiveUSD.toFixed(2)),
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
