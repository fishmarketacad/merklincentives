import { NextRequest, NextResponse } from 'next/server';

const MERKL_API_BASE = 'https://api.merkl.xyz';
const MONAD_CHAIN_ID = 143;

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
    const monTokens = ['MON', 'WMON', 'cWMON'];
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
