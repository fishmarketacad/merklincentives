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

    // Process ALL campaigns in parallel (max concurrency)
    const results = await Promise.all(relevantCampaigns.map(async (campaign) => {
      const campaignId = campaign.id || campaign.campaignId;
      if (!campaignId) return null;

      try {
        // Fetch details and metrics in parallel
        const [detailsRes, metricsRes] = await Promise.all([
          fetch(`${MERKL_API_BASE}/v4/campaigns/${campaignId}`),
          fetch(`${MERKL_API_BASE}/v4/campaigns/${campaignId}/metrics`)
        ]);

        // Get funder ID
        let funderId = campaign.mainProtocolId?.toLowerCase() || 'unknown';
        if (detailsRes.ok) {
          const details = await detailsRes.json();
          if (details.protocol?.id) {
            funderId = details.protocol.id.toLowerCase();
          }
        }

        // Get metrics
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
    }));

    // Aggregate results
    for (const result of results) {
      if (result) {
        funderTotals[result.funderId] = (funderTotals[result.funderId] || 0) + result.totalMON;
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
