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
 * Generate prompt for Elfa AI analysis
 */
async function generateAnalysisPrompt(request: AnalysisRequest, allCampaigns?: any[], allOpportunities?: any[]): Promise<string> {
  const { currentWeek, previousWeek } = request;
  const similarPools = groupSimilarPools(currentWeek.pools);
  
  let prompt = `You are analyzing DeFi incentive efficiency on Monad chain. Your goal is to identify areas for improvement and explain efficiency changes.

## Context
- **Current Period**: ${currentWeek.startDate} to ${currentWeek.endDate}
- **Previous Period**: ${previousWeek ? `${previousWeek.startDate} to ${previousWeek.endDate}` : 'Not available'}
- **MON Price**: ${currentWeek.monPrice ? `$${currentWeek.monPrice}` : 'Not provided'}

## Key Metrics Explained
- **TVL Cost**: (Incentives annualized / TVL) × 100. This represents the APR being paid to attract TVL. Lower is better.
- **WoW Change**: Week-over-week percentage change in TVL Cost. Negative is better (cost decreased).
- **APR**: Annual Percentage Rate from Merkl incentives.

## Analysis Guidelines - CRITICAL RULES

1. **Asset Class Comparison Only**: 
   - ONLY compare pools with similar asset types (e.g., MON pools vs MON pools, BTC pools vs BTC pools, stablecoin pools vs stablecoin pools, commodity pools vs commodity pools)
   - NEVER compare different asset classes (e.g., MON pools vs BTC pools, LST pools vs stablecoin pools, commodity pools vs stablecoin pools)
   - Different asset classes have different risk profiles and expected yields - comparing them is meaningless
   - Group pools by asset type: MON-related, BTC-related, stablecoin-related, LST-related, commodity-related (gold/XAU), etc.
   - **IMPORTANT**: Commodity pools (e.g., AUSD-XAUt0 where XAUt0 is gold) are NOT the same as stablecoin pools (e.g., AUSD-USDT0). Do NOT compare them.

2. **Compare Similar Pools Within Asset Class**: 
   - Within the same asset class, pools with the same token pairs (e.g., MON-USDC, MON-AUSD) should have similar TVL Costs
   - Flag when TVL Cost differs by more than 20% within the same asset class and token pair
   - Use Uniswap pools as baseline within each asset class

3. **WoW Change Analysis - Must Include Previous Week Incentives**:
   - For each significant WoW change (>20% increase or <-20% decrease), you MUST check:
     a) Did incentives change? Compare current week incentives vs previous week incentives
     b) If incentives dropped significantly, the WoW cost drop might just be due to lower incentives, not efficiency improvement
     c) If incentives stayed similar but TVL dropped, identify which competitor campaigns gained TVL (see point 4)
     d) If incentives increased but TVL Cost increased, explain why (TVL didn't grow proportionally, competitor campaigns, etc.)

4. **Identify Specific Competitor Campaigns**:
   - When explaining WoW increases or TVL shifts, DO NOT just say "competitors" or "vampire campaigns"
   - Instead, identify SPECIFIC campaigns from the "All Active Campaigns" section that:
     a) Target the same assets/token pairs
     b) Have higher incentives or better TVL Cost
     c) Started during or before the current period
   - Name the specific protocol, funding protocol, and market name of competing campaigns
   - Example: "TVL shifted to Uniswap MON-USDC pool (funded by ProtocolX) which has 15% lower TVL Cost"

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

  // Group pools by asset type for better comparison
  const poolsByAssetType: Record<string, PoolData[]> = {};
  for (const pool of currentWeek.pools) {
    // Classify asset type from token pair or market name
    let assetType = 'other';
    const tokenPair = pool.tokenPair.toLowerCase();
    const marketName = pool.marketName.toLowerCase();
    
    // Check for gold/commodity tokens first (XAUt0, XAU, etc.) - these are NOT stablecoins
    if (tokenPair.includes('xaut') || tokenPair.includes('xau') || marketName.includes('xaut') || marketName.includes('xau') || marketName.includes('gold')) {
      assetType = 'commodity-related';
    } else if (tokenPair.includes('mon') || marketName.includes('mon')) {
      assetType = 'mon-related';
    } else if (tokenPair.includes('btc') || tokenPair.includes('wbtc') || tokenPair.includes('lbtc') || marketName.includes('btc')) {
      assetType = 'btc-related';
    } else if (tokenPair.includes('ausd') || tokenPair.includes('usdc') || tokenPair.includes('usdt') || tokenPair.includes('3pool')) {
      // Only classify as stablecoin if NOT paired with gold/commodity tokens
      // AUSD-XAUt0 should be commodity-related, not stablecoin-related
      const hasCommodity = tokenPair.includes('xaut') || tokenPair.includes('xau') || marketName.includes('xaut') || marketName.includes('xau');
      assetType = hasCommodity ? 'commodity-related' : 'stablecoin-related';
    } else if (tokenPair.includes('lst') || marketName.includes('lst') || tokenPair.includes('stmon') || tokenPair.includes('shmon')) {
      assetType = 'lst-related';
    }
    
    if (!poolsByAssetType[assetType]) {
      poolsByAssetType[assetType] = [];
    }
    poolsByAssetType[assetType].push(pool);
  }

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
      }
      prompt += `  - TVL: ${pool.tvl ? `$${(pool.tvl / 1000000).toFixed(2)}M` : 'N/A'}\n`;
      prompt += `  - Volume: ${pool.volume ? `$${(pool.volume / 1000000).toFixed(2)}M` : 'N/A'}\n`;
      prompt += `  - APR: ${pool.apr ? `${pool.apr.toFixed(2)}%` : 'N/A'}\n`;
      prompt += `  - TVL Cost: ${pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : 'N/A'}\n`;
      if (pool.wowChange !== null) {
        prompt += `  - TVL Cost WoW Change: ${pool.wowChange > 0 ? '+' : ''}${pool.wowChange.toFixed(2)}%\n`;
      }
    }
  }
  
  // Add asset type grouping for better context
  prompt += `\n## Pools Grouped by Asset Type (for proper comparison)\n`;
  for (const [assetType, pools] of Object.entries(poolsByAssetType)) {
    if (pools.length > 0) {
      prompt += `\n### ${assetType.toUpperCase()} Pools (${pools.length} pools)\n`;
      prompt += `Only compare TVL Costs within this asset type. Do NOT compare ${assetType} pools to other asset types.\n`;
      for (const pool of pools) {
        prompt += `- ${pool.protocol} ${pool.marketName}: TVL Cost ${pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : 'N/A'}, Incentives ${pool.incentivesMON.toFixed(2)} MON\n`;
      }
    }
  }

  // Add similar pools comparison with Merkl URLs
  prompt += `\n## Similar Pools Comparison\n`;
  for (const [tokenPair, pools] of Object.entries(similarPools)) {
    if (pools.length > 1) {
      prompt += `\n### ${tokenPair.toUpperCase()} Pools (${pools.length} pools)\n`;
      for (const pool of pools) {
        const merklLink = pool.merklUrl ? ` [Merkl: ${pool.merklUrl}]` : '';
        prompt += `- ${pool.protocol} (${pool.fundingProtocol}): TVL Cost ${pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : 'N/A'}, APR ${pool.apr ? `${pool.apr.toFixed(2)}%` : 'N/A'}${merklLink}\n`;
      }
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
    
    // Group campaigns by token pair for easier competitor identification
    // Match campaigns to pools by token pairs
    const campaignsByTokenPair: Record<string, any[]> = {};
    const allTokenPairs = new Set(currentWeek.pools.map(p => p.tokenPair.toLowerCase()));
    
    for (const campaign of allCampaigns) {
      const protocolId = campaign.mainProtocolId || campaign.protocol?.id || 'unknown';
      const fundingProtocol = campaign.protocol?.id || campaign.creator?.tags?.[0] || 'unknown';
      const opportunityId = campaign.opportunityId || '';
      
      // Try to match campaign to token pairs from current pools
      // Extract potential token pair from opportunity ID or campaign data
      let matchedTokenPair = null;
      for (const tokenPair of allTokenPairs) {
        // Check if opportunity ID or campaign data contains tokens from the pair
        const tokens = tokenPair.split('-');
        const opportunityLower = opportunityId.toLowerCase();
        if (tokens.every(token => opportunityLower.includes(token.toLowerCase()))) {
          matchedTokenPair = tokenPair;
          break;
        }
      }
      
      // If no exact match, classify by asset type
      if (!matchedTokenPair) {
        let assetKey = 'other';
        const opportunityLower = opportunityId.toLowerCase();
        if (opportunityLower.includes('mon')) {
          assetKey = 'mon-related';
        } else if (opportunityLower.includes('btc') || opportunityLower.includes('wbtc')) {
          assetKey = 'btc-related';
        } else if (opportunityLower.includes('ausd') || opportunityLower.includes('usdc') || opportunityLower.includes('usdt')) {
          assetKey = 'stablecoin-related';
        }
        matchedTokenPair = assetKey;
      }
      
      if (!campaignsByTokenPair[matchedTokenPair]) {
        campaignsByTokenPair[matchedTokenPair] = [];
      }
      
      const startDate = campaign.startTimestamp ? new Date(parseInt(String(campaign.startTimestamp)) * 1000).toISOString().split('T')[0] : 'unknown';
      const endDate = campaign.endTimestamp ? new Date(parseInt(String(campaign.endTimestamp)) * 1000).toISOString().split('T')[0] : 'unknown';
      
      // Generate Merkl URL for this campaign
      // Use search page format: https://app.merkl.xyz/chains/monad?search={protocolId}&status=LIVE%2CSOON%2CPAST
      const merklUrl = `https://app.merkl.xyz/chains/monad?search=${encodeURIComponent(protocolId)}&status=LIVE%2CSOON%2CPAST`;
      
      campaignsByTokenPair[matchedTokenPair].push({
        ...campaign,
        protocolId,
        fundingProtocol,
        opportunityId,
        startDate,
        endDate,
        merklUrl,
      });
    }
    
    prompt += `\n### Competing Campaigns by Token Pair/Asset Type:\n`;
    prompt += `**Use this to identify SPECIFIC competitor campaigns when explaining WoW changes.**\n`;
    prompt += `When a pool shows WoW increase, find campaigns here targeting the same token pair.\n\n`;
    
    // Show campaigns grouped by token pairs that exist in current pools
    for (const tokenPair of Array.from(allTokenPairs).sort()) {
      const campaigns = campaignsByTokenPair[tokenPair] || [];
      if (campaigns.length > 0) {
        prompt += `\n**${tokenPair.toUpperCase()}** (${campaigns.length} competing campaigns):\n`;
        for (const campaign of campaigns.slice(0, 15)) {
            prompt += `- ${campaign.protocolId} (funded by ${campaign.fundingProtocol}) - Opportunity: ${campaign.opportunityId || 'N/A'} - Active: ${campaign.startDate} to ${campaign.endDate} [Merkl: ${campaign.merklUrl || 'N/A'}]\n`;
        }
        if (campaigns.length > 15) {
          prompt += `  ... and ${campaigns.length - 15} more ${tokenPair} campaigns\n`;
        }
      }
    }
    
    // Also show campaigns by asset type for unmatched ones
    for (const [assetType, campaigns] of Object.entries(campaignsByTokenPair)) {
      if (!allTokenPairs.has(assetType) && campaigns.length > 0) {
        prompt += `\n**${assetType.toUpperCase()}** (${campaigns.length} campaigns - no matching pools in current selection):\n`;
        for (const campaign of campaigns.slice(0, 10)) {
            prompt += `- ${campaign.protocolId} (funded by ${campaign.fundingProtocol}) - Opportunity: ${campaign.opportunityId || 'N/A'} [Merkl: ${campaign.merklUrl || 'N/A'}]\n`;
        }
        if (campaigns.length > 10) {
          prompt += `  ... and ${campaigns.length - 10} more\n`;
        }
      }
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
    const incentivizedPoolIds = new Set(
      currentWeek.pools.map(p => `${p.protocol}-${p.marketName}`)
    );
    const poolsWithoutIncentives = allOpportunities.filter(opp => {
      const oppKey = `${opp.mainProtocolId || opp.protocol?.id || 'unknown'}-${opp.name || opp.explorerAddress || ''}`;
      return !incentivizedPoolIds.has(oppKey);
    });
    
    if (poolsWithoutIncentives.length > 0) {
      prompt += `\n### Pools Without Incentives (${poolsWithoutIncentives.length} pools):\n`;
      prompt += `These pools exist but don't have incentives. Consider if they should be incentivized or if they're competing with incentivized pools.\n`;
    }
  }

  prompt += `\n## Your Analysis Tasks
1. **Key Findings**: List 3-5 most important findings about incentive efficiency.
   - ONLY compare pools within the same asset type (MON vs MON, BTC vs BTC, etc.)
   - Do NOT compare different asset types

2. **Efficiency Issues**: Identify pools with:
   - TVL Cost >50% (high priority) - within same asset type
   - TVL Cost >20% (medium priority) - within same asset type
   - Significant TVL Cost differences (>20%) between pools with same token pairs and asset type

3. **WoW Change Explanations**: For each pool with WoW change >20% or <-20%:
   - FIRST check if incentives changed (compare current vs previous week incentives)
   - If incentives dropped significantly, note that cost drop is due to lower incentives, not efficiency
   - If incentives stayed similar, identify SPECIFIC competitor pools from "Similar Pools Comparison" section:
     * Find pools with the SAME token pair (e.g., if analyzing MON-USDC, find other MON-USDC pools)
     * Compare their TVL Costs - if another pool has lower TVL Cost or higher incentives, it likely attracted TVL away
     * Include competitorLinks array with Merkl URLs for each competing pool
     * Name the specific protocol, funding protocol, and market name
   - Also check "All Active Campaigns" for additional context
   - Do NOT just say "competitors" - be specific and include Merkl links in competitorLinks array

4. **Recommendations**: Provide actionable recommendations to improve efficiency.
   - Focus on comparisons within the same asset type
   - Reference specific competitor campaigns when relevant

Format your response as JSON with this structure:
{
  "keyFindings": ["finding1", "finding2", ...],
  "efficiencyIssues": [
    {
      "poolId": "protocol-fundingProtocol-marketName",
      "issue": "description of issue",
      "severity": "high|medium|low",
      "recommendation": "specific recommendation"
    }
  ],
  "wowExplanations": [
    {
      "poolId": "protocol-fundingProtocol-marketName",
      "change": 15.5,
      "explanation": "explanation of change",
      "likelyCause": "competitor_pools|tvl_shift|new_pools|incentive_change|other",
      "competitorLinks": [
        {
          "protocol": "competitor protocol name",
          "marketName": "competitor market name",
          "merklUrl": "https://app.merkl.xyz/chains/monad?search=...",
          "reason": "why this competitor is relevant (e.g., lower TVL Cost, higher incentives)"
        }
      ]
    }
  ],
  "recommendations": ["recommendation1", "recommendation2", ...]
}`;

  return prompt;
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
            content: 'You are an expert DeFi analyst specializing in incentive efficiency analysis. Always respond with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
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
          const jsonText = textContent.text;
          console.log('Extracted JSON text, length:', jsonText.length);
          
          try {
            const parsed = JSON.parse(jsonText);
            console.log('Successfully parsed JSON from Grok response');
            return parsed;
          } catch (parseError: any) {
            console.error('Failed to parse JSON from text:', jsonText.substring(0, 500));
            throw new Error(`Failed to parse JSON response: ${parseError.message}. Content preview: ${jsonText.substring(0, 200)}`);
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

export async function POST(request: NextRequest) {
  try {
    const body: AnalysisRequest = await request.json();
    const { currentWeek, previousWeek, includeAllData } = body;

    // Prepare pool data
    const pools: PoolData[] = currentWeek.pools.map(pool => ({
      ...pool,
      tokenPair: extractTokenPair(pool.marketName),
    }));

    // Fetch all campaigns and opportunities if requested
    let allCampaigns: any[] | undefined;
    let allOpportunities: any[] | undefined;
    
    if (includeAllData !== false) { // Default to true if not specified
      console.log('Fetching all campaigns and opportunities on Monad...');
      try {
        [allCampaigns, allOpportunities] = await Promise.all([
          fetchAllCampaignsOnMonad(),
          fetchAllOpportunitiesOnMonad(),
        ]);
        console.log(`Fetched ${allCampaigns.length} campaigns and ${allOpportunities.length} opportunities`);
      } catch (error: any) {
        console.error('Error fetching all data:', error);
        // Continue without all data if fetch fails
      }
    }

    // Generate prompt
    const prompt = await generateAnalysisPrompt({
      currentWeek: {
        ...currentWeek,
        pools,
      },
      previousWeek,
    }, allCampaigns, allOpportunities);

    // Log prompt for debugging (remove in production)
    console.log('=== AI Analysis Prompt ===');
    console.log(prompt);
    console.log('=== End Prompt ===');

    // Call Grok AI
    let analysis;
    try {
      analysis = await callGrokAI(prompt);
      console.log('Analysis result type:', typeof analysis);
      console.log('Analysis has keyFindings:', !!analysis?.keyFindings);
      console.log('Analysis has efficiencyIssues:', !!analysis?.efficiencyIssues);
      console.log('Analysis keys:', analysis ? Object.keys(analysis) : 'null');
    } catch (aiError: any) {
      console.error('Grok AI call failed:', aiError);
      throw aiError;
    }

    // Validate analysis structure
    if (!analysis || typeof analysis !== 'object') {
      throw new Error('Invalid analysis structure returned from AI');
    }

    return NextResponse.json({
      success: true,
      analysis,
    });
  } catch (error: any) {
    console.error('AI Analysis Error:', error);
    console.error('Error stack:', error.stack);
    return NextResponse.json(
      { error: error.message || 'Failed to generate AI analysis' },
      { status: 500 }
    );
  }
}
