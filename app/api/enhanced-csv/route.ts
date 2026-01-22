import { NextRequest, NextResponse } from 'next/server';

const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
const XAI_API_BASE = 'https://api.x.ai/v1';
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

interface PoolData {
  protocol: string;
  fundingProtocol: string;
  marketName: string;
  tokenPair: string;
  incentivesMON: number;
  incentivesUSD: number | null;
  tvl: number | null;
  volume: number | null;
  apr: number | null;
  tvlCost: number | null;
  wowChange: number | null;
  periodDays: number;
  merklUrl?: string;
}

interface EfficiencyIssue {
  poolId: string;
  recommendation: string;
  issue?: string;
}

interface EnhancedCSVRequest {
  pools: Array<{
    platform: {
      platformProtocol: string;
    };
    funding: {
      fundingProtocol: string;
    };
    market: {
      marketName: string;
      totalMON: number;
      tvl: number | null;
      apr: number | null;
    };
    volumeValue: number | null;
    merklUrl?: string;
  }>;
  startDate: string;
  endDate: string;
  monPrice: number | null;
  protocolTVL: { [key: string]: number | null };
  protocolDEXVolume: { [key: string]: { volume7d?: number; volumeInRange?: number; volume30d?: number } };
  efficiencyIssues?: EfficiencyIssue[];
}

// Fetch MON price from CoinGecko at a specific timestamp
async function fetchMONPriceAtDate(timestamp: number): Promise<number | null> {
  try {
    // CoinGecko expects timestamp in seconds
    const from = timestamp;
    const to = timestamp + 86400; // +1 day

    const url = `${COINGECKO_API_BASE}/coins/monad/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`CoinGecko API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.prices && Array.isArray(data.prices) && data.prices.length > 0) {
      // Return the first price in the range
      return data.prices[0][1];
    }

    return null;
  } catch (error) {
    console.error('Error fetching MON price from CoinGecko:', error);
    return null;
  }
}

// Calculate 7-day TWAP from CoinGecko
async function calculate7DayTWAP(endTimestamp: number): Promise<number | null> {
  try {
    const from = endTimestamp - (7 * 86400); // 7 days before
    const to = endTimestamp;

    const url = `${COINGECKO_API_BASE}/coins/monad/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`CoinGecko API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.prices && Array.isArray(data.prices) && data.prices.length > 0) {
      // Calculate simple average (TWAP approximation)
      const sum = data.prices.reduce((acc: number, price: [number, number]) => acc + price[1], 0);
      return sum / data.prices.length;
    }

    return null;
  } catch (error) {
    console.error('Error calculating 7-day TWAP:', error);
    return null;
  }
}

// Helper function to normalize poolId for flexible matching
// Handles both formats: AI may use mixed case with spaces, or normalized lowercase with hyphens
function normalizePoolIdForMatching(poolId: string): string {
  // Normalize: lowercase, normalize spaces/hyphens to single hyphens
  return poolId.toLowerCase().trim().replace(/[\s-]+/g, '-');
}

// Helper function to match pool to efficiency issue by poolId
function findEfficiencyIssue(
  poolId: string,
  efficiencyIssues?: EfficiencyIssue[]
): { action: string; notes: string } | null {
  if (!efficiencyIssues || efficiencyIssues.length === 0) {
    return null;
  }

  // Normalize our poolId for matching
  const normalizedPoolId = normalizePoolIdForMatching(poolId);
  
  // Try exact match first (normalize both sides)
  let issue = efficiencyIssues.find(
    (ei) => normalizePoolIdForMatching(ei.poolId) === normalizedPoolId
  );

  // If no exact match, try flexible matching by parts
  if (!issue) {
    // Extract parts from poolId: "PROTOCOL-FUNDING-MARKET"
    // Use first two dashes to split protocol-funding-market
    const firstDashIndex = normalizedPoolId.indexOf('-');
    const secondDashIndex = normalizedPoolId.indexOf('-', firstDashIndex + 1);
    
    if (firstDashIndex > 0 && secondDashIndex > firstDashIndex) {
      const protocol = normalizedPoolId.substring(0, firstDashIndex);
      const funding = normalizedPoolId.substring(firstDashIndex + 1, secondDashIndex);
      const marketName = normalizedPoolId.substring(secondDashIndex + 1);

      // Try to match by protocol-funding-marketName pattern
      issue = efficiencyIssues.find((ei) => {
        const eiPoolIdNormalized = normalizePoolIdForMatching(ei.poolId);
        const eiFirstDash = eiPoolIdNormalized.indexOf('-');
        const eiSecondDash = eiPoolIdNormalized.indexOf('-', eiFirstDash + 1);
        
        if (eiFirstDash > 0 && eiSecondDash > eiFirstDash) {
          const eiProtocol = eiPoolIdNormalized.substring(0, eiFirstDash);
          const eiFunding = eiPoolIdNormalized.substring(eiFirstDash + 1, eiSecondDash);
          const eiMarketName = eiPoolIdNormalized.substring(eiSecondDash + 1);
          
          // Match protocol and funding exactly, marketName with flexible matching
          // Use similarity check - if market names are very similar (one contains the other or vice versa)
          const protocolMatch = eiProtocol === protocol;
          const fundingMatch = eiFunding === funding;
          const marketNameMatch = eiMarketName === marketName || 
                                  eiMarketName.includes(marketName) || 
                                  marketName.includes(eiMarketName);
          
          return protocolMatch && fundingMatch && marketNameMatch;
        }
        return false;
      });
    }
  }

  if (issue && issue.recommendation) {
    // Extract action from recommendation (first sentence or phrase)
    const recommendation = issue.recommendation;
    const actionMatch = recommendation.match(/^(.*?)(?:\.|$)/);
    const action = actionMatch ? actionMatch[1].trim() : recommendation;
    const notes = issue.issue || recommendation;

    return { action, notes };
  }

  return null;
}

// Generate AI analysis for a single pool/row (fallback if no efficiencyIssues)
async function generateAIAnalysis(poolData: PoolData): Promise<{ action: string; notes: string }> {
  if (!XAI_API_KEY) {
    return { action: '', notes: 'AI analysis unavailable (no API key)' };
  }

  try {
    const prompt = `You are analyzing DeFi incentive campaigns on Monad. Provide specific, actionable recommendations.

Pool Details:
- Protocol: ${poolData.protocol}
- Market: ${poolData.marketName}
- Token Pair: ${poolData.tokenPair}
- Incentives: ${poolData.incentivesMON.toFixed(2)} MON (${poolData.incentivesUSD ? '$' + poolData.incentivesUSD.toFixed(2) : 'N/A'})
- TVL: ${poolData.tvl ? '$' + poolData.tvl.toLocaleString() : 'N/A'}
- Volume (7d): ${poolData.volume ? '$' + poolData.volume.toLocaleString() : 'N/A'}
- APR: ${poolData.apr !== null ? poolData.apr.toFixed(2) + '%' : 'N/A'}
- TVL Cost (Adjusted): ${poolData.tvlCost !== null ? poolData.tvlCost.toFixed(2) + '%' : 'N/A'}
- Volume Efficiency: ${poolData.volume && poolData.incentivesUSD ? ((poolData.incentivesUSD / poolData.volume) * 100).toFixed(2) + '%' : 'N/A'}
- WoW Change: ${poolData.wowChange !== null ? poolData.wowChange.toFixed(2) + '%' : 'N/A'}

STRATEGIC GUIDELINES:
- MON pairs (MON/AUSD, MON/USDC, WBTC/MON, WETH/MON): TVL cost above 50% is inefficient (Uniswap MON-USDC benchmark ~50% APR). Below 50% TVL Cost is acceptable. MON is L1-native, reduce dependence if cost exceeds 50%.
- Stablecoins (AUSD/USDC, AUSD/USDT): Maintain if TVL cost <8%. Critical for liquidity depth. AUSD/USDT has excellent volume efficiency (0.17%).
- LST pools (wstETH/WETH): Maintain if TVL cost <10%. Strategic infrastructure.
- BTC pools: Maintain Curve BTC pool (efficient at 5%). Consider reducing Uniswap WBTC pools if >15% cost.
- Lending protocols (Morpho, Euler, Curvance, Gearbox, Townsquare): Maintain. Very efficient 3-7% TVL cost, critical DeFi infrastructure.
- DEX competitors (Pancakeswap, Kuru): Maintain if TVL cost <15% and strong volume.
- Perps (Monday Trade): Maintain if TVL cost <10%. Strategic for derivatives.
- Niche assets (XAU): Reduce if TVL cost >20% unless exceptional volume.
- Zero incentive pools: Consider adding small amounts if strategic (e.g., Curve MON staking variants).

TVL COST THRESHOLDS:
- Excellent: <5%
- Good: 5-10%
- Moderate: 10-20%
- High: 20-30%
- Very High: >30% (consider taper/reduce)
- MON Pairs: Above 50% is inefficient (Uniswap MON-USDC benchmark ~50% APR). Below 50% is acceptable.

VOLUME EFFICIENCY:
- Excellent: <1%
- Good: 1-5%
- Moderate: 5-10%
- Poor: >10%

Provide:
1. Action: Specific recommendation with percentage if applicable (e.g., "Taper by 30%", "Maintain", "Increase 20%", "Reduce by 40%")
2. Notes: Brief reasoning (1-2 sentences) referencing TVL cost, volume efficiency, and strategic importance

Respond in JSON format:
{
  "action": "specific action with percentage if applicable",
  "notes": "1-2 sentence explanation with metrics"
}`;

    const response = await fetch(`${XAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-reasoning',
        messages: [
          {
            role: 'system',
            content: 'You are a DeFi analyst providing concise recommendations for incentive optimization.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      console.error(`Grok API error: ${response.status}`);
      return { action: '', notes: 'AI analysis failed' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return { action: '', notes: 'No AI response' };
    }

    // Try to parse JSON response
    try {
      const parsed = JSON.parse(content);
      return {
        action: parsed.action || '',
        notes: parsed.notes || '',
      };
    } catch {
      // If not JSON, return raw content as notes
      return { action: '', notes: content };
    }
  } catch (error) {
    console.error('Error generating AI analysis:', error);
    return { action: '', notes: 'AI analysis error' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: EnhancedCSVRequest = await request.json();
    const { pools, startDate, endDate, monPrice, protocolTVL, protocolDEXVolume, efficiencyIssues } = body;
    
    // Debug logging
    console.log('[Enhanced CSV] Received efficiencyIssues count:', efficiencyIssues?.length || 0);
    if (efficiencyIssues && efficiencyIssues.length > 0) {
      console.log('[Enhanced CSV] Sample poolIds from efficiencyIssues:', efficiencyIssues.slice(0, 3).map(ei => ei.poolId));
    }

    // Parse dates to timestamps
    const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
    const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000);

    // Fetch MON prices
    const distributionPrice = await fetchMONPriceAtDate(startTimestamp);
    const twapPrice = await calculate7DayTWAP(endTimestamp);

    // Calculate adjustment factor
    const adjustmentFactor = (twapPrice && distributionPrice && distributionPrice > 0)
      ? twapPrice / distributionPrice
      : 1;

    const currentMONPrice = monPrice || 0;

    // Group pools by protocol
    const groupedByProtocol: { [protocol: string]: typeof pools } = {};
    for (const pool of pools) {
      const protocol = pool.platform.platformProtocol;
      if (!groupedByProtocol[protocol]) {
        groupedByProtocol[protocol] = [];
      }
      groupedByProtocol[protocol].push(pool);
    }

    // Calculate grand totals
    let grandTotalMON = 0;
    let grandTotalAdjustedMON = 0;
    let grandTotalTVL = 0;
    let grandTotalVolume = 0;

    for (const pool of pools) {
      grandTotalMON += pool.market.totalMON;
      grandTotalAdjustedMON += pool.market.totalMON * adjustmentFactor;
      if (pool.market.tvl) grandTotalTVL += pool.market.tvl;
      if (pool.volumeValue) grandTotalVolume += pool.volumeValue;
    }

    // Build CSV rows
    const csvRows: string[] = [];

    // Helper to escape CSV values
    const escapeCSV = (value: string | number | null | undefined): string => {
      if (value === null || value === undefined || value === '') return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Format dates for CSV headers
    const formatDateForCSV = (dateStr: string) => {
      if (!dateStr) return '';
      const date = new Date(dateStr + 'T00:00:00Z');
      return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' });
    };

    const endDateFormatted = formatDateForCSV(endDate);
    const startDateFormatted = formatDateForCSV(startDate);

    // Header row
    csvRows.push(`Type,Protocol,,Pool,Incentive (MON),Adjusted Incentive (MON),Period (days),"TVL (as of ${endDateFormatted})","Volume (${startDateFormatted} - ${endDateFormatted})",APR (%),TVL Cost (%),Adjusted Cost Efficiency (%),Adjusted TVL Cost WoW Change (%),Volume Efficiency (%),Action Needed,Notes`);

    // Grand Total row
    const grandTotalAdjustedUSD = grandTotalAdjustedMON * currentMONPrice;
    const grandTotalTVLCost = grandTotalTVL > 0 ? (grandTotalAdjustedUSD / 7 * 365 / grandTotalTVL * 100) : 0;
    const grandTotalVolumeEfficiency = grandTotalVolume > 0 ? (grandTotalAdjustedUSD / grandTotalVolume * 100) : 0;

    // Grand Total row - skip AI analysis for aggregate rows
    csvRows.push([
      'GRAND TOTAL',
      '',
      '',
      'All Pools',
      grandTotalMON.toFixed(2),
      grandTotalAdjustedMON.toFixed(2),
      '7',
      grandTotalTVL > 0 ? grandTotalTVL.toFixed(2) : '',
      grandTotalVolume > 0 ? grandTotalVolume.toFixed(2) : '',
      '', // No aggregate APR
      grandTotalTVLCost > 0 ? grandTotalTVLCost.toFixed(2) : '',
      grandTotalTVLCost > 0 ? grandTotalTVLCost.toFixed(2) : '',
      '', // WoW change - not calculated yet
      grandTotalVolumeEfficiency > 0 ? grandTotalVolumeEfficiency.toFixed(2) : '',
      '', // No action for aggregate rows
      '', // No notes for aggregate rows
    ].join(','));

    // Process each protocol
    for (const [protocol, protocolPools] of Object.entries(groupedByProtocol)) {
      let protocolTotalMON = 0;
      let protocolTotalAdjustedMON = 0;
      let protocolTotalTVL = 0;
      let protocolTotalVolume = 0;

      // Calculate protocol subtotal
      for (const pool of protocolPools) {
        protocolTotalMON += pool.market.totalMON;
        protocolTotalAdjustedMON += pool.market.totalMON * adjustmentFactor;
        if (pool.market.tvl) protocolTotalTVL += pool.market.tvl;
        if (pool.volumeValue) protocolTotalVolume += pool.volumeValue;
      }

      // Protocol SUBTOTAL row - skip AI analysis for aggregate rows
      const subtotalAdjustedUSD = protocolTotalAdjustedMON * currentMONPrice;
      const subtotalTVLCost = protocolTotalTVL > 0 ? (subtotalAdjustedUSD / 7 * 365 / protocolTotalTVL * 100) : 0;
      const subtotalVolumeEfficiency = protocolTotalVolume > 0 ? (subtotalAdjustedUSD / protocolTotalVolume * 100) : 0;

      csvRows.push([
        `${protocol} SUBTOTAL`,
        '',
        '',
        'ALL POOLS',
        protocolTotalMON.toFixed(2),
        protocolTotalAdjustedMON.toFixed(2),
        '7',
        protocolTotalTVL > 0 ? protocolTotalTVL.toFixed(2) : '',
        protocolTotalVolume > 0 ? protocolTotalVolume.toFixed(2) : '',
        '', // No aggregate APR
        subtotalTVLCost > 0 ? subtotalTVLCost.toFixed(2) : '',
        subtotalTVLCost > 0 ? subtotalTVLCost.toFixed(2) : '',
        '', // WoW change - not calculated yet
        subtotalVolumeEfficiency > 0 ? subtotalVolumeEfficiency.toFixed(2) : '',
        '', // No action for aggregate rows
        '', // No notes for aggregate rows
      ].join(','));

      // Individual pool rows
      for (const pool of protocolPools) {
        const poolMON = pool.market.totalMON;
        const poolAdjustedMON = poolMON * adjustmentFactor;
        const poolUSD = poolMON * currentMONPrice;
        const poolAdjustedUSD = poolAdjustedMON * currentMONPrice;

        const poolTVLCost = pool.market.tvl && pool.market.tvl > 0
          ? (poolAdjustedUSD / 7 * 365 / pool.market.tvl * 100)
          : null;

        const poolVolumeEfficiency = pool.volumeValue && pool.volumeValue > 0
          ? (poolAdjustedUSD / pool.volumeValue * 100)
          : null;

        // Construct poolId (AI may use mixed case with spaces, so we'll match flexibly)
        const rawPoolId = `${pool.platform.platformProtocol}-${pool.funding.fundingProtocol}-${pool.market.marketName}`;
        
        // Try to get recommendation from efficiencyIssues only (no AI fallback to avoid delays)
        // Matching function handles normalization internally
        const poolAI = findEfficiencyIssue(rawPoolId, efficiencyIssues);
        
        // Debug logging for first few pools
        if (protocolPools.indexOf(pool) < 3) {
          const normalized = normalizePoolIdForMatching(rawPoolId);
          console.log(`[Enhanced CSV] Pool ${protocolPools.indexOf(pool) + 1}: rawPoolId="${rawPoolId}", normalized="${normalized}", matched=${!!poolAI}`);
        }
        
        // Use empty strings if no efficiency issue found (don't call AI to avoid 4-minute delays)
        const action = poolAI?.action || '';
        const notes = poolAI?.notes || '';

        csvRows.push([
          'Pool',
          pool.platform.platformProtocol,
          pool.funding.fundingProtocol,
          escapeCSV(pool.market.marketName),
          poolMON.toFixed(2),
          poolAdjustedMON.toFixed(2),
          '7',
          pool.market.tvl && pool.market.tvl > 0 ? pool.market.tvl.toFixed(2) : '',
          pool.volumeValue && pool.volumeValue > 0 ? pool.volumeValue.toFixed(2) : '',
          pool.market.apr !== null && pool.market.apr !== undefined ? pool.market.apr.toFixed(2) : '',
          poolTVLCost !== null ? poolTVLCost.toFixed(2) : '',
          poolTVLCost !== null ? poolTVLCost.toFixed(2) : '',
          '', // WoW change - not calculated yet
          poolVolumeEfficiency !== null ? poolVolumeEfficiency.toFixed(2) : '',
          escapeCSV(action),
          escapeCSV(notes),
        ].join(','));
      }

      // Protocol TOTAL row (DeFiLlama/Dune data) - skip AI analysis for aggregate rows
      const protocolKey = protocol.toLowerCase();
      const protocolTVLValue = protocolTVL[protocolKey];
      const dexVolume = protocolDEXVolume[protocolKey];
      const protocolVolume = dexVolume?.volumeInRange ?? dexVolume?.volume7d ?? dexVolume?.volume30d ?? null;

      csvRows.push([
        `${protocol} PROTOCOL TOTAL`,
        '',
        '',
        '',
        '', // No incentive MON
        '', // No adjusted incentive
        '7',
        protocolTVLValue ? protocolTVLValue.toFixed(2) : '',
        protocolVolume ? protocolVolume.toFixed(2) : '',
        '', // No APR for protocol total
        '', // No TVL cost
        '', // No adjusted cost efficiency
        '', // No WoW change
        '', // No volume efficiency
        '', // No action for aggregate rows
        '', // No notes for aggregate rows
      ].join(','));
    }

    const csvContent = csvRows.join('\n');

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="merkl-incentives-enhanced-${startDate}-${endDate}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error generating enhanced CSV:', error);
    return NextResponse.json(
      { error: 'Failed to generate enhanced CSV', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
