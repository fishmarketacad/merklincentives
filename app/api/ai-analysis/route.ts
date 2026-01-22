import { NextRequest, NextResponse } from 'next/server';

// Configure max duration for AI analysis (5 minutes = 300 seconds)
// This allows the function to run longer than the default 60s limit
export const maxDuration = 300; // 5 minutes

// ============================================================================
// AI PROVIDER CONFIGURATION - CHANGE THIS ONE LINE TO SWITCH BETWEEN PROVIDERS
// ============================================================================
// Options: 'grok' or 'claude'
// To switch providers, simply change the value below:
const AI_PROVIDER = (process.env.AI_PROVIDER || 'claude').toLowerCase();
// 
// Examples:
//   const AI_PROVIDER = (process.env.AI_PROVIDER || 'grok').toLowerCase();   // Use Grok
//   const AI_PROVIDER = (process.env.AI_PROVIDER || 'claude').toLowerCase(); // Use Claude
//
// ============================================================================

const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
const XAI_API_BASE = 'https://api.x.ai/v1';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
const CLAUDE_API_BASE = 'https://api.anthropic.com/v1';

const MERKL_API_BASE = 'https://api.merkl.xyz';
const MONAD_CHAIN_ID = 143;

// Compiled regex patterns (compile once, reuse many times)
const TOKEN_PAIR_REGEX = /([A-Z0-9]+)-([A-Z0-9]+)/;
const TOKEN_PAIR_REGEX_CASE_INSENSITIVE = /([a-z0-9]+)[-\/]([a-z0-9]+)/i;

// Configuration constants
const ANALYSIS_CONFIG = {
  thresholds: {
    highDiscrepancy: 15,      // % difference between expected and actual change
    mediumDiscrepancy: 5,     // % difference for medium confidence
    criticalSeverity: 30,     // % over expected range for critical issues
    highSeverity: 20,         // % over expected range for high issues
    wowChangeThreshold: 20,   // % WoW change to trigger explanation
  },
  assetTypes: {
    stablecoin: { range: [5, 15], definition: 'Both tokens are stablecoins (USDC/USDT/DAI/AUSD)' },
    'stablecoin-derivative': { range: [8, 18], definition: 'Stablecoin + yield-bearing stablecoin (AUSD-earnAUSD, USDC-sUSDC)' },
    'mon-related': { range: [0, 50], definition: 'Contains MON token (MON-USDC, MON-AUSD, MON-wBTC) - L1-native token pairs. Above 50% TVL Cost is inefficient (Uniswap MON-USDC benchmark ~50% APR). Below 50% is acceptable.' },
    'btc-related': { range: [10, 25], definition: 'Contains BTC (wBTC-USDC, wBTC-AUSD)' },
    'lst-related': { range: [8, 20], definition: 'Contains liquid staking tokens (stETH-ETH, rETH-USDC)' },
    commodity: { range: [10, 25], definition: 'Tokenized commodities (XAUt0-AUSD for gold)' },
  },
  models: {
    claude: 'claude-sonnet-4-5',
    grok: 'grok-4-1-fast-reasoning',
  },
};

interface PoolData {
  protocol: string;
  fundingProtocol: string;
  marketName: string;
  tokenPair: string; // Extracted from market name
  incentivesMON: number;
  incentivesUSD: number | null;
  tvl: number | null;
  volume: number | null;
  apr: number | null;
  tvlCost: number | null;
  wowChange: number | null;
  periodDays: number;
  merklUrl?: string; // Link to Merkl opportunity page
}

interface AnalysisRequest {
  currentWeek: {
    pools: PoolData[];
    startDate: string;
    endDate: string;
    monPrice: number | null;
  };
  previousWeek: {
    pools: PoolData[];
    startDate: string;
    endDate: string;
  } | null;
  // Optional: if true, fetch all campaigns and opportunities
  includeAllData?: boolean;
}

/**
 * Fetch all campaigns on Monad chain
 */
async function fetchAllCampaignsOnMonad(): Promise<any[]> {
  const campaigns: any[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
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
        
        if (pageCampaigns.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error fetching campaigns page ${page}:`, error);
      hasMore = false;
    }
  }

  return campaigns;
}

/**
 * Fetch all opportunities on Monad chain
 */
async function fetchAllOpportunitiesOnMonad(): Promise<any[]> {
  const opportunities: any[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
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
        
        if (pageOpportunities.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error fetching opportunities page ${page}:`, error);
      hasMore = false;
    }
  }

  return opportunities;
}

/**
 * Extract token pair from market name
 * e.g., "Provide liquidity to UniswapV4 MON-USDC 0.05%" -> "MON-USDC"
 */
function extractTokenPair(marketName: string): string {
  // Try to find pattern like "MON-USDC", "WBTC-WMON", etc.
  // Uses pre-compiled regex for better performance
  const match = marketName.match(TOKEN_PAIR_REGEX);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return marketName; // Fallback to full name
}

/**
 * Group similar pools by token pair
 */
function groupSimilarPools(pools: PoolData[]): Record<string, PoolData[]> {
  const groups: Record<string, PoolData[]> = {};
  
  for (const pool of pools) {
    const key = pool.tokenPair.toLowerCase();
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(pool);
  }
  
  return groups;
}

/**
 * Unified prompt generator for both pool-level and protocol-level analysis
 */
type AnalysisMode = 'pool-level' | 'protocol-level';

interface UnifiedAnalysisData {
  mode: AnalysisMode;
  // Common fields
  startDate: string;
  endDate: string;
  prevStartDate: string;
  prevEndDate: string;
  monPrice: number | null;
  // Pool-level mode: single protocol's pools
  pools?: PoolData[];
  previousPools?: PoolData[];
  // Protocol-level mode: multiple protocols with aggregated data
  protocols?: Array<{
    protocol: string;
    currentWeek: {
      pools: any[];
      totalIncentivesMON: number;
      totalIncentivesUSD: number;
      totalTVL: number;
      poolCount: number;
      avgTVLCost: number | null;
      maxTVLCost: number | null;
      minTVLCost: number | null;
    };
    previousWeek: {
      pools: any[];
      totalIncentivesMON: number;
      totalIncentivesUSD: number;
      totalTVL: number;
      avgTVLCost: number | null;
    } | null;
    wowChanges: {
      incentives: number | null;
      tvl: number | null;
      avgTVLCost: number | null;
    };
  }>;
}

/**
 * Generate unified prompt for AI analysis (supports both pool-level and protocol-level)
 */
async function generateUnifiedAnalysisPrompt(
  data: UnifiedAnalysisData,
  allCampaigns?: any[],
  allOpportunities?: any[]
): Promise<string> {
  const { mode, startDate, endDate, prevStartDate, prevEndDate, monPrice, pools, previousPools, protocols } = data;
  
  // Normalize data for unified processing
  let allPools: PoolData[] = [];
  let allPreviousPools: PoolData[] = [];
  
  if (mode === 'pool-level' && pools) {
    allPools = pools;
    allPreviousPools = previousPools || [];
  } else if (mode === 'protocol-level' && protocols) {
    // Flatten protocol pools into single array
    for (const protocol of protocols) {
      for (const pool of protocol.currentWeek.pools) {
        allPools.push({
          protocol: protocol.protocol,
          fundingProtocol: pool.fundingProtocol || protocol.protocol,
          marketName: pool.marketName,
          tokenPair: extractTokenPair(pool.marketName),
          incentivesMON: pool.incentivesMON,
          incentivesUSD: pool.incentivesUSD,
          tvl: pool.tvl,
          volume: null,
          apr: pool.apr,
          tvlCost: pool.tvl && pool.incentivesUSD ? parseFloat(calculateTVLCostFromData(pool.incentivesUSD, pool.tvl, startDate, endDate).replace('%', '')) : null,
          wowChange: null,
          periodDays: Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1,
          merklUrl: pool.merklUrl,
        });
      }
      if (protocol.previousWeek) {
        for (const pool of protocol.previousWeek.pools) {
          allPreviousPools.push({
            protocol: protocol.protocol,
            fundingProtocol: pool.fundingProtocol || protocol.protocol,
            marketName: pool.marketName,
            tokenPair: extractTokenPair(pool.marketName),
            incentivesMON: pool.incentivesMON,
            incentivesUSD: pool.incentivesUSD,
            tvl: pool.tvl,
            volume: null,
            apr: null,
            tvlCost: pool.tvl && pool.incentivesUSD ? parseFloat(calculateTVLCostFromData(pool.incentivesUSD, pool.tvl, prevStartDate, prevEndDate).replace('%', '')) : null,
            wowChange: null,
            periodDays: Math.floor((new Date(prevEndDate).getTime() - new Date(prevStartDate).getTime()) / (1000 * 60 * 60 * 24)) + 1,
          });
        }
      }
    }
  }
  
  const similarPools = groupSimilarPools(allPools);
  
  // Calculate data quality metrics
  const hasPreviousWeek = allPreviousPools.length > 0;
  const poolsWithPreviousData = allPools.filter(pool => {
    if (!hasPreviousWeek) return false;
    return allPreviousPools.some(prev => 
      prev.protocol === pool.protocol && 
      prev.fundingProtocol === pool.fundingProtocol && 
      prev.marketName === pool.marketName
    );
  }).length;
  const canPerformWowAnalysis = hasPreviousWeek && poolsWithPreviousData > 0;
  
  // Count campaigns with useful data
  // Try to extract protocol ID from campaign or opportunity data
  const campaignsWithData = allCampaigns ? allCampaigns.filter(c => {
    // First try direct protocol ID from campaign
    let protocolId = c.mainProtocolId || c.protocol?.id;
    
    // If not found, try to get from opportunity data if available
    if (!protocolId && c.opportunityId && allOpportunities) {
      const opportunity = allOpportunities.find((opp: any) => 
        opp.id === c.opportunityId || opp.opportunityId === c.opportunityId
      );
      if (opportunity) {
        protocolId = opportunity.mainProtocolId || opportunity.protocol?.id;
      }
    }
    
    return protocolId && protocolId !== 'unknown';
  }).length : 0;
  const campaignDataCompleteness = allCampaigns ? (campaignsWithData / allCampaigns.length * 100).toFixed(1) : '0';
  
  // Build prompt based on mode
  const taskDescription = mode === 'pool-level' 
    ? 'an expert DeFi analyst conducting an institutional-grade efficiency review. Your analysis is objective, data-driven, and devoid of sensationalism. You explain the "why" behind the numbers using precise financial logic.'
    : 'an expert DeFi analyst providing protocol-level incentive efficiency recommendations to protocol teams.';
  
  const contextDescription = mode === 'pool-level'
    ? `- **Current Period**: ${startDate} to ${endDate}\n- **Previous Period**: ${hasPreviousWeek ? `${prevStartDate} to ${prevEndDate}` : 'Not available'}`
    : `- **Analysis Period**: ${startDate} to ${endDate}\n- **Previous Period**: ${prevStartDate} to ${prevEndDate}`;
  
  let prompt = `You are ${taskDescription}

## Context
${contextDescription}
- **MON Price**: ${monPrice ? `$${monPrice}` : 'Not provided'}
${mode === 'protocol-level' && protocols ? `- **Protocols Analyzed**: ${protocols.length} protocols` : ''}

## Data Quality Assessment
${canPerformWowAnalysis ? '✅' : '❌'} **WoW Analysis**: ${canPerformWowAnalysis ? `Available for ${poolsWithPreviousData}/${allPools.length} pools` : 'NOT AVAILABLE - Previous period data missing'}
${allCampaigns ? `⚠️ **Competitor Data**: ${campaignDataCompleteness}% of campaigns have identifiable protocol data (${campaignsWithData}/${allCampaigns.length} campaigns)` : '⚠️ **Competitor Data**: Not fetched'}
${allOpportunities ? `✅ **Opportunities Data**: ${allOpportunities.length} total opportunities on Monad` : '⚠️ **Opportunities Data**: Not fetched'}

## Calculation Notes
- **TVL Cost WoW Change** = ((Current TVL Cost - Previous TVL Cost) / Previous TVL Cost) × 100
- **Expected Mechanical Change** = (1 + Incentive Change%) / (1 + TVL Change%) - 1
  * This estimates what TVL Cost change should be based purely on incentive/TVL math
  * If actual change differs by >15%, external factors (competitors, market conditions) are likely involved
  * Example: +6.7% incentives, -2.2% TVL → Expected: (1.067/0.978 - 1) ≈ +9.1% TVL Cost

## Key Metrics Explained
- **TVL Cost**: (Incentives annualized / TVL) × 100. This represents the APR being paid to attract TVL. Lower is better.
- **Volume Cost**: (Incentives annualized / Volume) × 100. This represents the cost per dollar of trading volume. Lower is better. Only applicable for DEX pools with volume data.
- **WoW Change**: Week-over-week percentage change in TVL Cost or Volume Cost. Negative is better (cost decreased).
- **APR**: Annual Percentage Rate from Merkl incentives.

## Asset Classification & Expected Ranges
Pools are grouped by asset risk profile. **Only compare pools within the same asset type.**

| Asset Type | Definition | Expected TVL Cost Range |
|------------|------------|------------------------|
| **Stablecoin** | Both tokens are stablecoins (USDC/USDT/DAI/AUSD) | 5-15% |
| **Stablecoin-Derivative** | Stablecoin + yield-bearing stablecoin (AUSD-earnAUSD, USDC-sUSDC) | 8-18% |
| **MON Pairs** | Contains MON token (MON-USDC, MON-AUSD, MON-wBTC) - L1-native token pairs | 0-50% (above 50% is inefficient; Uniswap MON-USDC benchmark ~50% APR) |
| **BTC Pairs** | Contains BTC (wBTC-USDC, wBTC-AUSD) | 10-25% |
| **LST Pairs** | Contains liquid staking tokens (stETH-ETH, rETH-USDC) | 8-20% |
| **Commodity** | Tokenized commodities (XAUt0-AUSD for gold) | 10-25% |

**Asset type is determined by the riskier/more volatile token in the pair.**

`;

  // Add pool data section
  prompt += await addPoolDataSection(mode, allPools, allPreviousPools, protocols, startDate, endDate, prevStartDate, prevEndDate);
  
  // Add similar pools comparison (only for pool-level mode)
  if (mode === 'pool-level') {
    prompt += `\n## Similar Pools Comparison\n`;
    prompt += `These are pools from your selected protocols with the same token pairs. Use these for direct comparisons.\n`;
    for (const [tokenPair, pools] of Object.entries(similarPools)) {
      if (pools.length > 1) {
        prompt += `\n### ${tokenPair.toUpperCase()} Pools (${pools.length} pools)\n`;
        for (const pool of pools) {
          const merklLink = pool.merklUrl ? ` [Merkl: ${pool.merklUrl}]` : '';
          prompt += `- ${pool.protocol} (${pool.fundingProtocol}): TVL Cost ${pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : 'N/A'}, APR ${pool.apr ? `${pool.apr.toFixed(2)}%` : 'N/A'}, Incentives ${pool.incentivesMON.toFixed(2)} MON${merklLink}\n`;
        }
      }
    }
  }
  
  // Add Example Opportunities section
  prompt += await addExampleOpportunitiesSection(allPools, allOpportunities);
  
  // Add campaigns section
  prompt += await addCampaignsSection(allPools, allCampaigns, allOpportunities);
  
  // Add all opportunities context
  prompt += await addAllOpportunitiesContext(allOpportunities);
  
  // Add analysis guidelines
  prompt += await addAnalysisGuidelines(mode, canPerformWowAnalysis);
  
  // Add output format
  prompt += await addOutputFormat(mode);
  
  return prompt;
}

/**
 * Helper: Add pool data section
 */
async function addPoolDataSection(
  mode: AnalysisMode,
  allPools: PoolData[],
  allPreviousPools: PoolData[],
  protocols: any[] | undefined,
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string
): Promise<string> {
  let section = '';
  
  if (mode === 'pool-level') {
    section += `\n## Current Week Pool Data\n`;
    const poolsByProtocol: Record<string, PoolData[]> = {};
    for (const pool of allPools) {
      if (!poolsByProtocol[pool.protocol]) {
        poolsByProtocol[pool.protocol] = [];
      }
      poolsByProtocol[pool.protocol].push(pool);
    }
    
    for (const [protocol, pools] of Object.entries(poolsByProtocol)) {
      section += `\n### ${protocol.toUpperCase()} Protocol\n`;
      for (const pool of pools) {
        const prevPool = allPreviousPools.find(p => 
          p.protocol === pool.protocol && 
          p.fundingProtocol === pool.fundingProtocol && 
          p.marketName === pool.marketName
        );
        
        section += `- **${pool.marketName}**\n`;
        section += `  - Funding Protocol: ${pool.fundingProtocol}\n`;
        section += `  - Token Pair: ${pool.tokenPair}\n`;
        section += `  - Current Week Incentives: ${pool.incentivesMON.toFixed(2)} MON${pool.incentivesUSD ? ` ($${pool.incentivesUSD.toFixed(2)})` : ''}\n`;
        if (prevPool) {
          section += `  - Previous Week Incentives: ${prevPool.incentivesMON.toFixed(2)} MON${prevPool.incentivesUSD ? ` ($${prevPool.incentivesUSD.toFixed(2)})` : ''}\n`;
          const incentiveChange = prevPool.incentivesUSD && pool.incentivesUSD 
            ? ((pool.incentivesUSD - prevPool.incentivesUSD) / prevPool.incentivesUSD * 100).toFixed(1)
            : 'N/A';
          section += `  - Incentive Change WoW: ${incentiveChange !== 'N/A' ? (parseFloat(incentiveChange) > 0 ? '+' : '') + incentiveChange + '%' : 'N/A'}\n`;
          section += `  - Previous Week TVL: ${prevPool.tvl ? `$${(prevPool.tvl / 1000000).toFixed(2)}M` : 'N/A'}\n`;
          section += `  - Previous Week TVL Cost: ${prevPool.tvlCost ? `${prevPool.tvlCost.toFixed(2)}%` : 'N/A'}\n`;
        } else {
          section += `  - Previous Week Data: MISSING (WoW analysis not possible)\n`;
        }
        section += `  - TVL: ${pool.tvl ? `$${(pool.tvl / 1000000).toFixed(2)}M` : 'N/A'}\n`;
        section += `  - Volume: ${pool.volume ? `$${(pool.volume / 1000000).toFixed(2)}M` : 'N/A'}\n`;
        section += `  - APR: ${pool.apr ? `${pool.apr.toFixed(2)}%` : 'N/A'}\n`;
        section += `  - TVL Cost: ${pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : 'N/A'}\n`;

        // Calculate Volume Cost (annualized cost per volume)
        const volumeCost = pool.volume && pool.incentivesUSD && pool.volume > 0
          ? ((pool.incentivesUSD / pool.periodDays * 365) / pool.volume * 100)
          : null;
        if (volumeCost !== null) {
          section += `  - Volume Cost: ${volumeCost.toFixed(2)}%\n`;
        }

        // TVL Cost WoW Change
        let wowChangeValue = pool.wowChange;
        if ((wowChangeValue === null || wowChangeValue === undefined) && prevPool && pool.tvlCost !== null && prevPool.tvlCost !== null && prevPool.tvlCost !== 0) {
          wowChangeValue = ((pool.tvlCost - prevPool.tvlCost) / prevPool.tvlCost) * 100;
        }
        if (wowChangeValue !== null && wowChangeValue !== undefined) {
          section += `  - TVL Cost WoW Change: ${wowChangeValue > 0 ? '+' : ''}${wowChangeValue.toFixed(2)}%\n`;
        } else if (prevPool) {
          section += `  - TVL Cost WoW Change: N/A (missing TVL Cost data)\n`;
        }

        // Volume Cost WoW Change
        if (prevPool && prevPool.volume) {
          const prevVolumeCost = prevPool.volume && prevPool.incentivesUSD && prevPool.volume > 0
            ? ((prevPool.incentivesUSD / prevPool.periodDays * 365) / prevPool.volume * 100)
            : null;

          section += `  - Previous Week Volume: ${prevPool.volume ? `$${(prevPool.volume / 1000000).toFixed(2)}M` : 'N/A'}\n`;

          const volumeChange = prevPool.volume && pool.volume
            ? ((pool.volume - prevPool.volume) / prevPool.volume * 100)
            : null;
          if (volumeChange !== null) {
            section += `  - Volume Change WoW: ${volumeChange > 0 ? '+' : ''}${volumeChange.toFixed(2)}%\n`;
          }

          if (volumeCost !== null && prevVolumeCost !== null && prevVolumeCost !== 0) {
            const volumeCostWoWChange = ((volumeCost - prevVolumeCost) / prevVolumeCost) * 100;
            section += `  - Volume Cost WoW Change: ${volumeCostWoWChange > 0 ? '+' : ''}${volumeCostWoWChange.toFixed(2)}%\n`;
          } else if (volumeCost === null) {
            section += `  - Volume Cost WoW Change: N/A (current week volume missing)\n`;
          } else if (prevVolumeCost === null) {
            section += `  - Volume Cost WoW Change: N/A (previous week volume missing)\n`;
          }
        } else if (volumeCost !== null) {
          section += `  - Volume Cost WoW Change: N/A (no previous week volume data)\n`;
        }
      }
    }
  } else if (mode === 'protocol-level' && protocols) {
    section += `\n## Protocol Data\n\n`;
    for (const protocol of protocols) {
      const { protocol: protocolName, currentWeek, previousWeek, wowChanges } = protocol;
      
      section += `### ${protocolName.toUpperCase()} Protocol\n`;
      section += `**Current Week (${startDate} to ${endDate}):**\n`;
      section += `- Total Incentives: ${currentWeek.totalIncentivesMON.toFixed(2)} MON ($${currentWeek.totalIncentivesUSD.toFixed(2)})\n`;
      section += `- Total TVL: $${(currentWeek.totalTVL / 1000000).toFixed(2)}M\n`;
      section += `- Number of Pools: ${currentWeek.poolCount}\n`;
      section += `- Average TVL Cost: ${currentWeek.avgTVLCost ? `${currentWeek.avgTVLCost.toFixed(2)}%` : 'N/A'}\n`;
      section += `- Max TVL Cost: ${currentWeek.maxTVLCost ? `${currentWeek.maxTVLCost.toFixed(2)}%` : 'N/A'}\n`;
      section += `- Min TVL Cost: ${currentWeek.minTVLCost ? `${currentWeek.minTVLCost.toFixed(2)}%` : 'N/A'}\n`;
      
      if (previousWeek) {
        section += `\n**Previous Week (${prevStartDate} to ${prevEndDate}):**\n`;
        section += `- Total Incentives: ${previousWeek.totalIncentivesMON.toFixed(2)} MON ($${previousWeek.totalIncentivesUSD.toFixed(2)})\n`;
        section += `- Total TVL: $${(previousWeek.totalTVL / 1000000).toFixed(2)}M\n`;
        section += `- Average TVL Cost: ${previousWeek.avgTVLCost ? `${previousWeek.avgTVLCost.toFixed(2)}%` : 'N/A'}\n`;
        
        if (wowChanges) {
          section += `\n**Week-over-Week Changes:**\n`;
          if (wowChanges.incentives !== null) {
            section += `- Incentives: ${wowChanges.incentives > 0 ? '+' : ''}${wowChanges.incentives.toFixed(2)}%\n`;
          }
          if (wowChanges.tvl !== null) {
            section += `- TVL: ${wowChanges.tvl > 0 ? '+' : ''}${wowChanges.tvl.toFixed(2)}%\n`;
          }
          if (wowChanges.avgTVLCost !== null) {
            section += `- Average TVL Cost: ${wowChanges.avgTVLCost > 0 ? '+' : ''}${wowChanges.avgTVLCost.toFixed(2)}%\n`;
          }
        }
      }
      
      section += `\n**All Pools (${currentWeek.pools.length} pools) - WITH PREVIOUS WEEK DATA FOR WoW ANALYSIS:**\n`;
      const sortedPools = [...currentWeek.pools].sort((a: any, b: any) => b.incentivesMON - a.incentivesMON);
      for (const pool of sortedPools) {
        const poolTVLCost = pool.tvl && pool.incentivesUSD ? calculateTVLCostFromData(pool.incentivesUSD, pool.tvl, startDate, endDate) : 'N/A';
        
        const prevPool = previousWeek?.pools.find((p: any) => 
          p.marketName === pool.marketName && 
          p.fundingProtocol === pool.fundingProtocol
        );
        
        section += `\n**${pool.marketName}** (${pool.fundingProtocol}):\n`;
        section += `  Current Week:\n`;
        section += `    - Incentives: ${pool.incentivesMON.toFixed(2)} MON ($${pool.incentivesUSD.toFixed(2)})\n`;
        section += `    - TVL: $${pool.tvl ? (pool.tvl / 1000000).toFixed(2) + 'M' : 'N/A'}\n`;
        section += `    - TVL Cost: ${poolTVLCost}\n`;
        section += `    - APR: ${pool.apr ? `${pool.apr.toFixed(2)}%` : 'N/A'}\n`;

        // Add volume data for current week
        if (pool.volume) {
          section += `    - Volume: $${(pool.volume / 1000000).toFixed(2)}M\n`;
          const periodDays = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
          const poolVolumeCost = pool.volume && pool.incentivesUSD && pool.volume > 0
            ? ((pool.incentivesUSD / periodDays * 365) / pool.volume * 100).toFixed(2) + '%'
            : 'N/A';
          if (poolVolumeCost !== 'N/A') {
            section += `    - Volume Cost: ${poolVolumeCost}\n`;
          }
        }

        if (prevPool) {
          const prevPoolTVLCost = prevPool.tvl && prevPool.incentivesUSD ? calculateTVLCostFromData(prevPool.incentivesUSD, prevPool.tvl, prevStartDate, prevEndDate) : 'N/A';
          const incentiveChange = prevPool.incentivesUSD && pool.incentivesUSD
            ? ((pool.incentivesUSD - prevPool.incentivesUSD) / prevPool.incentivesUSD * 100)
            : null;
          const tvlChange = prevPool.tvl && pool.tvl
            ? ((pool.tvl - prevPool.tvl) / prevPool.tvl * 100)
            : null;
          const tvlCostChange = prevPoolTVLCost !== 'N/A' && poolTVLCost !== 'N/A'
            ? parseFloat(poolTVLCost.replace('%', '')) - parseFloat(prevPoolTVLCost.replace('%', ''))
            : null;
          const tvlCostChangePercent = prevPoolTVLCost !== 'N/A' && tvlCostChange !== null
            ? (tvlCostChange / parseFloat(prevPoolTVLCost.replace('%', ''))) * 100
            : null;

          section += `  Previous Week:\n`;
          section += `    - Incentives: ${prevPool.incentivesMON.toFixed(2)} MON ($${prevPool.incentivesUSD.toFixed(2)})\n`;
          section += `    - TVL: $${prevPool.tvl ? (prevPool.tvl / 1000000).toFixed(2) + 'M' : 'N/A'}\n`;
          section += `    - TVL Cost: ${prevPoolTVLCost}\n`;

          // Add volume data for previous week
          if (prevPool.volume) {
            section += `    - Volume: $${(prevPool.volume / 1000000).toFixed(2)}M\n`;
            const prevPeriodDays = Math.floor((new Date(prevEndDate).getTime() - new Date(prevStartDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
            const prevPoolVolumeCost = prevPool.volume && prevPool.incentivesUSD && prevPool.volume > 0
              ? ((prevPool.incentivesUSD / prevPeriodDays * 365) / prevPool.volume * 100).toFixed(2) + '%'
              : 'N/A';
            if (prevPoolVolumeCost !== 'N/A') {
              section += `    - Volume Cost: ${prevPoolVolumeCost}\n`;
            }
          }

          section += `  WoW Changes:\n`;
          if (incentiveChange !== null) {
            section += `    - Incentive Change: ${incentiveChange > 0 ? '+' : ''}${incentiveChange.toFixed(2)}%\n`;
          }
          if (tvlChange !== null) {
            section += `    - TVL Change: ${tvlChange > 0 ? '+' : ''}${tvlChange.toFixed(2)}%\n`;
          }
          if (tvlCostChangePercent !== null) {
            section += `    - TVL Cost Change: ${tvlCostChangePercent > 0 ? '+' : ''}${tvlCostChangePercent.toFixed(2)}%\n`;
          }

          // Add volume WoW changes
          if (pool.volume && prevPool.volume) {
            const volumeChange = ((pool.volume - prevPool.volume) / prevPool.volume * 100);
            section += `    - Volume Change: ${volumeChange > 0 ? '+' : ''}${volumeChange.toFixed(2)}%\n`;

            const currentPeriodDays = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
            const prevPeriodDays = Math.floor((new Date(prevEndDate).getTime() - new Date(prevStartDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;

            const currentVolumeCost = pool.volume && pool.incentivesUSD && pool.volume > 0
              ? ((pool.incentivesUSD / currentPeriodDays * 365) / pool.volume * 100)
              : null;
            const prevVolumeCost = prevPool.volume && prevPool.incentivesUSD && prevPool.volume > 0
              ? ((prevPool.incentivesUSD / prevPeriodDays * 365) / prevPool.volume * 100)
              : null;

            if (currentVolumeCost !== null && prevVolumeCost !== null && prevVolumeCost !== 0) {
              const volumeCostChangePercent = ((currentVolumeCost - prevVolumeCost) / prevVolumeCost) * 100;
              section += `    - Volume Cost Change: ${volumeCostChangePercent > 0 ? '+' : ''}${volumeCostChangePercent.toFixed(2)}%\n`;
            }
          }

          if (incentiveChange !== null && tvlChange !== null) {
            const expectedChange = ((1 + incentiveChange / 100) / (1 + tvlChange / 100) - 1) * 100;
            section += `    - Expected TVL Cost Change (mechanical): ${expectedChange > 0 ? '+' : ''}${expectedChange.toFixed(2)}%\n`;
            if (tvlCostChangePercent !== null) {
              const discrepancy = tvlCostChangePercent - expectedChange;
              section += `    - Discrepancy (actual vs expected): ${discrepancy > 0 ? '+' : ''}${discrepancy.toFixed(2)}pp\n`;
            }
          }
        } else {
          section += `  Previous Week: MISSING (WoW analysis not possible for this pool)\n`;
        }
      }
      section += `\n`;
    }
  }
  
  return section;
}

/**
 * Helper: Add Example Opportunities section
 */
async function addExampleOpportunitiesSection(allPools: PoolData[], allOpportunities?: any[]): Promise<string> {
  if (!allOpportunities || allOpportunities.length === 0) {
    return '';
  }
  
  let section = `\n## Example Opportunities from Other Protocols (Same Token Pairs)\n`;
  section += `**CRITICAL**: Use this section to find SPECIFIC competitor pools when analyzing WoW changes.\n`;
  section += `These are examples of other pools/markets on Monad with the same token pairs as pools you're analyzing.\n`;
  section += `**IMPORTANT**: Opportunities are grouped by type (LP Pools, Lending Markets, Borrowing). Only compare pools of the same type.\n\n`;
  
  const currentTokenPairs = new Set(allPools.map(p => p.tokenPair.toLowerCase()));
  
  // Group opportunities by token pair and type - OPTIMIZED: Single pass O(n) instead of O(n²)
  const opportunitiesByTokenPair: Record<string, {
    lp: any[];
    lending: any[];
    borrowing: any[];
    other: any[];
  }> = {};
  
  for (const opp of allOpportunities) {
    const oppText = `${opp.name || ''} ${opp.opportunityId || ''}`.toLowerCase();
    
    // Extract token pair with one regex match (using pre-compiled regex)
    const match = oppText.match(TOKEN_PAIR_REGEX_CASE_INSENSITIVE);
    const tokenPair = match ? `${match[1]}-${match[2]}`.toLowerCase() : null;
    
    // Only process if token pair matches current pools
    if (tokenPair && currentTokenPairs.has(tokenPair)) {
      if (!opportunitiesByTokenPair[tokenPair]) {
        opportunitiesByTokenPair[tokenPair] = { lp: [], lending: [], borrowing: [], other: [] };
      }
      
      // Classify type with simple contains check
      const oppType = oppText.includes('liquidity') || oppText.includes('pool') || oppText.includes('swap') ? 'lp' :
                      oppText.includes('borrow') ? 'borrowing' :
                      oppText.includes('supply') || oppText.includes('lend') || oppText.includes('deposit') ? 'lending' : 'other';
      
      opportunitiesByTokenPair[tokenPair][oppType].push(opp);
    }
  }
  
  // Show examples for each token pair
  for (const tokenPair of Array.from(currentTokenPairs).sort()) {
    const grouped = opportunitiesByTokenPair[tokenPair];
    if (!grouped) continue;
    
    const totalCount = grouped.lp.length + grouped.lending.length + grouped.borrowing.length + grouped.other.length;
    if (totalCount === 0) continue;
    
    section += `\n### ${tokenPair.toUpperCase()} Examples (${totalCount} total opportunities):\n`;
    
    // LP Pools
    if (grouped.lp.length > 0) {
      section += `\n**LP Pools** (${grouped.lp.length} pools) - Compare TVL Cost and APR:\n`;
      for (const opp of grouped.lp.slice(0, 10)) {
        const protocolId = opp.mainProtocolId || opp.protocol?.id || 'unknown';
        const oppName = opp.name || opp.opportunityId || 'Unknown';
        const oppAPR = opp.apr !== undefined ? parseFloat(String(opp.apr)) : null;
        const merklUrl = `https://app.merkl.xyz/chains/monad?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
        
        section += `- ${protocolId}: "${oppName}"${oppAPR !== null ? ` (APR: ${oppAPR.toFixed(2)}%)` : ''} [Merkl: ${merklUrl}]\n`;
      }
      if (grouped.lp.length > 10) {
        section += `  ... and ${grouped.lp.length - 10} more LP pools\n`;
      }
    }
    
    // Lending Markets
    if (grouped.lending.length > 0) {
      section += `\n**Lending Markets** (${grouped.lending.length} markets) - Compare APR only:\n`;
      for (const opp of grouped.lending.slice(0, 10)) {
        const protocolId = opp.mainProtocolId || opp.protocol?.id || 'unknown';
        const oppName = opp.name || opp.opportunityId || 'Unknown';
        const oppAPR = opp.apr !== undefined ? parseFloat(String(opp.apr)) : null;
        const merklUrl = `https://app.merkl.xyz/chains/monad?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
        
        section += `- ${protocolId}: "${oppName}"${oppAPR !== null ? ` (APR: ${oppAPR.toFixed(2)}%)` : ''} [Merkl: ${merklUrl}]\n`;
      }
      if (grouped.lending.length > 10) {
        section += `  ... and ${grouped.lending.length - 10} more lending markets\n`;
      }
    }
  }
  
  return section;
}

/**
 * Helper: Add campaigns section
 */
async function addCampaignsSection(allPools: PoolData[], allCampaigns?: any[], allOpportunities?: any[]): Promise<string> {
  if (!allCampaigns || allCampaigns.length === 0) {
    return '';
  }
  
  let section = `\n## All Active Campaigns on Monad (Competitive Context)\n`;
  section += `There are ${allCampaigns.length} total campaigns on Monad. This includes campaigns from protocols not in your selected list.\n`;
  section += `**CRITICAL**: When explaining WoW changes or TVL shifts, you MUST identify SPECIFIC competing campaigns from this list.\n`;
  section += `Do NOT just say "competitors" or "vampire campaigns" - name the specific protocol, funding protocol, and market.\n`;
  section += `\nUse this to:\n`;
  section += `- Identify SPECIFIC campaigns targeting the same assets/token pairs as pools with WoW increases\n`;
  section += `- Find campaigns with higher incentives or better TVL Cost that might have attracted TVL\n`;
  section += `- Identify new campaigns that started during the period\n`;
  section += `- Find campaigns that ended (explaining why TVL might have shifted)\n`;
  
  // Group campaigns by token pair
  const campaignsByTokenPair: Record<string, any[]> = {};
  const allTokenPairs = new Set(allPools.map(p => p.tokenPair.toLowerCase()));
  let unknownCount = 0;
  
  // Create opportunity ID to protocol ID map for faster lookup
  const opportunityProtocolMap: Record<string, string> = {};
  if (allOpportunities) {
    for (const opp of allOpportunities) {
      const oppId = opp.id || opp.opportunityId;
      const oppProtocolId = opp.mainProtocolId || opp.protocol?.id;
      if (oppId && oppProtocolId) {
        opportunityProtocolMap[String(oppId)] = oppProtocolId;
      }
    }
  }
  
  for (const campaign of allCampaigns) {
    // Try to get protocol ID from campaign first
    let protocolId = campaign.mainProtocolId || campaign.protocol?.id;
    
    // If not found, try to get from opportunity data
    if (!protocolId && campaign.opportunityId) {
      protocolId = opportunityProtocolMap[String(campaign.opportunityId)];
    }
    
    // Fallback to unknown
    if (!protocolId) {
      protocolId = 'unknown';
    }
    
    if (protocolId === 'unknown') {
      unknownCount++;
      continue;
    }
    
    const oppId = (campaign.opportunityId || '').toLowerCase();
    const match = oppId.match(TOKEN_PAIR_REGEX_CASE_INSENSITIVE);
    const tokenPair = match ? `${match[1]}-${match[2]}`.toLowerCase() : null;
    
    if (tokenPair && allTokenPairs.has(tokenPair)) {
      if (!campaignsByTokenPair[tokenPair]) {
        campaignsByTokenPair[tokenPair] = [];
      }
      
      const merklUrl = `https://app.merkl.xyz/chains/monad?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
      
      campaignsByTokenPair[tokenPair].push({
        protocolId,
        tokenPair,
        merklUrl,
      });
    }
  }
  
  const identifiableCampaigns = allCampaigns.length - unknownCount;
  
  section += `\n### Competing Campaigns by Token Pair:\n`;
  if (unknownCount > 0) {
    section += `**Note**: ${unknownCount} of ${allCampaigns.length} campaigns lack identifiable protocol data. Only ${identifiableCampaigns} campaigns with identifiable protocols are shown below.\n`;
    section += `**For competitor identification, prioritize the "Example Opportunities" section which has structured data with APRs.**\n\n`;
  }
  section += `**Use this to identify SPECIFIC competitor campaigns when explaining WoW changes (only if internal factors don't explain the change).**\n\n`;
  
  let hasIdentifiableCampaigns = false;
  for (const tokenPair of Array.from(allTokenPairs).sort()) {
    const campaigns = campaignsByTokenPair[tokenPair] || [];
    if (campaigns.length > 0) {
      hasIdentifiableCampaigns = true;
      section += `\n**${tokenPair.toUpperCase()}** (${campaigns.length} competing campaigns):\n`;
      for (const campaign of campaigns.slice(0, 15)) {
        section += `- ${campaign.protocolId}: ${tokenPair} [Merkl: ${campaign.merklUrl}]\n`;
      }
      if (campaigns.length > 15) {
        section += `  ... and ${campaigns.length - 15} more ${tokenPair} campaigns\n`;
      }
    }
  }
  
  if (!hasIdentifiableCampaigns) {
    section += `\n**No identifiable competing campaigns found for current token pairs.**\n`;
  }
  
  return section;
}

/**
 * Helper: Add all opportunities context
 */
async function addAllOpportunitiesContext(allOpportunities?: any[]): Promise<string> {
  if (!allOpportunities || allOpportunities.length === 0) {
    return '';
  }
  
  let section = `\n## All Pools/Markets on Monad (Full Competitive Landscape)\n`;
  section += `There are ${allOpportunities.length} total opportunities (pools/markets) on Monad.\n`;
  section += `This includes pools that DON'T have incentives. Use this to:\n`;
  section += `- Identify the full competitive set for each token pair\n`;
  section += `- Understand which pools are missing incentives (potential opportunities)\n`;
  section += `- See the complete market landscape beyond just incentivized pools\n`;
  
  // Group opportunities by protocol
  const opportunitiesByProtocol: Record<string, any[]> = {};
  for (const opp of allOpportunities) {
    const protocolId = opp.mainProtocolId || opp.protocol?.id || 'unknown';
    if (!opportunitiesByProtocol[protocolId]) {
      opportunitiesByProtocol[protocolId] = [];
    }
    opportunitiesByProtocol[protocolId].push(opp);
  }
  
  section += `\n### Opportunities by Protocol:\n`;
  for (const [protocolId, opportunities] of Object.entries(opportunitiesByProtocol)) {
    section += `- ${protocolId}: ${opportunities.length} pools/markets\n`;
  }
  section += `\n`;
  
  return section;
}

/**
 * Helper: Add analysis guidelines
 */
async function addAnalysisGuidelines(mode: AnalysisMode, canPerformWowAnalysis: boolean): Promise<string> {
  const isProtocolLevel = mode === 'protocol-level';
  
  let section = `\n## Analysis Guidelines - CRITICAL RULES\n\n`;
  
  if (isProtocolLevel) {
    section += `1. **Protocol-Level Efficiency Assessment**:\n`;
    section += `   - Is the average TVL Cost reasonable for the asset types they're incentivizing? (Compare against expected ranges in table above)\n`;
    section += `   - Are there pools with extremely high TVL Cost (>50% for MON pairs, >30% for stablecoins) that need attention? Note: MON pairs above 50% TVL Cost are inefficient (Uniswap MON-USDC benchmark ~50% APR).\n`;
    section += `   - Is the protocol spending efficiently across all pools? (Check max vs min TVL Cost spread)\n`;
    section += `   - **Asset Type Distribution**: What asset types does this protocol focus on? (MON pairs, stablecoins, BTC, LST, etc.)\n`;
    section += `   - **Pool Efficiency Spread**: If max TVL Cost is much higher than average, identify which pools are inefficient\n\n`;
  } else {
    section += `1. **Asset Class Comparison Only**:\n`;
    section += `   - ONLY compare pools within the same asset type (see table above for expected ranges)\n`;
    section += `   - NEVER compare across asset types (e.g., MON pools vs BTC pools, LST pools vs stablecoin pools)\n`;
    section += `   - Different asset classes have different risk profiles and expected yields - comparing them is meaningless\n`;
    section += `   - **IMPORTANT**: Commodity pools (e.g., AUSD-XAUt0 where XAUt0 is gold) are NOT the same as stablecoin pools (e.g., AUSD-USDT0). Do NOT compare them.\n\n`;
    
    section += `2. **Efficiency Assessment Using Expected Ranges**:\n`;
    section += `   - Compare each pool's TVL Cost against the expected range for its asset type (see table above)\n`;
    section += `   - Flag pools exceeding expected range by >30% as high priority issues\n`;
    section += `   - Within the same asset class, pools with the same token pairs should have similar TVL Costs\n`;
    section += `   - Flag when TVL Cost differs by >20% between pools with same token pair and asset type\n`;
    section += `   - Use Uniswap pools as baseline within each asset class\n\n`;
  }
  
  section += `${isProtocolLevel ? '2' : '3'}. **WoW Trend Analysis - CRITICAL: Aggregate vs Pool-Level Analysis**:\n`;
  section += `   ${canPerformWowAnalysis ? '' : '**⚠️ WARNING: Previous week data is missing. WoW analysis CANNOT be performed.**'}\n`;
  section += `   \n`;
  section += `   **CRITICAL RULE**: You MUST analyze BOTH ${isProtocolLevel ? 'aggregate protocol metrics AND' : ''} individual pool-level changes.\n`;
  if (isProtocolLevel) {
    section += `   - Protocol-level aggregate metrics (average TVL Cost, total TVL) show overall trends BUT can mask individual pool inefficiencies\n`;
    section += `   - If protocol average TVL Cost increased 8% but individual pools increased 25%, the aggregate masks critical issues\n`;
    section += `   - Always break down: "Which specific pools drove the aggregate change?"\n`;
    section += `   - Reference individual pool data provided in "All Pools" section for each protocol\n`;
    section += `   - Example: "Protocol average TVL Cost rose 8%, but MON-USDC pool increased 25% while stablecoin pools decreased 5%. The aggregate masks the MON pair inefficiency."\n`;
  }
  section += `   \n`;
  section += `   **STEP 1: Check Internal Math (Incentive Efficiency & TVL Retention)**\n`;
  section += `   - ${isProtocolLevel ? 'For protocol aggregate: Calculate expected TVL Cost change = (1 + incentive_change%) / (1 + tvl_change%) - 1' : 'Calculate incentive change: (Current incentives - Previous incentives) / Previous incentives × 100'}\n`;
  section += `   - ${isProtocolLevel ? 'For individual pools: Calculate expected change for each pool with significant WoW change (>20% or <-20%)' : 'Calculate TVL change: (Current TVL - Previous TVL) / Previous TVL × 100'}\n`;
  section += `   - Compare expected vs actual WoW change:\n`;
  section += `     * If difference < 5%: Internal factors fully explain (high confidence)\n`;
  section += `     * If difference 5-15%: Internal factors partially explain (medium confidence)\n`;
  section += `     * If difference > 15%: External factors likely involved (check competitors)\n`;
  section += `   \n`;
  section += `   **IMPORTANT - Correct Interpretation**:\n`;
  section += `   - If TVL drops significantly and incentives stay flat → Expected TVL Cost INCREASES (cost per TVL unit goes up)\n`;
  section += `   - If expected increase is +40% but actual is only +8% → TVL Cost increased LESS than expected (efficiency improved OR competitors stole TVL)\n`;
  section += `   - If expected increase is +10% but actual is +25% → TVL Cost increased MORE than expected (external factors like competitors)\n`;
  section += `   - Always ask: "Where did the TVL go?" if TVL dropped significantly\n`;
  section += `   \n`;
  section += `   **STEP 2: Only If Internal Factors Don't Explain, Look for Competitors**\n`;
  section += `   - If incentives stayed similar (±10%) but TVL dropped → Check competitor campaigns\n`;
  section += `   - If mechanical change doesn't match actual change (>15% discrepancy) → Investigate competitors\n`;
  section += `   - **CRITICAL**: You MUST cite SPECIFIC competitor pools from "Example Opportunities" section, NOT generic protocol names\n`;
  section += `   - For each pool with unexplained WoW change, find competitors with:\n`;
  section += `     * Same token pair (e.g., MON-USDC)\n`;
  section += `     * Higher APR (if available)\n`;
  section += `     * Include in competitorLinks array with protocol name, APR, and Merkl URL\n`;
  
  if (isProtocolLevel) {
    section += `\n${isProtocolLevel ? '4' : '3'}. **Pool-Level WoW Analysis - CRITICAL REQUIREMENT**:\n`;
    section += `   **YOU MUST analyze EACH INDIVIDUAL POOL's WoW change, not just aggregate metrics.**\n`;
    section += `   \n`;
    section += `   **For EACH pool listed in "All Pools" section:**\n`;
    section += `   - If pool has previous week data AND TVL Cost WoW Change is provided:\n`;
    section += `     1. **Calculate expected change**: Use the formula: (1 + incentive_change%) / (1 + tvl_change%) - 1\n`;
    section += `     2. **Compare expected vs actual**: Calculate discrepancy = actual_change - expected_change\n`;
    section += `     3. **If discrepancy >15%**: This indicates external factors (competitors)\n`;
    section += `     4. **Find competitors**: Look in "Example Opportunities from Other Protocols" section for pools with:\n`;
    section += `        * Same token pair (e.g., if analyzing MON-USDC, find other MON-USDC pools)\n`;
    section += `        * Higher APR (if available)\n`;
    section += `        * Include in competitorLinks array with protocol name, market name, APR, Merkl URL\n`;
    section += `     5. **Populate poolLevelWowAnalysis array**: Create an entry for THIS SPECIFIC POOL with:\n`;
    section += `        * poolName: Full market name\n`;
    section += `        * tokenPair: Extracted token pair\n`;
    section += `        * expectedChange: Calculated expected change\n`;
    section += `        * actualChange: Actual TVL Cost WoW change from data\n`;
    section += `        * discrepancy: Difference between actual and expected\n`;
    section += `        * explanation: Full explanation including mechanical math and competitor analysis\n`;
    section += `        * competitorLinks: Array of specific competitor pools (NOT empty!)\n`;
    section += `        * confidence: high/medium/low based on data availability and discrepancy\n`;
    section += `   \n`;
    section += `   **CRITICAL**: Do NOT just analyze aggregate protocol metrics. You MUST create a poolLevelWowAnalysis entry for EACH pool with significant WoW change (>20% or <-20%) AND previous week data available.\n`;
    section += `   \n`;
    section += `   **Example Entry Format**:\n`;
    section += `   poolName: "UniswapV4 MON-USDC 0.05%"\n`;
    section += `   tokenPair: "MON-USDC"\n`;
    section += `   expectedChange: 10.4\n`;
    section += `   actualChange: 24.69\n`;
    section += `   discrepancy: 14.29\n`;
    section += `   explanation: "Expected +10.4% TVL Cost from +0.4% incentives and -9.1% TVL (mechanical: (1.004/0.909 - 1) * 100). Actual +24.69% indicates external factors. The 14.29pp discrepancy exceeds 15% threshold, suggesting competitors attracted TVL."\n`;
    section += `   competitorLinks: Array with entries like:\n`;
    section += `     - protocol: "clober"\n`;
    section += `     - marketName: "Provide liquidity to Clober MON-USDC"\n`;
    section += `     - merklUrl: "https://app.merkl.xyz/chains/monad?search=clober&status=LIVE%2CSOON%2CPAST"\n`;
    section += `     - apr: 85.89\n`;
    section += `     - reason: "63% higher APR than Uniswap (85.89% vs 52.64%) - likely attracted TVL"\n`;
    section += `     - dataQualityWarning: "Cannot verify if Clober pool size is comparable - high APR may indicate small pool"\n`;
    section += `   confidence: "medium"\n`;
    section += `   \n`;
    section += `   **If pool has no previous week data**: Skip it (cannot perform WoW analysis)\n`;
    section += `   **If pool has previous week data but WoW change <20%**: Still analyze if discrepancy >15% (indicates external factors)\n`;
    section += `   \n`;
    section += `   **DO NOT** create a single "Aggregate Protocol" entry. Create individual entries for each pool.\n\n`;
  }
  
  section += `\n${isProtocolLevel ? '3' : '4'}. **Competitive Context - CRITICAL: Specific Competitor Identification**:\n`;
  section += `   - **DO NOT** use generic statements like "investigate curvance" or "check competitors"\n`;
  section += `   - **MUST** cite SPECIFIC competitor pools from "Example Opportunities" section with:\n`;
  section += `     * Protocol name (e.g., "Clober")\n`;
  section += `     * Market name/token pair (e.g., "MON-USDC")\n`;
  section += `     * APR if available (e.g., "85.89% APR")\n`;
  section += `     * Merkl URL for verification\n`;
  section += `   - Example ACCEPTABLE: "Clober MON-USDC offers 85.89% APR vs Uniswap's 52.64% (63% higher). Likely TVL migrated to this higher-APR pool."\n`;
  section += `   - Example NOT ACCEPTABLE: "Investigate competitor pools (curvance:31 pools, pancake-swap:21)"\n`;
  section += `   \n`;
  section += `   **Competitor Data Quality Warnings - REQUIRED**:\n`;
  section += `   - If competitor APR differs by >50% from analyzed pool: MUST include warning: "Competitor APR may reflect low TVL or data quality issues. Verify pool size before concluding TVL was stolen."\n`;
  section += `   - If competitor APR differs by 30-50%: MUST note: "Significant APR gap - investigate if competitor pool has comparable TVL or if high APR is due to small size"\n`;
  section += `   - If competitor APR differs by <30%: "Moderate APR difference - likely competitive pressure"\n`;
  section += `   - If competitor TVL data unavailable: MUST note: "Cannot verify if competitor APR is from large or small pool"\n`;
  section += `   - If competitor incentives unavailable: MUST note: "Cannot compare incentive efficiency directly"\n`;
  
  if (!isProtocolLevel) {
    section += `\n5. **Volume Cost Analysis** - CRITICAL FOR DEX POOLS:\n`;
    section += `   **IMPORTANT**: Volume data is fetched from Dune Analytics on a per-pool basis for Uniswap and other DEX protocols.\n`;
    section += `   **When volume data is available (not N/A), you MUST analyze it thoroughly.**\n`;
    section += `   \n`;
    section += `   **Volume Cost Calculation**:\n`;
    section += `   - **Volume Cost** = (Incentives annualized / Volume) × 100\n`;
    section += `   - This measures cost per dollar of trading volume - lower is significantly better than TVL Cost\n`;
    section += `   - For DEX pools, Volume Cost is often more important than TVL Cost because:\n`;
    section += `     * It measures actual trading activity, not passive liquidity\n`;
    section += `     * Lower Volume Cost = more efficient incentive spend per dollar of trading\n`;
    section += `     * High TVL with low volume = inefficient farming (bad)\n`;
    section += `     * Moderate TVL with high volume = efficient trading (good)\n`;
    section += `   \n`;
    section += `   **Analysis Requirements When Volume Data Exists**:\n`;
    section += `   - Include Volume Cost in your Key Findings section\n`;
    section += `   - Compare Volume Cost across pools (typical good range: 1-5% for major pairs, 5-15% for exotic pairs)\n`;
    section += `   - **CRITICAL: Create separate volumeCostWowExplanations array entries** for pools with volume data and Volume Cost WoW Change\n`;
    section += `   - **For each pool with volume data**, populate volumeCostWowExplanations with:\n`;
    section += `     * poolId: Same format as wowExplanations\n`;
    section += `     * change: Volume Cost WoW Change percentage\n`;
    section += `     * mechanicalChange: Expected change based on volume and incentive changes\n`;
    section += `     * mechanicalExplanation: Formula explanation for Volume Cost (not TVL Cost)\n`;
    section += `     * discrepancy: Difference between actual and expected Volume Cost change\n`;
    section += `     * explanation: Detailed analysis explaining Volume Cost changes using VOLUME amounts (not TVL), trading activity, and efficiency implications. Use professional, objective language.\n`;
    section += `     * likelyCause: volume_growth|volume_decline|incentive_change|other\n`;
    section += `     * confidence: high|medium|low\n`;
    section += `     * competitorLinks: Array (usually empty for volume changes unless competitor volume data available)\n`;
    section += `   - **IMPORTANT**: Volume Cost explanations must focus on VOLUME and TRADING ACTIVITY, not TVL. Use dollar amounts for volume (e.g., "$37.7M volume" not "$3.96M TVL").\n`;
    section += `   - If Volume Cost WoW Change differs from TVL Cost WoW Change (>10% difference), explain why:\n`;
    section += `     * Volume increased faster than TVL → Volume Cost decreased (good efficiency - more trading per dollar of TVL)\n`;
    section += `     * Volume decreased faster than TVL → Volume Cost increased (worse efficiency - farming without trading)\n`;
    section += `     * Volume and TVL moved together → Volume Cost change similar to TVL Cost change (proportional relationship)\n`;
    section += `   \n`;
    section += `   **When to Flag Volume Issues**:\n`;
    section += `   - Volume Cost > 10%: Flag as "HIGH" efficiency issue (spending too much per dollar of trading)\n`;
    section += `   - Volume Cost increased WoW while TVL Cost decreased: Flag as concern (TVL growing but trading declining)\n`;
    section += `   - Volume decreased significantly (>20%) while TVL stable: Flag as "MEDIUM" - pool becoming less active\n`;
    section += `   \n`;
    section += `   **Data Quality Notes**:\n`;
    section += `   - If volume is N/A for a pool, note it but don't penalize the analysis\n`;
    section += `   - If volume appears identical across multiple pools, note potential aggregation issue\n`;
    section += `   - When pool-specific volume IS available (from Dune), trust it and analyze it fully\n`;
  }
  
  section += `\n## CRITICAL: Where to Find Competitor Data\n\n`;
  section += `**For competitor identification, you MUST use the "Example Opportunities from Other Protocols" section** (if provided in the prompt).\n\n`;
  section += `This section lists pools/markets from other protocols with the same token pairs as pools you're analyzing. It includes:\n`;
  section += `- Protocol name\n`;
  section += `- Market name\n`;
  section += `- APR (if available)\n`;
  section += `- Merkl URL\n\n`;
  section += `**Example**: If analyzing "UniswapV4 MON-USDC 0.05%", look in "Example Opportunities" for other MON-USDC pools like:\n`;
  section += `- Clober MON-USDC (85.89% APR)\n`;
  section += `- Kuru MON-USDC (65.66% APR)\n`;
  section += `- PancakeSwap WMON-USDC (60.96% APR)\n\n`;
  section += `**When populating competitorLinks**:\n`;
  section += `1. Find pools with the SAME token pair from "Example Opportunities"\n`;
  section += `2. Compare their APR to the analyzed pool's APR\n`;
  section += `3. If competitor APR is significantly higher (>30%), include it in competitorLinks\n`;
  section += `4. Include data quality warnings if APR differs by >30% (may indicate small pool size)\n\n`;
  section += `**DO NOT** leave competitorLinks empty if competitors exist in "Example Opportunities" section. You MUST cite specific competitor pools.\n`;
  
  section += `\n6. **Writing Style & Tone Guidelines - CRITICAL**:\n`;
  section += `   - **Tone**: Institutional, professional, and objective. Write like a senior DeFi analyst at a major firm.\n`;
  section += `   - **Avoid Hyperbole**: DO NOT use dramatic words like "catastrophic", "plunge", "shines", "evaporation", "boom", or "crisis".\n`;
  section += `   - **Use Neutral Terminology**: Instead of "plunge", use "significant decrease". Instead of "shines", use "demonstrates high efficiency".\n`;
  section += `   - **Precision**: Use absolute numbers to contextualize percentages. (e.g., "TVL decreased by 20% (-$990K) from $4.95M to $3.96M").\n`;
  section += `   - **Causal Analysis**: Focus on *cause and effect*. Connect the incentive change to the TVL behavior logically. (e.g., "Despite the high APR, capital outflow continued, suggesting the incentives are attracting mercenary capital rather than sticky liquidity.")\n`;
  
  return section;
}

/**
 * Helper: Add output format section
 */
async function addOutputFormat(mode: AnalysisMode): Promise<string> {
  const isProtocolLevel = mode === 'protocol-level';
  
  let section = `\n## Output Format\n\n`;
  
  if (isProtocolLevel) {
    section += `Provide your analysis as JSON with this structure:\n`;
    section += `{\n`;
    section += `  "protocolRecommendations": [\n`;
    section += `    {\n`;
    section += `      "protocol": "protocol-name",\n`;
    section += `      "summary": "2-3 sentence overview of protocol's efficiency status",\n`;
    section += `      "efficiencyScore": "high|medium|low",\n`;
    section += `      "keyIssues": ["Issue 1: description", "Issue 2: description"],\n`;
    section += `      "topActionItems": [\n`;
    section += `        {\n`;
    section += `          "priority": "critical|high|medium|low",\n`;
    section += `          "action": "Specific actionable recommendation",\n`;
    section += `          "rationale": "Why this action is needed",\n`;
    section += `          "expectedImpact": "What outcome to expect"\n`;
    section += `        }\n`;
    section += `      ],\n`;
    section += `      "incentiveRecommendation": "increase|decrease|maintain|optimize",\n`;
    section += `      "incentiveChangeAmount": "X% or specific MON amount",\n`;
    section += `      "marketingRecommendation": "yes|no|conditional",\n`;
    section += `      "marketingRationale": "Why marketing focus is/isn't needed",\n`;
    section += `      "competitiveThreats": [\n`;
    section += `        {\n`;
    section += `          "competitor": "protocol-name",\n`;
    section += `          "marketName": "specific market/pool name (e.g., MON-USDC)",\n`;
    section += `          "apr": 85.89,\n`;
    section += `          "merklUrl": "https://app.merkl.xyz/chains/monad?search=...",\n`;
    section += `          "threat": "description of competitive pressure",\n`;
    section += `          "dataQualityWarning": "Competitor APR may reflect low TVL - verify pool size"\n`;
    section += `        }\n`;
    section += `      ],\n`;
    section += `      "poolLevelWowAnalysis": [\n`;
    section += `        {\n`;
    section += `          "poolName": "specific pool name (e.g., UniswapV4 MON-USDC 0.05%)",\n`;
    section += `          "tokenPair": "MON-USDC",\n`;
    section += `          "expectedChange": 10.4,\n`;
    section += `          "actualChange": 24.69,\n`;
    section += `          "discrepancy": 14.3,\n`;
    section += `          "explanation": "Expected +10.4% from +0.4% incentives and -9.1% TVL (mechanical: (1.004/0.909 - 1) * 100). Actual +24.69% indicates external factors. The 14.3pp discrepancy exceeds 15% threshold, suggesting competitors attracted TVL.",\n`;
    section += `          "competitorLinks": [\n`;
    section += `            {\n`;
    section += `              "protocol": "clober",\n`;
    section += `              "marketName": "Provide liquidity to Clober MON-USDC",\n`;
    section += `              "apr": 85.89,\n`;
    section += `              "merklUrl": "https://app.merkl.xyz/chains/monad?search=clober&status=LIVE%2CSOON%2CPAST",\n`;
    section += `              "reason": "63% higher APR than analyzed pool (85.89% vs 52.64%) - likely attracted TVL",\n`;
    section += `              "dataQualityWarning": "Cannot verify if Clober pool size is comparable - high APR may indicate small pool"\n`;
    section += `            }\n`;
    section += `          ],\n`;
    section += `          "confidence": "medium"\n`;
    section += `        }\n`;
    section += `        // ... MORE ENTRIES FOR EACH POOL WITH SIGNIFICANT WoW CHANGE ...\n`;
    section += `        // DO NOT create a single "Aggregate Protocol" entry - create individual entries for each pool\n`;
    section += `      ]\n`;
    section += `    }\n`;
    section += `  ],\n`;
    section += `  "crossProtocolInsights": ["Insight 1: comparison across protocols", "Insight 2: overall trends"]\n`;
    section += `}\n`;
  } else {
    section += `Format your response as JSON with this structure:\n`;
    section += `{\n`;
    section += `  "dataQuality": {\n`;
    section += `    "canPerformWowAnalysis": true/false,\n`;
    section += `    "missingFields": ["previousIncentives", "previousTvl"],\n`;
    section += `    "competitorDataCompleteness": 1.2,\n`;
    section += `    "notes": "WoW analysis available for pools with previous data."\n`;
    section += `  },\n`;
    section += `  "keyFindings": ["finding1", "finding2", ...],\n`;
    section += `  "efficiencyIssues": [\n`;
    section += `    {\n`;
    section += `      "poolId": "protocol-fundingProtocol-marketName",\n`;
    section += `      "assetType": "mon-related",\n`;
    section += `      "tvlCost": 75.88,\n`;
    section += `      "expectedRange": [20, 50],\n`;
    section += `      "status": "above_range",\n`;
    section += `      "issue": "TVL Cost 26.5% above expected range maximum despite being L1-native token pair. TVL dropped 20% ($990K loss) from $4.95M to $3.96M while incentives remained stable (-0.4%), indicating poor TVL retention. Despite a high 73.39% APR, the pool failed to retain capital, suggesting structural issues or competitive pressure.",\n`;
    section += `      "severity": "high",\n`;
    section += `      "recommendation": "Reduce incentives by 20-25% to bring TVL Cost below 50% threshold. Compare with competitors: PancakeSwap WMON-USDC has 12.70% TVL Cost (vs current 75.88%), Uniswap MON-USDC ~50% APR benchmark. Current 73.39% APR vs competitor 60-85% APR range suggests over-incentivization. TVL migration likely to lower-cost competitors.",\n`;
    section += `      "analysisConfidence": "high"\n`;
    section += `    }\n`;
    section += `  ],\n`;
    section += `  "wowExplanations": [\n`;
    section += `    {\n`;
    section += `      "poolId": "protocol-fundingProtocol-marketName",\n`;
    section += `      "change": 24.69,\n`;
    section += `      "mechanicalChange": 24.4,\n`;
    section += `      "mechanicalExplanation": "Expected change from -0.4% incentives and -20% TVL: (0.996/0.80 - 1) ≈ +24.5%.",\n`;
    section += `      "discrepancy": 0.29,\n`;
    section += `      "explanation": "TVL Cost increased 24.69% due to significant TVL decrease ($4.95M to $3.96M, -20%) while incentives remained stable (-0.4%). Mechanical expected change of +24.4% matches actual change within 0.3%, indicating internal inefficiency rather than external competitor pressure. The $990K TVL outflow occurred despite 73.39% APR, suggesting capital migration driven by structural factors or superior opportunities elsewhere.",\n`;
    section += `      "likelyCause": "tvl_shift",\n`;
    section += `      "confidence": "high",\n`;
    section += `      "competitorLinks": []\n`;
    section += `    }\n`;
    section += `  ],\n`;
    section += `  "volumeCostWowExplanations": [\n`;
    section += `    {\n`;
    section += `      "poolId": "protocol-fundingProtocol-marketName",\n`;
    section += `      "change": -20.16,\n`;
    section += `      "mechanicalChange": -18.2,\n`;
    section += `      "mechanicalExplanation": "Expected Volume Cost change from +22% volume growth and stable incentives: (1.0/1.22 - 1) ≈ -18.0%.",\n`;
    section += `      "discrepancy": -2.16,\n`;
    section += `      "explanation": "Volume Cost decreased 20.16% due to volume growth ($30.9M to $37.7M, +22%) while incentives remained stable. Trading activity increased, improving efficiency. The mechanical expected decrease of -18.2% closely matches the actual -20.16% change, indicating volume-driven efficiency gains rather than incentive changes.",\n`;
    section += `      "likelyCause": "volume_growth",\n`;
    section += `      "confidence": "high",\n`;
    section += `      "competitorLinks": []\n`;
    section += `    }\n`;
    section += `  ],\n`;
    section += `  "recommendations": ["recommendation1", "recommendation2", ...]\n`;
    section += `}\n`;
  }
  
  section += `\n## Important Notes - CRITICAL REQUIREMENTS\n\n`;
  section += `**1. Aggregate vs Pool-Level Analysis**:\n`;
  section += `- You MUST analyze BOTH ${isProtocolLevel ? 'protocol-level aggregates AND' : ''} individual pool-level changes\n`;
  if (isProtocolLevel) {
    section += `- If aggregate shows 8% increase but individual pools show 25% increases, break down which pools drove the change\n`;
  }
  section += `- Always reference specific pool names from ${isProtocolLevel ? '"All Pools" section' : 'pool data section'}\n\n`;
  
  section += `**2. Competitor Identification - NOT ACCEPTABLE**:\n`;
  section += `- ❌ "Investigate competitor pools (curvance:31 pools)"\n`;
  section += `- ❌ "Check competitors in same asset class"\n`;
  section += `- ❌ Generic protocol names without specific pools\n\n`;
  
  section += `**3. Competitor Identification - REQUIRED**:\n`;
  section += `- ✅ "Clober MON-USDC offers 85.89% APR vs Uniswap's 52.64% (63% higher). Likely TVL migrated to this pool."\n`;
  section += `- ✅ Include protocol name, market name, APR, Merkl URL, and data quality warnings\n`;
  section += `- ✅ Populate competitorLinks array with specific competitor pools\n\n`;
  
  section += `**4. Data Quality Warnings - REQUIRED**:\n`;
  section += `- If competitor APR differs by >30%, MUST include data quality warning\n`;
  section += `- If competitor TVL unavailable, MUST note "Cannot verify pool size"\n`;
  section += `- Never assume competitor APR reflects efficiency without verifying pool size\n\n`;
  
  section += `**5. Expected vs Actual Change Interpretation**:\n`;
  section += `- If TVL drops and incentives stay flat → Expected TVL Cost INCREASES (cost per TVL unit goes up)\n`;
  section += `- If expected +40% but actual +8% → TVL Cost increased LESS than expected (efficiency improved OR competitors stole TVL)\n`;
  section += `- If expected +10% but actual +25% → TVL Cost increased MORE than expected (external factors like competitors)\n`;
  section += `- Always ask: "Where did the TVL go?" if TVL dropped significantly\n\n`;
  
  section += `**6. Analysis Depth Requirements**:\n`;
  section += `- **keyFindings**: Provide 5-8 high-level findings that summarize the most important trends\n`;
  section += `- **efficiencyIssues**: Analyze ALL pools in the pool data section and generate recommendations for each one\n`;
  section += `  * For pools with issues: Prioritize by severity (critical > high > medium > low)\n`;
  section += `  * For pools within expected range: Still provide recommendations (e.g., "Maintain current incentives", "Monitor for changes", "No action needed")\n`;
  section += `  * Include pools above expected range AND pools significantly below (potential under-incentivization)\n`;
  section += `  * **CRITICAL**: Every pool in the pool data section MUST have an entry in efficiencyIssues with a recommendation\n`;
  section += `- **wowExplanations**: Analyze 15-20 pools with the most significant WoW changes\n`;
  section += `  * Prioritize: |change| > 50%, then |change| > 30%, then |change| > 15%\n`;
  section += `  * SKIP pools with -5% < change < +5% (neutral/boring changes)\n`;
  section += `  * Focus on pools where something interesting happened (large changes, unexpected discrepancies)\n`;
  section += `- **volumeCostWowExplanations**: Analyze 10-15 DEX pools with significant volume changes\n`;
  section += `  * Prioritize: |volume change| > 40%, then |volume change| > 25%\n`;
  section += `  * SKIP pools with -10% < volume change < +10%\n`;
  section += `- **recommendations**: Provide 5-8 actionable recommendations based on findings\n\n`;

  section += `**7. General Requirements**:\n`;
  section += `- Be specific with numbers (incentive amounts, TVL Cost percentages, change amounts)\n`;
  section += `- Prioritize recommendations by impact (critical issues first)\n`;
  section += `- Consider both efficiency (TVL Cost) and effectiveness (TVL growth)\n`;
  section += `- Provide actionable guidance, not just observations\n`;
  section += `- Include confidence levels for each analysis (high/medium/low)\n\n`;
  
  section += `**8. CRITICAL: Competitor Comparisons in Recommendations**\n`;
  section += `- **ALWAYS compare pools with competitors** when generating recommendations in efficiencyIssues\n`;
  section += `- **Compare similar token pairs**: WMON-USDC can be compared with WMON-AUSD, WMON-USDT, MON-USDC, etc.\n`;
  section += `- **Compare same protocol types**: DEX pools (Uniswap, PancakeSwap) vs DEX pools; Lending (Townsquare, Morpho) vs Lending\n`;
  section += `- **Required competitor data in recommendations**:\n`;
  section += `  * Current pool APR vs competitor APR (e.g., "Current 73.39% APR vs PancakeSwap 60.96% APR")\n`;
  section += `  * Current pool TVL Cost vs competitor TVL Cost (e.g., "TVL Cost 75.88% vs PancakeSwap 12.70%")\n`;
  section += `  * Explain why pool is inefficient relative to competitors\n`;
  section += `  * Reference specific competitor pools from "Example Opportunities" section\n`;
  section += `- **When competitor data is available**: Include it in the recommendation\n`;
  section += `- **When no direct competitors exist**: Note this and explain based on expected ranges\n`;
  section += `- **Example format**: "Reduce incentives 20-25%. Compare: Current 75.88% TVL Cost vs PancakeSwap WMON-USDC 12.70% (same token pair, DEX vs DEX). Current 73.39% APR vs competitor range 60-85% APR suggests over-incentivization."\n`;

  return section;
}

/**
 * Legacy function: Generate prompt for AI analysis (pool-level)
 * Wrapper that calls unified function
 */
async function generateAnalysisPrompt(request: AnalysisRequest, allCampaigns?: any[], allOpportunities?: any[]): Promise<string> {
  const { currentWeek, previousWeek } = request;
  
  return generateUnifiedAnalysisPrompt({
    mode: 'pool-level',
    startDate: currentWeek.startDate,
    endDate: currentWeek.endDate,
    prevStartDate: previousWeek?.startDate || '',
    prevEndDate: previousWeek?.endDate || '',
    monPrice: currentWeek.monPrice,
    pools: currentWeek.pools,
    previousPools: previousWeek?.pools,
  }, allCampaigns, allOpportunities);
}

/**
 * Legacy function: Generate protocol-level analysis prompt
 * Wrapper that calls unified function
 */
async function generateProtocolLevelPrompt(
  protocolData: any,
  allCampaigns?: any[],
  allOpportunities?: any[]
): Promise<string> {
  const { protocols, startDate, endDate, prevStartDate, prevEndDate, monPrice } = protocolData;
  
  return generateUnifiedAnalysisPrompt({
    mode: 'protocol-level',
    startDate,
    endDate,
    prevStartDate,
    prevEndDate,
    monPrice,
    protocols,
  }, allCampaigns, allOpportunities);
}


/**
 * Clean JSON text by removing common issues
 */
function cleanJSON(jsonText: string): string {
  // Remove markdown code block markers if still present
  let cleaned = jsonText.trim();
  
  // Remove leading/trailing markdown
  cleaned = cleaned.replace(/^```(?:json)?\s*/gm, '');
  cleaned = cleaned.replace(/\s*```$/gm, '');
  
  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Attempt to fix common JSON issues
 */
function attemptJSONFix(jsonText: string, parseError: any): string | null {
  let fixed = jsonText;
  const errorMessage = parseError.message || '';

  try {
    // Handle unterminated string errors specifically
    if (errorMessage.includes('Unterminated string')) {
      const position = extractErrorPosition(errorMessage);
      if (position !== null && position < fixed.length) {
        console.log(`Attempting to fix unterminated string at position ${position}`);

        // Try to find the last complete opening brace and truncate there
        let truncatePos = position;
        let braceCount = 0;
        let inString = false;
        let lastValidPos = 0;

        // Walk backwards to find a safe truncation point
        for (let i = position - 1; i >= 0; i--) {
          const char = fixed[i];

          if (char === '"' && (i === 0 || fixed[i - 1] !== '\\')) {
            inString = !inString;
          }

          if (!inString) {
            if (char === '}' || char === ']') {
              braceCount++;
            } else if (char === '{' || char === '[') {
              braceCount--;
              if (braceCount < 0) {
                lastValidPos = i;
                break;
              }
            }
          }
        }

        // Truncate at a safe point and try to close the JSON
        if (lastValidPos > 0) {
          fixed = fixed.substring(0, lastValidPos);
          // Try to close any open structures
          const openBraces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
          const openBrackets = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;

          // Remove trailing commas
          fixed = fixed.replace(/,\s*$/, '');

          // Close open structures
          fixed += '}'.repeat(Math.max(0, openBraces));
          fixed += ']'.repeat(Math.max(0, openBrackets));
        } else {
          // If we can't find a good truncation point, try closing the string
          fixed = fixed.substring(0, position) + '"' + fixed.substring(position);
        }
      }
    }

    // Try to fix trailing commas before closing braces/brackets
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

    // Try to fix unquoted keys (basic attempt - this is tricky)
    // Only fix if we can identify the pattern safely
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    return fixed;
  } catch (error) {
    console.warn('JSON fix attempt failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}

/**
 * Extract error position from parse error message
 */
function extractErrorPosition(errorMessage: string): number | null {
  const match = errorMessage.match(/position (\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Extract context around error position for debugging
 */
function extractContextAroundError(jsonText: string, parseError: any): string {
  const position = extractErrorPosition(parseError.message);
  if (position === null) return 'Unable to determine error position';

  const contextLength = 100;
  const start = Math.max(0, position - contextLength);
  const end = Math.min(jsonText.length, position + contextLength);

  const before = jsonText.substring(start, position);
  const after = jsonText.substring(position, end);

  return `...${before}<<<ERROR HERE>>>${after}...`;
}

/**
 * Call Grok (xAI) API for AI analysis
 */
async function callGrokAI(prompt: string): Promise<any> {
  const xaiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  
  if (!xaiKey) {
    throw new Error('XAI_API_KEY or GROK_API_KEY environment variable is required when using Grok.');
  }

  console.log('Calling Grok (xAI) API...');
  const response = await fetch(`${XAI_API_BASE}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${xaiKey}`,
    },
    body: JSON.stringify({
      model: ANALYSIS_CONFIG.models.grok,
      input: [
        {
          role: 'system',
          content: 'You are an expert DeFi analyst. Your writing style is professional, clinical, and precise. You avoid flowery, dramatic, or sensationalist language. You explain trends using specific dollar amounts and clear causal reasoning. CRITICAL: You MUST respond with valid, parseable JSON only. Do not include any markdown formatting, code blocks, or explanatory text outside the JSON. The response must be pure JSON that can be parsed directly.',
        },
        {
          role: 'user',
          content: prompt + '\n\nIMPORTANT:\n1. Respond with ONLY valid JSON. Do not wrap it in markdown code blocks or add any text before or after the JSON.\n2. Keep explanations concise but informative (2-3 sentences each).\n3. Ensure all JSON strings are properly closed before the response ends.',
        },
      ],
      max_tokens: 16384, // Increased token limit to prevent truncation
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grok API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  // Check if response was truncated due to token limit (Grok API specific field may vary)
  if (data.stop_reason === 'max_tokens' || data.finish_reason === 'length') {
    console.warn('⚠️ Grok response was truncated due to max_tokens limit. Response may be incomplete.');
  }

  // Grok response: data.output[0].content[0].text
  if (data.output?.[0]?.content?.[0]?.text) {
    let jsonText = data.output[0].content[0].text;
    const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) jsonText = jsonMatch[1];
    jsonText = cleanJSON(jsonText);

    try {
      return JSON.parse(jsonText);
    } catch (parseError: any) {
      console.error('Grok JSON parsing failed:', parseError.message);
      console.error('Problematic JSON (first 500 chars):', jsonText.substring(0, 500));
      console.error('Problematic JSON (around error position):', extractContextAroundError(jsonText, parseError));

      // Check if this looks like a truncation issue
      if (data.stop_reason === 'max_tokens' || data.finish_reason === 'length') {
        console.error('❌ Response was truncated at token limit - this is likely the cause of the parse error');
      }

      const fixedJson = attemptJSONFix(jsonText, parseError);
      if (fixedJson) {
        try {
          const parsed = JSON.parse(fixedJson);
          console.log('✅ Successfully recovered from JSON error using fix logic');
          return parsed;
        } catch (error) {
          console.warn('JSON parse retry failed:', error instanceof Error ? error.message : 'Unknown error');
        }
      }
      throw new Error(`Failed to parse Grok JSON: ${parseError.message}`);
    }
  }

  throw new Error('Unexpected Grok API response structure');
}

/**
 * Call Claude (Anthropic) API for AI analysis
 */
async function callClaudeAI(prompt: string): Promise<any> {
  const claudeKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  
  if (!claudeKey) {
    throw new Error('CLAUDE_API_KEY or ANTHROPIC_API_KEY environment variable is required when using Claude.');
  }

  console.log('Calling Claude (Anthropic) API...');
  const response = await fetch(`${CLAUDE_API_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANALYSIS_CONFIG.models.claude,
      max_tokens: 16384, // Increased from 4096 to prevent truncation of complex analysis
      messages: [
        {
          role: 'user',
          content: `You are an expert DeFi analyst specializing in incentive efficiency analysis. CRITICAL: You MUST respond with valid, parseable JSON only. Do not include any markdown formatting, code blocks, or explanatory text outside the JSON. The response must be pure JSON that can be parsed directly.

${prompt}

IMPORTANT:
1. Respond with ONLY valid JSON. Do not wrap it in markdown code blocks or add any text before or after the JSON.
2. Keep explanations concise but informative (2-3 sentences each).
3. Ensure all JSON strings are properly closed before the response ends.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();

  // Check if response was truncated due to token limit
  if (data.stop_reason === 'max_tokens') {
    console.warn('⚠️ Claude response was truncated due to max_tokens limit. Response may be incomplete.');
  }

  // Claude response: data.content[0].text
  if (data.content?.[0]?.text) {
    let jsonText = data.content[0].text;
    const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    if (jsonMatch) jsonText = jsonMatch[1];
    jsonText = cleanJSON(jsonText);

    try {
      return JSON.parse(jsonText);
    } catch (parseError: any) {
      console.error('Claude JSON parsing failed:', parseError.message);
      console.error('Problematic JSON (first 500 chars):', jsonText.substring(0, 500));
      console.error('Problematic JSON (around error position):', extractContextAroundError(jsonText, parseError));

      // Check if this looks like a truncation issue
      if (data.stop_reason === 'max_tokens') {
        console.error('❌ Response was truncated at token limit - this is likely the cause of the parse error');
      }

      const fixedJson = attemptJSONFix(jsonText, parseError);
      if (fixedJson) {
        try {
          const parsed = JSON.parse(fixedJson);
          console.log('✅ Successfully recovered from JSON error using fix logic');
          return parsed;
        } catch (error) {
          console.warn('JSON parse retry failed:', error instanceof Error ? error.message : 'Unknown error');
        }
      }
      throw new Error(`Failed to parse Claude JSON: ${parseError.message}`);
    }
  }

  throw new Error('Unexpected Claude API response structure');
}

/**
 * Unified AI API caller with retry logic - automatically selects provider based on AI_PROVIDER constant
 * Supports: 'grok' or 'claude'
 */
async function callAI(prompt: string, retries = 3): Promise<any> {
  // Use the constant defined at the top of the file
  const provider = AI_PROVIDER;

  console.log(`Using AI provider: ${provider}`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let result;
      if (provider === 'grok') {
        result = await callGrokAI(prompt);
      } else {
        result = await callClaudeAI(prompt);
      }

      // Validate the result has the expected structure
      if (!result || typeof result !== 'object') {
        throw new Error('Invalid AI response structure');
      }

      return result;
    } catch (error: any) {
      const errorMsg = error.message || 'Unknown error';
      console.error(`AI call attempt ${attempt}/${retries} failed:`, errorMsg);

      // If this is a JSON parsing error and we have retries left, try again
      if (errorMsg.includes('Failed to parse') && attempt < retries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff: 1s, 2s, 4s (max 5s)
        console.log(`Retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      // If this is the last attempt or a non-retryable error, throw it
      if (attempt === retries) {
        // Add more context to the error
        throw new Error(`AI analysis failed after ${retries} attempts: ${errorMsg}`);
      }
    }
  }

  throw new Error('AI analysis failed: Maximum retries exceeded');
}

// Old implementation removed - now using unified function via wrapper above

/**
 * Helper: Calculate TVL Cost from data
 */
function calculateTVLCostFromData(incentivesUSD: number, tvl: number, startDate: string, endDate: string): string {
  if (!tvl || tvl <= 0) return 'N/A';
  const periodDays = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const annualizedIncentives = (incentivesUSD / periodDays) * 365;
  const tvlCost = (annualizedIncentives / tvl) * 100;
  return `${tvlCost.toFixed(2)}%`;
}

export async function POST(request: NextRequest) {
  try {
    const body: any = await request.json();
    
    // Check if this is a bulk protocol analysis
    if (body.bulkAnalysis && body.protocolData) {
      const { protocolData, includeAllData } = body;
      const { allCampaigns, allOpportunities } = protocolData;

      // Generate protocol-level prompt
      const prompt = await generateProtocolLevelPrompt(protocolData, allCampaigns, allOpportunities);

      console.log('=== Protocol-Level AI Analysis Prompt ===');
      console.log(prompt.substring(0, 1000) + '...');
      console.log('=== End Prompt ===');

      // Call AI (Grok or Claude based on AI_PROVIDER constant)
      let analysis;
      try {
        analysis = await callAI(prompt);
      } catch (aiError: any) {
        console.error('AI call failed:', aiError);
        throw aiError;
      }

      return NextResponse.json({
        success: true,
        analysis,
        type: 'bulk-protocol-analysis',
      });
    }

    // Regular pool-level analysis
    const { currentWeek, previousWeek, includeAllData } = body;

    // Fetch all campaigns and opportunities if requested
    let allCampaigns: any[] | undefined;
    let allOpportunities: any[] | undefined;
    
    if (includeAllData) {
      allCampaigns = await fetchAllCampaignsOnMonad();
      allOpportunities = await fetchAllOpportunitiesOnMonad();
    }

    // Generate prompt
    const prompt = await generateAnalysisPrompt(
      { currentWeek, previousWeek },
      allCampaigns,
      allOpportunities
    );

    console.log('=== AI Analysis Prompt ===');
    console.log(prompt.substring(0, 1000) + '...');
    console.log('=== End Prompt ===');

      // Call AI (Grok or Claude based on AI_PROVIDER constant)
      let analysis;
      try {
        analysis = await callAI(prompt);
      } catch (aiError: any) {
        console.error('AI call failed:', aiError);
        throw aiError;
      }

    return NextResponse.json({
      success: true,
      analysis,
      type: 'pool-level-analysis',
    });
  } catch (error: any) {
    console.error('AI analysis error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to analyze data' },
      { status: 500 }
    );
  }
}
