import { NextRequest, NextResponse } from 'next/server';
import { 
  getCachedMerklCampaigns, 
  cacheMerklCampaigns,
  getCachedMerklOpportunities,
  cacheMerklOpportunities 
} from '@/app/lib/cache';

const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
const XAI_API_BASE = 'https://api.x.ai/v1';
const MERKL_API_BASE = 'https://api.merkl.xyz';
const MONAD_CHAIN_ID = 143;

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
 * Fetch all campaigns on Monad chain (with caching)
 */
async function fetchAllCampaignsOnMonad(): Promise<any[]> {
  const campaigns: any[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      // Check cache first
      const cached = await getCachedMerklCampaigns('all', page);
      if (cached && cached.length > 0) {
        console.log(`Cache hit for all campaigns page ${page}`);
        campaigns.push(...cached);
        if (cached.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
        continue;
      }

      // Cache miss - fetch from API
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
        // Cache the fetched campaigns
        await cacheMerklCampaigns('all', page, pageCampaigns);
        
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
 * Fetch all opportunities on Monad chain (with caching)
 */
async function fetchAllOpportunitiesOnMonad(): Promise<any[]> {
  const opportunities: any[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      // Check cache first
      const cached = await getCachedMerklOpportunities(page);
      if (cached && cached.length > 0) {
        console.log(`Cache hit for opportunities page ${page}`);
        opportunities.push(...cached);
        if (cached.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
        continue;
      }

      // Cache miss - fetch from API
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
        // Cache the fetched opportunities
        await cacheMerklOpportunities(page, pageOpportunities);
        
        if (pageOpportunities.length < 100) {
          hasMore = false;
        } else {
          page++;
        }
      }

      // Rate limiting (only for API calls, not cached)
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
  const match = marketName.match(/([A-Z0-9]+)-([A-Z0-9]+)/);
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
  const campaignsWithData = allCampaigns ? allCampaigns.filter(c => {
    const protocolId = c.mainProtocolId || c.protocol?.id || 'unknown';
    return protocolId !== 'unknown';
  }).length : 0;
  const campaignDataCompleteness = allCampaigns ? (campaignsWithData / allCampaigns.length * 100).toFixed(1) : '0';
  
  // Build prompt based on mode
  const taskDescription = mode === 'pool-level' 
    ? 'analyzing DeFi incentive efficiency on Monad chain. Your goal is to identify areas for improvement and explain efficiency changes.'
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
- **WoW Change**: Week-over-week percentage change in TVL Cost. Negative is better (cost decreased).
- **APR**: Annual Percentage Rate from Merkl incentives.

## Asset Classification & Expected Ranges
Pools are grouped by asset risk profile. **Only compare pools within the same asset type.**

| Asset Type | Definition | Expected TVL Cost Range |
|------------|------------|------------------------|
| **Stablecoin** | Both tokens are stablecoins (USDC/USDT/DAI/AUSD) | 5-15% |
| **Stablecoin-Derivative** | Stablecoin + yield-bearing stablecoin (AUSD-earnAUSD, USDC-sUSDC) | 8-18% |
| **MON Pairs** | Contains MON token (MON-USDC, MON-AUSD, MON-wBTC) - L1-native token pairs | 20-60% |
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
  prompt += await addCampaignsSection(allPools, allCampaigns);
  
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
        let wowChangeValue = pool.wowChange;
        if ((wowChangeValue === null || wowChangeValue === undefined) && prevPool && pool.tvlCost !== null && prevPool.tvlCost !== null && prevPool.tvlCost !== 0) {
          wowChangeValue = ((pool.tvlCost - prevPool.tvlCost) / prevPool.tvlCost) * 100;
        }
        if (wowChangeValue !== null && wowChangeValue !== undefined) {
          section += `  - TVL Cost WoW Change: ${wowChangeValue > 0 ? '+' : ''}${wowChangeValue.toFixed(2)}%\n`;
        } else if (prevPool) {
          section += `  - TVL Cost WoW Change: N/A (missing TVL Cost data)\n`;
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
    
    // Extract token pair with one regex match
    const match = oppText.match(/([a-z0-9]+)[-\/]([a-z0-9]+)/i);
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
async function addCampaignsSection(allPools: PoolData[], allCampaigns?: any[]): Promise<string> {
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
  
  for (const campaign of allCampaigns) {
    const protocolId = campaign.mainProtocolId || campaign.protocol?.id || 'unknown';
    
    if (protocolId === 'unknown') {
      unknownCount++;
      continue;
    }
    
    const oppId = (campaign.opportunityId || '').toLowerCase();
    const match = oppId.match(/([a-z0-9]+)[-\/]([a-z0-9]+)/i);
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
    section += `   - Are there pools with extremely high TVL Cost (>50% for MON pairs, >30% for stablecoins) that need attention?\n`;
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
    section += `\n5. **Volume Data Quality**:\n`;
    section += `   - If volume appears uniform across pools (same value), note that this may indicate data aggregation issues\n`;
    section += `   - Do not make conclusions based on unreliable volume data\n`;
    section += `   - Focus on TVL Cost analysis instead when volume data is suspect\n`;
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
    section += `      "assetType": "stablecoin|stablecoin-derivative|mon-related|btc-related|lst-related|commodity-related|other",\n`;
    section += `      "tvlCost": 14.03,\n`;
    section += `      "expectedRange": [8, 18],\n`;
    section += `      "status": "within_range|above_range|critical",\n`;
    section += `      "issue": "description of issue",\n`;
    section += `      "severity": "high|medium|low",\n`;
    section += `      "recommendation": "specific recommendation",\n`;
    section += `      "analysisConfidence": "high|medium|low"\n`;
    section += `    }\n`;
    section += `  ],\n`;
    section += `  "wowExplanations": [\n`;
    section += `    {\n`;
    section += `      "poolId": "protocol-fundingProtocol-marketName",\n`;
    section += `      "change": 15.5,\n`;
    section += `      "mechanicalChange": 9.1,\n`;
    section += `      "mechanicalExplanation": "Expected change from +6.7% incentives and -2.2% TVL: (1.067/0.978 - 1) ≈ +9.1%",\n`;
    section += `      "discrepancy": 6.4,\n`;
    section += `      "explanation": "full explanation including mechanical math and any additional factors",\n`;
    section += `      "likelyCause": "competitor_pools|tvl_shift|new_pools|incentive_change|other",\n`;
    section += `      "confidence": "high|medium|low",\n`;
    section += `      "competitorLinks": [\n`;
    section += `        {\n`;
    section += `          "protocol": "competitor protocol name",\n`;
    section += `          "marketName": "competitor market name",\n`;
    section += `          "merklUrl": "https://app.merkl.xyz/chains/monad?search=...",\n`;
    section += `          "apr": 45.5,\n`;
    section += `          "tvlCost": 12.3,\n`;
    section += `          "incentives": 350000,\n`;
    section += `          "reason": "why this competitor is relevant (e.g., lower TVL Cost, higher incentives, higher APR). Include data quality warnings if APR differs by >30%."\n`;
    section += `        }\n`;
    section += `      ]\n`;
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
  
  section += `**6. General Requirements**:\n`;
  section += `- Be specific with numbers (incentive amounts, TVL Cost percentages, change amounts)\n`;
  section += `- Prioritize recommendations by impact (critical issues first)\n`;
  section += `- Consider both efficiency (TVL Cost) and effectiveness (TVL growth)\n`;
  section += `- Provide actionable guidance, not just observations\n`;
  section += `- Include confidence levels for each analysis (high/medium/low)\n`;
  
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

// Remove old implementation - keeping for reference during transition
const _OLD_generateAnalysisPrompt = async (request: AnalysisRequest, allCampaigns?: any[], allOpportunities?: any[]): Promise<string> => {
  const { currentWeek, previousWeek } = request;
  const similarPools = groupSimilarPools(currentWeek.pools);
  
  // Calculate data quality metrics
  const hasPreviousWeek = !!previousWeek;
  const poolsWithPreviousData = currentWeek.pools.filter(pool => {
    if (!previousWeek) return false;
    return previousWeek.pools.some(prev => 
      prev.protocol === pool.protocol && 
      prev.fundingProtocol === pool.fundingProtocol && 
      prev.marketName === pool.marketName
    );
  }).length;
  const canPerformWowAnalysis = hasPreviousWeek && poolsWithPreviousData > 0;
  const poolsWithWowData = currentWeek.pools.filter(p => p.wowChange !== null).length;
  
  // Count campaigns with useful data (not "unknown")
  const campaignsWithData = allCampaigns ? allCampaigns.filter(c => {
    const protocolId = c.mainProtocolId || c.protocol?.id || 'unknown';
    return protocolId !== 'unknown';
  }).length : 0;
  const campaignDataCompleteness = allCampaigns ? (campaignsWithData / allCampaigns.length * 100).toFixed(1) : '0';

  let prompt = `You are analyzing DeFi incentive efficiency on Monad chain. Your goal is to identify areas for improvement and explain efficiency changes.

## Context
- **Current Period**: ${currentWeek.startDate} to ${currentWeek.endDate}
- **Previous Period**: ${previousWeek ? `${previousWeek.startDate} to ${previousWeek.endDate}` : 'Not available'}
- **MON Price**: ${currentWeek.monPrice ? `$${currentWeek.monPrice}` : 'Not provided'}

## Data Quality Assessment
${canPerformWowAnalysis ? '✅' : '❌'} **WoW Analysis**: ${canPerformWowAnalysis ? `Available for ${poolsWithWowData}/${currentWeek.pools.length} pools` : 'NOT AVAILABLE - Previous period data missing'}
${hasPreviousWeek ? '✅' : '❌'} **Previous Week Data**: ${hasPreviousWeek ? `Available for ${poolsWithPreviousData}/${currentWeek.pools.length} pools` : 'MISSING'}
${allCampaigns ? `⚠️ **Competitor Data**: ${campaignDataCompleteness}% of campaigns have identifiable protocol data (${campaignsWithData}/${allCampaigns.length} campaigns)` : '⚠️ **Competitor Data**: Not fetched'}
${currentWeek.pools.some(p => p.volume) ? '✅' : '⚠️'} **Volume Data**: ${currentWeek.pools.filter(p => p.volume).length}/${currentWeek.pools.length} pools have volume data

**Impact**: ${canPerformWowAnalysis ? 'WoW analysis can be performed for pools with previous data.' : 'WoW analysis CANNOT be performed - missing previous period data.'} ${allCampaigns && parseFloat(campaignDataCompleteness) < 50 ? 'Competitive analysis is severely limited due to missing campaign data.' : ''}

## Calculation Notes
- **TVL Cost WoW Change** = ((Current TVL Cost - Previous TVL Cost) / Previous TVL Cost) × 100
- **Expected Mechanical Change** = (1 + Incentive Change%) / (1 + TVL Change%) - 1
  * This estimates what TVL Cost change should be based purely on incentive/TVL math
  * If actual change differs by >15%, external factors (competitors, market conditions) are likely involved
  * Example: +6.7% incentives, -2.2% TVL → Expected: (1.067/0.978 - 1) ≈ +9.1% TVL Cost

## Key Metrics Explained
- **TVL Cost**: (Incentives annualized / TVL) × 100. This represents the APR being paid to attract TVL. Lower is better.
- **WoW Change**: Week-over-week percentage change in TVL Cost. Negative is better (cost decreased).
- **APR**: Annual Percentage Rate from Merkl incentives.

## Asset Classification & Expected Ranges
Pools are grouped by asset risk profile. **Only compare pools within the same asset type.**

| Asset Type | Definition | Expected TVL Cost Range |
|------------|------------|------------------------|
| **Stablecoin** | Both tokens are stablecoins (USDC/USDT/DAI/AUSD) | 5-15% |
| **Stablecoin-Derivative** | Stablecoin + yield-bearing stablecoin (AUSD-earnAUSD, USDC-sUSDC) | 8-18% |
| **MON Pairs** | Contains MON token (MON-USDC, MON-AUSD, MON-wBTC) - L1-native token pairs | 20-60% |
| **BTC Pairs** | Contains BTC (wBTC-USDC, wBTC-AUSD) | 10-25% |
| **LST Pairs** | Contains liquid staking tokens (stETH-ETH, rETH-USDC) | 8-20% |
| **Commodity** | Tokenized commodities (XAUt0-AUSD for gold) | 10-25% |

**Asset type is determined by the riskier/more volatile token in the pair.**

## Analysis Guidelines - CRITICAL RULES

1. **Asset Class Comparison Only**: 
   - ONLY compare pools within the same asset type (see table above for expected ranges)
   - NEVER compare across asset types (e.g., MON pools vs BTC pools, LST pools vs stablecoin pools)
   - Different asset classes have different risk profiles and expected yields - comparing them is meaningless
   - **IMPORTANT**: Commodity pools (e.g., AUSD-XAUt0 where XAUt0 is gold) are NOT the same as stablecoin pools (e.g., AUSD-USDT0). Do NOT compare them.

2. **Efficiency Assessment Using Expected Ranges**:
   - Compare each pool's TVL Cost against the expected range for its asset type (see table above)
   - Flag pools exceeding expected range by >30% as high priority issues
   - Within the same asset class, pools with the same token pairs should have similar TVL Costs
   - Flag when TVL Cost differs by >20% between pools with same token pair and asset type
   - Use Uniswap pools as baseline within each asset class

3. **WoW Change Analysis - Check Internal Factors FIRST**:
   ${canPerformWowAnalysis ? '' : '**⚠️ WARNING: Previous week data is missing. WoW analysis CANNOT be performed.**'}
   - For each significant WoW change (>20% increase or <-20% decrease), follow this order:
   
   **STEP 1: Check Internal Math (Incentive Efficiency & TVL Retention)**
     a) Calculate incentive change: (Current incentives - Previous incentives) / Previous incentives × 100
     b) Calculate TVL change: (Current TVL - Previous TVL) / Previous TVL × 100
     c) **If incentives increased while TVL decreased**: This is a mechanical efficiency drop - incentives grew but didn't retain/grow TVL proportionally
     d) **If incentives decreased while TVL increased**: This is efficiency improvement - less incentives needed for more TVL
     e) **If incentives increased while TVL stayed flat**: TVL Cost increase is due to higher incentives, not TVL loss
     f) **If incentives stayed similar (±10%) but TVL dropped**: Then look for external factors (competitors, market conditions)
   
   **STEP 2: Only After Internal Factors Checked, Look for Competitors**
     - If internal factors don't explain the change (e.g., incentives flat but TVL dropped), THEN identify competitor campaigns (see point 4)
     - Competitor analysis is secondary - internal efficiency is primary
   
   - **Confidence Level**: 
     * High: Have previous week data + clear internal factor explanation OR identified specific competitors
     * Medium: Have previous week data but unclear cause OR have competitors but no previous data
     * Low: Missing both previous data and competitor data

4. **Identify Specific Competitor Pools with Same Token Pair** (Only if internal factors don't explain WoW change):
   - **ONLY use this if**: Incentives stayed similar (±10%) but TVL dropped - then competitors may have attracted TVL
   - Find pools with the EXACT SAME token pair from "Example Opportunities" section (prioritize LP pools)
   - **Compare by APR** (TVL Cost and incentives may not be available for competitor pools)
   - If another LP pool with the same token pair has significantly higher APR, it may have attracted TVL
   - Include these competing pools in the competitorLinks array with their Merkl URLs and APR
   - **Note**: TVL Cost and incentives for competitor pools are often unavailable - APR comparison is acceptable when TVL Cost unavailable
   - Example: If analyzing "uniswap-upshift-MON-USDC" with +24.69% WoW increase and incentives were flat, find other MON-USDC LP pools and compare their APRs

5. **Volume Data Quality**:
   - If volume appears uniform across pools (same value), note that this may indicate data aggregation issues
   - Do not make conclusions based on unreliable volume data
   - Focus on TVL Cost analysis instead when volume data is suspect

## Current Week Pool Data
`;

  // Add pool data grouped by protocol
  const poolsByProtocol: Record<string, PoolData[]> = {};
  for (const pool of currentWeek.pools) {
    if (!poolsByProtocol[pool.protocol]) {
      poolsByProtocol[pool.protocol] = [];
    }
    poolsByProtocol[pool.protocol].push(pool);
  }

  // Helper function to classify asset type more accurately
  function classifyAssetType(tokenPair: string, marketName: string): string {
    const tokenPairLower = tokenPair.toLowerCase();
    const marketNameLower = marketName.toLowerCase();
    
    // Extract tokens from pair (e.g., "MON-USDC" -> ["mon", "usdc"])
    const tokens = tokenPairLower.split('-').filter(t => t.length > 0);
    
    // Check for gold/commodity tokens first (XAUt0, XAU, etc.) - these are NOT stablecoins
    if (tokenPairLower.includes('xaut') || tokenPairLower.includes('xau') || marketNameLower.includes('xaut') || marketNameLower.includes('xau') || marketNameLower.includes('gold')) {
      return 'commodity-related';
    }
    
    // Check for MON token (must be exact token match, not substring like "earnAUSD")
    // MON token patterns: "mon", "wmon", "stmon", "shmon" but NOT "earnAUSD", "common", etc.
    const monPatterns = ['-mon', 'mon-', '^mon$', 'wmon', 'stmon', 'shmon'];
    const hasMonToken = tokens.some(token => 
      monPatterns.some(pattern => {
        if (pattern.startsWith('^') || pattern.endsWith('$')) {
          return token === pattern.replace(/[\^$]/g, '');
        }
        return token.includes(pattern.replace(/[-]/g, ''));
      })
    ) || marketNameLower.match(/\b(mon|wmon|stmon|shmon)\b/);
    
    if (hasMonToken) {
      return 'mon-related';
    }
    
    // Check for BTC tokens
    if (tokenPairLower.includes('btc') || tokenPairLower.includes('wbtc') || tokenPairLower.includes('lbtc') || marketNameLower.includes('btc')) {
      return 'btc-related';
    }
    
    // Check for LST tokens
    if (tokenPairLower.includes('lst') || marketNameLower.includes('lst') || tokenPairLower.includes('stmon') || tokenPairLower.includes('shmon') || 
        tokenPairLower.includes('steth') || tokenPairLower.includes('reth') || tokenPairLower.includes('wsteth')) {
      return 'lst-related';
    }
    
    // Check for stablecoins (USDC, USDT, DAI, AUSD, etc.)
    const stablecoinPatterns = ['usdc', 'usdt', 'dai', 'ausd', '3pool'];
    const hasStablecoin = tokens.some(token => 
      stablecoinPatterns.some(pattern => token.includes(pattern))
    ) || marketNameLower.match(/\b(usdc|usdt|dai|ausd|3pool)\b/);
    
    if (hasStablecoin) {
      // Check if paired with yield-bearing stablecoin (earnAUSD, sUSDC, etc.)
      const yieldStablePatterns = ['earnausd', 'susdc', 'yusdc', 'yusdt', 'yausd'];
      const hasYieldStable = tokens.some(token => 
        yieldStablePatterns.some(pattern => token.includes(pattern))
      ) || marketNameLower.match(/\b(earnausd|susdc|yusdc|yusdt|yausd)\b/);
      
      if (hasYieldStable) {
        return 'stablecoin-derivative';
      }
      return 'stablecoin-related';
    }
    
    return 'other';
  }

  // Note: Asset type classification is done by AI based on the classification table in the prompt

  for (const [protocol, pools] of Object.entries(poolsByProtocol)) {
    prompt += `\n### ${protocol.toUpperCase()} Protocol\n`;
    for (const pool of pools) {
      // Find previous week data for this pool
      const prevPool = previousWeek?.pools.find(p => 
        p.protocol === pool.protocol && 
        p.fundingProtocol === pool.fundingProtocol && 
        p.marketName === pool.marketName
      );
      
      prompt += `- **${pool.marketName}**\n`;
      prompt += `  - Funding Protocol: ${pool.fundingProtocol}\n`;
      prompt += `  - Token Pair: ${pool.tokenPair}\n`;
      prompt += `  - Current Week Incentives: ${pool.incentivesMON.toFixed(2)} MON${pool.incentivesUSD ? ` ($${pool.incentivesUSD.toFixed(2)})` : ''}\n`;
      if (prevPool) {
        prompt += `  - Previous Week Incentives: ${prevPool.incentivesMON.toFixed(2)} MON${prevPool.incentivesUSD ? ` ($${prevPool.incentivesUSD.toFixed(2)})` : ''}\n`;
        const incentiveChange = prevPool.incentivesUSD && pool.incentivesUSD 
          ? ((pool.incentivesUSD - prevPool.incentivesUSD) / prevPool.incentivesUSD * 100).toFixed(1)
          : 'N/A';
        prompt += `  - Incentive Change WoW: ${incentiveChange !== 'N/A' ? (parseFloat(incentiveChange) > 0 ? '+' : '') + incentiveChange + '%' : 'N/A'}\n`;
        prompt += `  - Previous Week TVL: ${prevPool.tvl ? `$${(prevPool.tvl / 1000000).toFixed(2)}M` : 'N/A'}\n`;
        prompt += `  - Previous Week TVL Cost: ${prevPool.tvlCost ? `${prevPool.tvlCost.toFixed(2)}%` : 'N/A'}\n`;
      } else {
        prompt += `  - Previous Week Data: MISSING (WoW analysis not possible)\n`;
      }
      prompt += `  - TVL: ${pool.tvl ? `$${(pool.tvl / 1000000).toFixed(2)}M` : 'N/A'}\n`;
      prompt += `  - Volume: ${pool.volume ? `$${(pool.volume / 1000000).toFixed(2)}M` : 'N/A'}\n`;
      prompt += `  - APR: ${pool.apr ? `${pool.apr.toFixed(2)}%` : 'N/A'}\n`;
      prompt += `  - TVL Cost: ${pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : 'N/A'}\n`;
      // Calculate WoW change if not provided but we have both current and previous TVL Cost
      let wowChangeValue = pool.wowChange;
      if ((wowChangeValue === null || wowChangeValue === undefined) && prevPool && pool.tvlCost !== null && prevPool.tvlCost !== null && prevPool.tvlCost !== 0) {
        wowChangeValue = ((pool.tvlCost - prevPool.tvlCost) / prevPool.tvlCost) * 100;
      }
      if (wowChangeValue !== null && wowChangeValue !== undefined) {
        prompt += `  - TVL Cost WoW Change: ${wowChangeValue > 0 ? '+' : ''}${wowChangeValue.toFixed(2)}%\n`;
      } else if (prevPool) {
        prompt += `  - TVL Cost WoW Change: N/A (missing TVL Cost data)\n`;
      }
    }
  }
  
  // Note: Asset type grouping removed - AI will classify pools based on token pairs and the classification table

  // Add similar pools comparison with Merkl URLs
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

  // Note: Opportunity type classification is done inline - AI can determine type from names

  // Add examples from other Merkl opportunities with same token pairs
  if (allOpportunities && allOpportunities.length > 0) {
    prompt += `\n## Example Opportunities from Other Protocols (Same Token Pairs)\n`;
    prompt += `These are examples of other pools/markets on Monad with the same token pairs as pools you're analyzing.\n`;
    prompt += `**IMPORTANT**: Opportunities are grouped by type (LP Pools, Lending Markets, Borrowing). Only compare pools of the same type.\n`;
    
    // Extract token pairs from current pools
    const currentTokenPairs = new Set(currentWeek.pools.map(p => p.tokenPair.toLowerCase()));
    
    // Group opportunities by token pair and type - OPTIMIZED: Single pass O(n) instead of O(n²)
    const opportunitiesByTokenPair: Record<string, {
      lp: any[];
      lending: any[];
      borrowing: any[];
      other: any[];
    }> = {};
    
    for (const opp of allOpportunities) {
      const oppText = `${opp.name || ''} ${opp.opportunityId || ''}`.toLowerCase();
      
      // Extract token pair with one regex match
      const match = oppText.match(/([a-z0-9]+)[-\/]([a-z0-9]+)/i);
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
    
    // Show examples for each token pair, grouped by type
    for (const tokenPair of Array.from(currentTokenPairs).sort()) {
      const grouped = opportunitiesByTokenPair[tokenPair];
      if (!grouped) continue;
      
      const totalCount = grouped.lp.length + grouped.lending.length + grouped.borrowing.length + grouped.other.length;
      if (totalCount === 0) continue;
      
      prompt += `\n### ${tokenPair.toUpperCase()} Examples (${totalCount} total opportunities):\n`;
      
      // LP Pools
      if (grouped.lp.length > 0) {
        prompt += `\n**LP Pools** (${grouped.lp.length} pools) - Compare TVL Cost and APR:\n`;
        for (const opp of grouped.lp.slice(0, 10)) {
          const protocolId = opp.mainProtocolId || opp.protocol?.id || 'unknown';
          const oppName = opp.name || opp.opportunityId || 'Unknown';
          const oppAPR = opp.apr !== undefined ? parseFloat(String(opp.apr)) : null;
          const merklUrl = `https://app.merkl.xyz/chains/monad?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
          
          prompt += `- ${protocolId}: "${oppName}"${oppAPR !== null ? ` (APR: ${oppAPR.toFixed(2)}%)` : ''} [Merkl: ${merklUrl}]\n`;
        }
        if (grouped.lp.length > 10) {
          prompt += `  ... and ${grouped.lp.length - 10} more LP pools\n`;
        }
      }
      
      // Lending Markets
      if (grouped.lending.length > 0) {
        prompt += `\n**Lending Markets** (${grouped.lending.length} markets) - Compare APR only (TVL Cost not applicable):\n`;
        for (const opp of grouped.lending.slice(0, 10)) {
          const protocolId = opp.mainProtocolId || opp.protocol?.id || 'unknown';
          const oppName = opp.name || opp.opportunityId || 'Unknown';
          const oppAPR = opp.apr !== undefined ? parseFloat(String(opp.apr)) : null;
          const merklUrl = `https://app.merkl.xyz/chains/monad?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
          
          prompt += `- ${protocolId}: "${oppName}"${oppAPR !== null ? ` (APR: ${oppAPR.toFixed(2)}%)` : ''} [Merkl: ${merklUrl}]\n`;
        }
        if (grouped.lending.length > 10) {
          prompt += `  ... and ${grouped.lending.length - 10} more lending markets\n`;
        }
      }
      
      // Borrowing (usually not relevant for LP comparison)
      if (grouped.borrowing.length > 0) {
        prompt += `\n**Borrowing Markets** (${grouped.borrowing.length} markets) - Not directly comparable to LP pools:\n`;
        for (const opp of grouped.borrowing.slice(0, 5)) {
          const protocolId = opp.mainProtocolId || opp.protocol?.id || 'unknown';
          const oppName = opp.name || opp.opportunityId || 'Unknown';
          const oppAPR = opp.apr !== undefined ? parseFloat(String(opp.apr)) : null;
          const merklUrl = `https://app.merkl.xyz/chains/monad?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
          
          prompt += `- ${protocolId}: "${oppName}"${oppAPR !== null ? ` (APR: ${oppAPR.toFixed(2)}%)` : ''} [Merkl: ${merklUrl}]\n`;
        }
        if (grouped.borrowing.length > 5) {
          prompt += `  ... and ${grouped.borrowing.length - 5} more borrowing markets\n`;
        }
      }
      
      prompt += `\n**Analysis Note**: When analyzing ${tokenPair} pools, compare LP pools against other LP pools (TVL Cost and APR). Lending markets can be compared by APR but serve different purposes.\n`;
    }
  }

  if (previousWeek) {
    prompt += `\n## Previous Week Comparison\n`;
    prompt += `Previous week had ${previousWeek.pools.length} pools.\n`;
    prompt += `**IMPORTANT**: When analyzing WoW changes, always check if incentives changed first.\n`;
    prompt += `- If incentives dropped significantly, the WoW cost drop is likely due to lower incentives, not efficiency improvement\n`;
    prompt += `- If incentives stayed similar but TVL Cost changed, then look for competitor campaigns or TVL shifts\n`;
    prompt += `- Previous week incentives are shown above for each pool - use them in your analysis\n`;
  }

  // Add all campaigns context (vampire campaigns, competitive shifts)
  if (allCampaigns && allCampaigns.length > 0) {
    prompt += `\n## All Active Campaigns on Monad (Competitive Context)\n`;
    prompt += `There are ${allCampaigns.length} total campaigns on Monad. This includes campaigns from protocols not in your selected list.\n`;
    prompt += `**CRITICAL**: When explaining WoW changes or TVL shifts, you MUST identify SPECIFIC competing campaigns from this list.\n`;
    prompt += `Do NOT just say "competitors" or "vampire campaigns" - name the specific protocol, funding protocol, and market.\n`;
    prompt += `\nUse this to:\n`;
    prompt += `- Identify SPECIFIC campaigns targeting the same assets/token pairs as pools with WoW increases\n`;
    prompt += `- Find campaigns with higher incentives or better TVL Cost that might have attracted TVL\n`;
    prompt += `- Identify new campaigns that started during the period\n`;
    prompt += `- Find campaigns that ended (explaining why TVL might have shifted)\n`;
    
    // Group campaigns by token pair - OPTIMIZED: Single pass instead of 4 separate loops
    const campaignsByTokenPair: Record<string, any[]> = {};
    const allTokenPairs = new Set(currentWeek.pools.map(p => p.tokenPair.toLowerCase()));
    let unknownCount = 0;
    
    for (const campaign of allCampaigns) {
      const protocolId = campaign.mainProtocolId || campaign.protocol?.id || 'unknown';
      
      // Skip unknown campaigns entirely
      if (protocolId === 'unknown') {
        unknownCount++;
        continue;
      }
      
      // Extract token pair from opportunityId with regex
      const oppId = (campaign.opportunityId || '').toLowerCase();
      const match = oppId.match(/([a-z0-9]+)[-\/]([a-z0-9]+)/i);
      const tokenPair = match ? `${match[1]}-${match[2]}`.toLowerCase() : null;
      
      // Only include if token pair matches current pools
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
    
    prompt += `\n### Competing Campaigns by Token Pair:\n`;
    if (unknownCount > 0) {
      prompt += `**Note**: ${unknownCount} of ${allCampaigns.length} campaigns lack identifiable protocol data. Only ${identifiableCampaigns} campaigns with identifiable protocols are shown below.\n`;
      prompt += `**For competitor identification, prioritize the "Example Opportunities" section which has structured data with APRs.**\n\n`;
    }
    prompt += `**Use this to identify SPECIFIC competitor campaigns when explaining WoW changes (only if internal factors don't explain the change).**\n\n`;
    
    // Show campaigns grouped by token pairs - SIMPLIFIED: Just protocol name and token pair
    let hasIdentifiableCampaigns = false;
    for (const tokenPair of Array.from(allTokenPairs).sort()) {
      const campaigns = campaignsByTokenPair[tokenPair] || [];
      if (campaigns.length > 0) {
        hasIdentifiableCampaigns = true;
        prompt += `\n**${tokenPair.toUpperCase()}** (${campaigns.length} competing campaigns):\n`;
        for (const campaign of campaigns.slice(0, 15)) {
          prompt += `- ${campaign.protocolId}: ${tokenPair} [Merkl: ${campaign.merklUrl}]\n`;
        }
        if (campaigns.length > 15) {
          prompt += `  ... and ${campaigns.length - 15} more ${tokenPair} campaigns\n`;
        }
      }
    }
    
    if (!hasIdentifiableCampaigns) {
      prompt += `\n**No identifiable competing campaigns found for current token pairs.**\n`;
    }
  }

  // Add all opportunities context (pools without incentives)
  if (allOpportunities && allOpportunities.length > 0) {
    prompt += `\n## All Pools/Markets on Monad (Full Competitive Landscape)\n`;
    prompt += `There are ${allOpportunities.length} total opportunities (pools/markets) on Monad.\n`;
    prompt += `This includes pools that DON'T have incentives. Use this to:\n`;
    prompt += `- Identify the full competitive set for each token pair\n`;
    prompt += `- Understand which pools are missing incentives (potential opportunities)\n`;
    prompt += `- See the complete market landscape beyond just incentivized pools\n`;
    
    // Group opportunities by protocol
    const opportunitiesByProtocol: Record<string, any[]> = {};
    for (const opp of allOpportunities) {
      const protocolId = opp.mainProtocolId || opp.protocol?.id || 'unknown';
      if (!opportunitiesByProtocol[protocolId]) {
        opportunitiesByProtocol[protocolId] = [];
      }
      opportunitiesByProtocol[protocolId].push(opp);
    }
    
    prompt += `\n### Opportunities by Protocol:\n`;
    for (const [protocolId, opportunities] of Object.entries(opportunitiesByProtocol)) {
      prompt += `- ${protocolId}: ${opportunities.length} pools/markets\n`;
    }
    
    // Identify pools without incentives
    // Removed "Pools Without Incentives" section - AI can't analyze pools without data
  }

  prompt += `\n## Your Analysis Tasks

1. **Key Findings**: List 3-5 most important findings about incentive efficiency.
   - ONLY compare pools within the same asset type (MON vs MON, BTC vs BTC, etc.)
   - Do NOT compare different asset types
   - Reference expected ranges from the Asset Classification table above

2. **Efficiency Issues**: For each pool, evaluate:
   - Is TVL Cost within expected range for its asset type? (see table above)
   - Flag pools exceeding expected range by >30% as "critical" severity
   - Flag pools exceeding expected range by 10-30% as "high" severity
   - Flag pools slightly above expected range (<10%) as "medium" severity
   - Are there similar pools (same token pair, same asset type) with significantly different TVL Cost (>20% gap)?
   - When comparing pools, reference examples from "Example Opportunities from Other Protocols" section
   - Example: "Pool X (stablecoin-derivative) has 16.73% TVL Cost, which exceeds expected range (8-18%) and is 300% higher than similar pool Borrow USDT0 (4.19%)"

3. **WoW Change Explanations**: ${canPerformWowAnalysis ? 'For each pool with WoW change >20% or <-20%:' : '**⚠️ SKIP THIS SECTION - Previous week data is missing. WoW analysis cannot be performed.**'}
   ${canPerformWowAnalysis ? `
   **STEP 1: Check Internal Factors FIRST (Incentive Efficiency & TVL Retention)**
   - Calculate and compare:
     * Incentive change WoW: (Current - Previous) / Previous × 100
     * TVL change WoW: (Current - Previous) / Previous × 100
   - **If incentives increased while TVL decreased**: Explain as "mechanical efficiency drop - incentives grew X% but TVL dropped Y%, pushing TVL Cost up"
   - **If incentives decreased while TVL increased**: Explain as "efficiency improvement - incentives reduced X% while TVL grew Y%"
   - **If incentives increased while TVL stayed flat**: Explain as "TVL Cost increase due to higher incentives (X% increase), not TVL loss"
   - **If incentives stayed similar (±10%) but TVL dropped**: Then proceed to STEP 2
   
   **STEP 1.5: Verify Mechanical Math Matches Actual Change**
   - Calculate expected TVL Cost change from incentive/TVL changes:
     * Expected change ≈ (1 + incentive_change%) / (1 + tvl_change%) - 1
     * Example: +6.7% incentives, -2.2% TVL → Expected: (1.067/0.978 - 1) ≈ +9.1% TVL Cost
   - Compare expected vs actual WoW change:
     * If difference < 5%: Internal factors fully explain the change (high confidence)
     * If difference 5-15%: Internal factors partially explain (medium confidence, note discrepancy)
     * If difference > 15%: Internal factors don't fully explain (proceed to STEP 2, note: "Actual change (X%) significantly exceeds mechanical effect (Y%). External factors likely involved.")
   - Example: "Mechanical effect from +6.7% incentives and -2.2% TVL predicts ~+9.1% TVL Cost increase, but actual increase was +12.2%. The 3.1pp gap suggests additional factors beyond pure math."
   
   **STEP 2: Only If Internal Factors Don't Explain, Look for Competitors**
   - Only if incentives were flat (±10%) but TVL dropped OR if mechanical change doesn't match actual change (>15% discrepancy), THEN identify SPECIFIC competitor pools:
     * Find pools with the SAME token pair from "Similar Pools Comparison" or "Example Opportunities" sections
     * Compare their APR (TVL Cost may not be available for competitors) - if another pool has higher APR, it may have attracted TVL
     * Include competitorLinks array with Merkl URLs and APR (TVL Cost and incentives may not be available)
     * Name the specific protocol, funding protocol, and market name
   
   - **Competitor Data Quality Checks**:
     * If competitor APR differs by >50% from analyzed pool: Flag as "Competitor APR may reflect low TVL or data quality issues. Verify pool size before concluding TVL was stolen."
     * If competitor APR differs by 30-50%: Note "Significant APR gap - investigate if competitor pool has comparable TVL or if high APR is due to small size"
     * If competitor APR differs by <30%: "Moderate APR difference - likely competitive pressure"
   - **Missing competitor metrics**: 
     * If TVL not available: Note "Cannot verify if competitor APR is from large or small pool"
     * If incentives not available: Note "Cannot compare incentive efficiency directly"
   - Example: "Clober MON-USDC offers 85.89% APR vs Uniswap's 52.64% (63% higher). However, without Clober's TVL data, this may indicate a small pool with high APR rather than efficient incentive use. Recommend verifying Clober pool size before strategy changes."
   
   - **Note**: TVL Cost and incentives for competitor pools may not be available - compare by APR when TVL Cost unavailable
   - Set confidence level based on:
     * High: Internal math matches actual change within ±5% (internal factors fully explain)
     * Medium: Internal math partially explains (5-15% discrepancy) OR identified competitors with APR but gaps remain
     * Low: Internal math fails to explain (>15% discrepancy) AND no clear competitor identified
   - Example format (internal factor): "TVL Cost increased 12.24% because incentives increased 6.7% while TVL dropped 2.2%, mechanically pushing up cost per TVL unit"
   - Example format (competitor): "TVL Cost increased despite flat incentives because competitor pool Clober MON-USDC offers higher APR (86.06% vs 52.64%), attracting TVL away"` : ''}

4. **Recommendations**: Provide specific, actionable recommendations based on findings.
   
   **Recommendation Templates by Scenario**:
   
   a) **TVL Cost within range, TVL declining**:
      - "Monitor TVL trend over next 2 weeks. If decline continues, reduce incentives proportionally (e.g., if TVL drops 10%, reduce incentives 10% to maintain TVL Cost)"
      - "Investigate root cause: Check if decline is pool-specific or market-wide across similar pools"
   
   b) **TVL Cost above expected range (>30% over)**:
      - "Critical: Reduce incentives by X% to bring TVL Cost to Y% (top of expected range for [asset type])"
      - Calculate X: Target TVL Cost = current TVL × (top of expected range) / current incentives annualized
      - Example: "Reduce incentives from 2.6M MON to 2.1M MON to bring TVL Cost from 52.64% to 40% (top of MON pairs expected range)"
   
   c) **TVL Cost above range (10-30% over)**:
      - "High priority: Reduce incentives by X% to reach midpoint of expected range"
      - "If TVL growth is strategic goal, maintain current incentives but flag as inefficient spend"
   
   d) **Mechanical inefficiency (incentives grew, TVL didn't)**:
      - "Incentives increased X% but TVL only grew Y% (or declined). Revert to previous incentive level until TVL response improves"
      - Example: "Incentives grew 6.7% but TVL dropped 2.2%. Reduce back to 200K MON/week and investigate TVL retention issues"
   
   e) **Competitor with higher APR identified**:
      - "Competitor [protocol] offers [X]% APR vs [Y]% (Z% gap). Options:"
      - "Option 1: If competitor has comparable TVL, increase incentives by W% to match APR and recapture TVL"
      - "Option 2: If competitor APR seems unsustainably high or pool is small, monitor for 1-2 weeks before responding"
      - "Option 3: Investigate non-incentive factors (pool parameters, fee tiers, UX) that may explain TVL preference"
      - Example: "Clober MON-USDC offers 85.89% APR (63% higher). Before increasing incentives, verify Clober's TVL size. If comparable, consider increasing from 2.6M to 3.5M MON/week to close APR gap. If Clober TVL is <$1M, monitor without action."
   
   f) **TVL Cost within range, no issues**:
      - "Pool performing efficiently within expected range. Maintain current incentive levels."
      - "Consider slight reduction (5-10%) to test price sensitivity if strategic goal is cost optimization"
   
   **Prioritization**:
   - Critical severity issues: Address immediately (reduce incentives this week)
   - High severity: Address within 1 week
   - Medium severity: Monitor for 2 weeks, then adjust
   - Low severity: Optional optimization opportunities
   
   **General Principles**:
   - Always compare within the same asset type when benchmarking
   - Reference specific competitor pools from "Example Opportunities" section
   - Flag data quality concerns that limit recommendation confidence
   - Provide specific numbers (incentive amounts, target TVL Cost) not just directional guidance

Format your response as JSON with this structure:
{
  "dataQuality": {
    "canPerformWowAnalysis": ${canPerformWowAnalysis},
    "missingFields": ${hasPreviousWeek ? '[]' : '["previousIncentives", "previousTvl"]'},
    "competitorDataCompleteness": ${allCampaigns ? parseFloat(campaignDataCompleteness) : 0},
    "notes": "${canPerformWowAnalysis ? 'WoW analysis available for pools with previous data.' : 'Cannot perform WoW analysis - missing previous period data.'} ${allCampaigns && parseFloat(campaignDataCompleteness) < 50 ? 'Competitive analysis limited due to missing campaign data.' : ''}"
  },
  "keyFindings": ["finding1", "finding2", ...],
  "efficiencyIssues": [
    {
      "poolId": "protocol-fundingProtocol-marketName",
      "assetType": "stablecoin|stablecoin-derivative|mon-related|btc-related|lst-related|commodity-related|other",
      "tvlCost": 14.03,
      "expectedRange": [8, 18],
      "status": "within_range|above_range|critical",
      "issue": "description of issue",
      "severity": "high|medium|low",
      "recommendation": "specific recommendation",
      "analysisConfidence": "high|medium|low"
    }
  ],
  "wowExplanations": [
    {
      "poolId": "protocol-fundingProtocol-marketName",
      "change": 15.5,
      "mechanicalChange": 9.1,
      "mechanicalExplanation": "Expected change from +6.7% incentives and -2.2% TVL: (1.067/0.978 - 1) ≈ +9.1%",
      "discrepancy": 6.4,
      "explanation": "full explanation including mechanical math and any additional factors",
      "likelyCause": "competitor_pools|tvl_shift|new_pools|incentive_change|other",
      "confidence": "high|medium|low",
      "competitorLinks": [
        {
          "protocol": "competitor protocol name",
          "marketName": "competitor market name",
          "merklUrl": "https://app.merkl.xyz/chains/monad?search=...",
          "apr": 45.5,
          "tvlCost": 12.3,
          "incentives": 350000,
          "reason": "why this competitor is relevant (e.g., lower TVL Cost, higher incentives, higher APR). Include data quality warnings if APR differs by >30%."
        }
      ]
    }
  ],
  "recommendations": ["recommendation1", "recommendation2", ...]
}

## Confidence Level Definitions
- **HIGH**: Mechanical math matches actual change within ±5% (internal factors fully explain). Example: Expected +9.1%, actual +10.2% → High confidence.
- **MEDIUM**: Mechanical math partially explains (5-15% discrepancy) OR identified competitors with APR but gaps remain. Example: Expected +9.1%, actual +15.5% → Medium confidence, investigate competitors.
- **LOW**: Mechanical math fails to explain (>15% discrepancy) AND no clear competitor identified. Example: Expected +9.1%, actual +25.0% but no competitors found → Low confidence, data may be unreliable.

## Important Notes
- Always calculate mechanicalChange = (1 + incentive_change%) / (1 + tvl_change%) - 1
- Always compare mechanicalChange vs actual change to detect discrepancies
- Flag competitor APR differences >30% as potentially unreliable (may indicate small pool size)
- Provide specific numbers in recommendations (incentive amounts, target TVL Cost percentages)
`;

  return prompt;
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
  
  try {
    // Try to fix trailing commas before closing braces/brackets
    fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
    
    // Try to fix unquoted keys (basic attempt - this is tricky)
    // Only fix if we can identify the pattern safely
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    
    return fixed;
  } catch {
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
 * Call Elfa AI API (or fallback to OpenAI/Anthropic if Elfa doesn't have direct LLM)
 * For now, we'll use a generic LLM API structure
 */
async function callGrokAI(prompt: string): Promise<any> {
  // Check environment variables (re-read at runtime to ensure latest values)
  const xaiKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  
  console.log('Environment check:', {
    hasXAIKey: !!xaiKey,
    xaiKeyPrefix: xaiKey ? xaiKey.substring(0, 10) + '...' : 'none',
  });

  if (!xaiKey) {
    throw new Error('XAI_API_KEY or GROK_API_KEY environment variable is required. Please add it to your .env.local file.');
  }

  try {
    console.log('Calling Grok (xAI) API...');
    // Grok uses /responses endpoint with "input" instead of "messages"
    const response = await fetch(`${XAI_API_BASE}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${xaiKey}`,
      },
        body: JSON.stringify({
        model: 'grok-4-1-fast-reasoning', // Using reasoning model for better analysis
        input: [
          {
            role: 'system',
            content: 'You are an expert DeFi analyst specializing in incentive efficiency analysis. CRITICAL: You MUST respond with valid, parseable JSON only. Do not include any markdown formatting, code blocks, or explanatory text outside the JSON. The response must be pure JSON that can be parsed directly.',
          },
          {
            role: 'user',
            content: prompt + '\n\nIMPORTANT: Respond with ONLY valid JSON. Do not wrap it in markdown code blocks or add any text before or after the JSON.',
          },
        ],
        // Grok supports structured outputs via schema, but for now we'll use JSON mode in the prompt
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Grok API error:', response.status, errorText);
      throw new Error(`Grok API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log('Grok API success');
    
    // Grok response structure: data.output[0].content is an array of objects with { type: "output_text", text: "..." }
    if (data.output && Array.isArray(data.output) && data.output.length > 0) {
      const firstOutput = data.output[0];
      
      // Extract text from content array
      if (firstOutput.content && Array.isArray(firstOutput.content) && firstOutput.content.length > 0) {
        // Find the output_text content
        const textContent = firstOutput.content.find((item: any) => item.type === 'output_text' && item.text);
        
        if (textContent && textContent.text) {
          let jsonText = textContent.text;
          console.log('Extracted JSON text, length:', jsonText.length);
          
          // Extract JSON from markdown code blocks if present
          const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
          if (jsonMatch) {
            jsonText = jsonMatch[1];
          }
          
          // Clean up common JSON issues
          jsonText = cleanJSON(jsonText);
          
          try {
            const parsed = JSON.parse(jsonText);
            console.log('Successfully parsed JSON from Grok response');
            return parsed;
          } catch (parseError: any) {
            console.error('Failed to parse JSON from text:', jsonText.substring(0, 1000));
            console.error('Parse error at position:', parseError.message);
            
            // Try to fix common JSON issues and retry
            const fixedJson = attemptJSONFix(jsonText, parseError);
            if (fixedJson) {
              try {
                const parsed = JSON.parse(fixedJson);
                console.log('Successfully parsed JSON after fix attempt');
                return parsed;
              } catch (retryError) {
                console.error('Retry parse also failed');
              }
            }
            
            // Show more context around the error
            const errorPosition = extractErrorPosition(parseError.message);
            const contextStart = Math.max(0, (errorPosition || 0) - 200);
            const contextEnd = Math.min(jsonText.length, (errorPosition || 0) + 200);
            const errorContext = jsonText.substring(contextStart, contextEnd);
            
            // Try one retry with a request to fix JSON
            console.log('Attempting retry with JSON fix request...');
            try {
              const retryResponse = await fetch(`${XAI_API_BASE}/responses`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${xaiKey}`,
                },
                body: JSON.stringify({
                  model: 'grok-4-1-fast-reasoning',
                  input: [
                    {
                      role: 'system',
                      content: 'You are a JSON validator and fixer. Fix the provided JSON to make it valid and parseable.',
                    },
                    {
                      role: 'user',
                      content: `The following JSON has a syntax error at position ${errorPosition || 'unknown'}: ${parseError.message}\n\nPlease fix this JSON and return ONLY the corrected, valid JSON without any markdown or explanatory text:\n\n${jsonText}`,
                    },
                  ],
                }),
              });
              
              if (retryResponse.ok) {
                const retryData = await retryResponse.json();
                if (retryData.output && Array.isArray(retryData.output) && retryData.output.length > 0) {
                  const retryContent = retryData.output[0].content;
                  if (Array.isArray(retryContent) && retryContent.length > 0) {
                    const retryText = retryContent.find((item: any) => item.type === 'output_text' && item.text)?.text;
                    if (retryText) {
                      const cleanedRetry = cleanJSON(retryText);
                      const retryParsed = JSON.parse(cleanedRetry);
                      console.log('Successfully parsed JSON after retry');
                      return retryParsed;
                    }
                  }
                }
              }
            } catch (retryError) {
              console.error('Retry also failed:', retryError);
            }
            
            throw new Error(`Failed to parse JSON response: ${parseError.message}. Error context: ${errorContext}`);
          }
        } else {
          throw new Error('No output_text content found in Grok response');
        }
      } else {
        // Fallback: try direct content access
        const content = firstOutput.content || firstOutput.text || firstOutput.message;
        if (typeof content === 'string') {
          try {
            return JSON.parse(content);
          } catch (parseError: any) {
            throw new Error(`Failed to parse JSON: ${parseError.message}`);
          }
        } else {
          throw new Error(`Unexpected content structure: ${JSON.stringify(firstOutput).substring(0, 500)}`);
        }
      }
    } else {
      console.error('Unexpected Grok API response structure:', JSON.stringify(data, null, 2));
      throw new Error(`Unexpected Grok API response structure. Expected data.output array.`);
    }
  } catch (error: any) {
    console.error('Grok API error:', error.message);
    throw error;
  }
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

      // Call Grok AI
      let analysis;
      try {
        analysis = await callGrokAI(prompt);
      } catch (aiError: any) {
        console.error('Grok AI call failed:', aiError);
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

    // Call Grok AI
    let analysis;
    try {
      analysis = await callGrokAI(prompt);
    } catch (aiError: any) {
      console.error('Grok AI call failed:', aiError);
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
