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
    const monTokens = ['MON', 'WMON', 'cWMON'];
    const relevantCampaigns = campaigns.filter(c => {
      const tokenSymbol = c.rewardToken?.symbol || '';
      if (!monTokens.includes(tokenSymbol)) return false;

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
        let funderId = 'unknown';
        if (campaign.creator?.creatorId) {
          funderId = campaign.creator.creatorId.toLowerCase();
        } else if (campaign.creator?.tags?.[0]) {
          funderId = campaign.creator.tags[0].toLowerCase();
        } else if (campaign.mainProtocolId) {
          funderId = campaign.mainProtocolId.toLowerCase();
        } else if (campaign.protocol?.id) {
          funderId = campaign.protocol.id.toLowerCase();
        }

        // Only fetch metrics (skip details fetch since we have funder from campaign)
        const metricsRes = await fetch(`${MERKL_API_BASE}/v4/campaigns/${campaignId}/metrics`);
        if (!metricsRes.ok) return null;

        const metrics = await metricsRes.json();
        const tokenPrice = parseFloat(campaign.rewardToken?.price || '0');

        if (tokenPrice <= 0 || !metrics.dailyRewardsRecords) return null;

        // Sum MON from daily rewards in date range
        let totalMON = 0;
        for (const record of metrics.dailyRewardsRecords) {
          const timestamp = parseInt(record.timestamp) * 1000;
          if (timestamp >= startTimestamp && timestamp <= endTimestamp) {
            const usdValue = parseFloat(record.total || '0');
            if (usdValue > 0) {
              totalMON += usdValue / tokenPrice;
            }
          }
        }

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
