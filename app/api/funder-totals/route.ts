import { NextRequest, NextResponse } from 'next/server';

const MERKL_API_BASE = 'https://api.merkl.xyz';
const MONAD_CHAIN_ID = 143;

// Funder address to protocol name mapping
// Maps campaign creator addresses to human-readable protocol names
const FUNDER_ADDRESS_MAP: Record<string, string> = {
  // Neverland addresses
  '0x909b176220b7e782c0f3ceccab4b19d2c433c6bb': 'neverland', // Revenue multisig - MON/USDC Foundational incentives
  '0xb83a6637c87e6a7192b3ada845c0745f815e9006': 'neverland', // Partnerships multisig - DUST rewards to Balancer
  '0xcb69535abbc95a042914507f963bdd74ad0025ff': 'neverland', // Neverland-associated wallet
  // Balancer addresses
  '0xf3b4829c8b9e2910c2396538f49a12b0c2475a7e': 'balancer', // Balancer v3 Safe multisig
  // Note: 0x6cfe163e... (145 WMON) funds PancakeSwap - unknown small funder
  // Note: 0x51ee1ae1... (2425 WMON) funds credit-back campaign - unknown small funder
};

/**
 * Fast endpoint to get total MON distributed by each funder
 * Returns aggregated totals without detailed breakdowns
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const startDate = searchParams.get('startDate') || '2026-01-01';
  const endDate = searchParams.get('endDate') || new Date().toISOString().split('T')[0];

  const startTimestamp = new Date(startDate + 'T00:00:00Z').getTime();
  const endTimestamp = new Date(endDate + 'T23:59:59Z').getTime();

  try {
    // Fetch all campaigns (this is fast - just metadata)
    const campaigns: any[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${MERKL_API_BASE}/v4/campaigns?chainId=${MONAD_CHAIN_ID}&page=${page}&items=100`;
      const response = await fetch(url);
      const data = await response.json();

      const pageCampaigns = Array.isArray(data) ? data : (data.data || []);
      if (pageCampaigns.length === 0) {
        hasMore = false;
      } else {
        campaigns.push(...pageCampaigns);
        hasMore = pageCampaigns.length >= 100;
        page++;
      }
    }

    // Filter campaigns that overlap with date range and are MON tokens
    // IMPORTANT: Exclude child campaigns to prevent double counting
    // Merkl creates child campaigns when tokens flow to downstream protocols
    const monTokens = ['MON', 'WMON', 'cWMON', 'nWMON'];
    const relevantCampaigns = campaigns.filter((c: any) => {
      const tokenSymbol = c.rewardToken?.symbol || '';
      if (!monTokens.includes(tokenSymbol)) return false;

      // Skip child campaigns - they are auto-generated and cause double counting
      if (c.parentCampaignId && c.parentCampaignId !== c.id) {
        return false;
      }

      const campaignStart = parseInt(c.startTimestamp) * 1000;
      const campaignEnd = parseInt(c.endTimestamp) * 1000;
      return campaignStart <= endTimestamp && campaignEnd >= startTimestamp;
    });

    // Aggregate by funder - use mainProtocolId or creator tags
    const funderTotals: Record<string, number> = {};

    // Process campaigns in batches to avoid timeout
    const BATCH_SIZE = 50;
    const BATCH_DELAY_MS = 100;

    async function processCampaign(campaign: any): Promise<{ funderId: string; totalMON: number } | null> {
      const campaignId = campaign.id || campaign.campaignId;
      if (!campaignId) return null;

      try {
        // Get funder ID from campaign data first (no fetch needed)
        // Prefer tags[0] over creatorId if creatorId looks like an address (starts with 0x)
        let funderId = 'unknown';
        const creatorId = campaign.creator?.creatorId;
        const creatorTag = campaign.creator?.tags?.[0];

        if (creatorTag && (!creatorId || creatorId.startsWith('0x'))) {
          // Use tag if creatorId is missing or is an address
          funderId = creatorTag.toLowerCase();
        } else if (creatorId) {
          funderId = creatorId.toLowerCase();
        } else if (campaign.mainProtocolId) {
          funderId = campaign.mainProtocolId.toLowerCase();
        } else if (campaign.protocol?.id) {
          funderId = campaign.protocol.id.toLowerCase();
        }

        // Apply funder address mapping (convert addresses to protocol names)
        const mappedFunder = FUNDER_ADDRESS_MAP[funderId];
        if (mappedFunder) {
          funderId = mappedFunder;
        }

        // Calculate MON using pro-rated token amount from campaign
        // This uses actual token quantity instead of USD/price conversion
        const totalAmountWei = campaign.amount ? BigInt(campaign.amount) : BigInt(0);
        if (totalAmountWei === BigInt(0)) return null;

        // Get campaign duration (timestamps are in seconds)
        const campaignStart = parseInt(campaign.startTimestamp) * 1000;
        const campaignEnd = parseInt(campaign.endTimestamp) * 1000;
        const campaignDuration = campaignEnd - campaignStart;

        if (campaignDuration <= 0) return null;

        // Calculate overlap between campaign and query date range
        const overlapStart = Math.max(campaignStart, startTimestamp);
        const overlapEnd = Math.min(campaignEnd, endTimestamp);
        const overlapDuration = Math.max(0, overlapEnd - overlapStart);

        if (overlapDuration <= 0) return null;

        // Pro-rate the token amount based on overlap
        const totalAmountNumber = Number(totalAmountWei) / 1e18; // Convert from wei to tokens
        const totalMON = totalAmountNumber * (overlapDuration / campaignDuration);

        return totalMON > 0 ? { funderId, totalMON } : null;
      } catch (e) {
        return null;
      }
    }

    // Process in batches
    for (let i = 0; i < relevantCampaigns.length; i += BATCH_SIZE) {
      const batch = relevantCampaigns.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(processCampaign));

      // Aggregate batch results immediately
      for (const result of batchResults) {
        if (result) {
          funderTotals[result.funderId] = (funderTotals[result.funderId] || 0) + result.totalMON;
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < relevantCampaigns.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    return NextResponse.json({
      success: true,
      funderTotals,
      dateRange: { start: startDate, end: endDate },
      campaignsProcessed: relevantCampaigns.length,
    });
  } catch (error: any) {
    console.error('[Funder Totals] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
