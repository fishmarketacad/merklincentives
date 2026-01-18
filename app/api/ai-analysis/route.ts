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

## Analysis Guidelines
1. **Compare Similar Pools**: Pools with the same token pairs (e.g., MON-USDC, MON-AUSD) should have similar TVL Costs. Flag when APR differs by more than 20%.
2. **Baseline Comparison**: Use Uniswap pools as the baseline. Other pools should strive to match or have lower TVL Cost while maintaining utilization.
3. **WoW Change Analysis**: For each significant WoW change (>10% increase or decrease), explain:
   - Was it due to competitor pools with higher incentives?
   - Did TVL shift to competitors?
   - Were new pools created with higher incentives?
   - Any other factors?

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

  for (const [protocol, pools] of Object.entries(poolsByProtocol)) {
    prompt += `\n### ${protocol.toUpperCase()} Protocol\n`;
    for (const pool of pools) {
      prompt += `- **${pool.marketName}**\n`;
      prompt += `  - Funding Protocol: ${pool.fundingProtocol}\n`;
      prompt += `  - Token Pair: ${pool.tokenPair}\n`;
      prompt += `  - Incentives: ${pool.incentivesMON.toFixed(2)} MON${pool.incentivesUSD ? ` ($${pool.incentivesUSD.toFixed(2)})` : ''}\n`;
      prompt += `  - TVL: ${pool.tvl ? `$${(pool.tvl / 1000000).toFixed(2)}M` : 'N/A'}\n`;
      prompt += `  - Volume: ${pool.volume ? `$${(pool.volume / 1000000).toFixed(2)}M` : 'N/A'}\n`;
      prompt += `  - APR: ${pool.apr ? `${pool.apr.toFixed(2)}%` : 'N/A'}\n`;
      prompt += `  - TVL Cost: ${pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : 'N/A'}\n`;
      if (pool.wowChange !== null) {
        prompt += `  - WoW Change: ${pool.wowChange > 0 ? '+' : ''}${pool.wowChange.toFixed(2)}%\n`;
      }
    }
  }

  // Add similar pools comparison
  prompt += `\n## Similar Pools Comparison\n`;
  for (const [tokenPair, pools] of Object.entries(similarPools)) {
    if (pools.length > 1) {
      prompt += `\n### ${tokenPair.toUpperCase()} Pools (${pools.length} pools)\n`;
      for (const pool of pools) {
        prompt += `- ${pool.protocol} (${pool.fundingProtocol}): TVL Cost ${pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : 'N/A'}, APR ${pool.apr ? `${pool.apr.toFixed(2)}%` : 'N/A'}\n`;
      }
    }
  }

  if (previousWeek) {
    prompt += `\n## Previous Week Comparison\n`;
    prompt += `Previous week had ${previousWeek.pools.length} pools. Compare TVL Costs and identify significant changes.\n`;
  }

  // Add all campaigns context (vampire campaigns, competitive shifts)
  if (allCampaigns && allCampaigns.length > 0) {
    prompt += `\n## All Active Campaigns on Monad (Competitive Context)\n`;
    prompt += `There are ${allCampaigns.length} total campaigns on Monad. This includes campaigns from protocols not in your selected list.\n`;
    prompt += `Use this to identify:\n`;
    prompt += `- Vampire campaigns (campaigns targeting the same assets/markets)\n`;
    prompt += `- Competitive shifts (new campaigns that might affect TVL)\n`;
    prompt += `- Campaigns that ended (explaining why TVL might have shifted)\n`;
    
    // Group campaigns by protocol
    const campaignsByProtocol: Record<string, any[]> = {};
    for (const campaign of allCampaigns) {
      const protocolId = campaign.mainProtocolId || campaign.protocol?.id || 'unknown';
      if (!campaignsByProtocol[protocolId]) {
        campaignsByProtocol[protocolId] = [];
      }
      campaignsByProtocol[protocolId].push(campaign);
    }
    
    prompt += `\n### Campaigns by Protocol:\n`;
    for (const [protocolId, campaigns] of Object.entries(campaignsByProtocol)) {
      prompt += `- ${protocolId}: ${campaigns.length} campaigns\n`;
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
2. **Efficiency Issues**: Identify pools with:
   - TVL Cost >50% (high priority)
   - TVL Cost >20% (medium priority)
   - Significant APR differences between similar pools (>20% difference)
3. **WoW Change Explanations**: For each pool with WoW change >10% or <-10%, explain the likely cause.
4. **Recommendations**: Provide actionable recommendations to improve efficiency.

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
      "likelyCause": "competitor pools|TVL shift|new pools|other"
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
