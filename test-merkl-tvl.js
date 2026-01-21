/**
 * Test script to check Merkl API TVL values for Uniswap pools
 * Run with: node test-merkl-tvl.js
 */

const MERKL_API_BASE = 'https://api.merkl.xyz';
const MONAD_CHAIN_ID = 143;

async function testMerklTVL() {
  console.log('=== Testing Merkl API for Uniswap Pool TVL ===\n');

  try {
    // Fetch Uniswap campaigns
    console.log('Fetching Uniswap campaigns from Merkl API...\n');
    const campaignsUrl = `${MERKL_API_BASE}/v4/campaigns?chainId=${MONAD_CHAIN_ID}&mainProtocolId=uniswap&page=0&items=100`;

    const campaignsResponse = await fetch(campaignsUrl);
    const campaigns = await campaignsResponse.json();

    console.log(`Total Uniswap campaigns: ${campaigns.length}\n`);

    if (campaigns.length === 0) {
      console.log('No Uniswap campaigns found.');
      return;
    }

    // Get unique opportunity IDs
    const opportunityIds = new Set();
    campaigns.forEach(campaign => {
      if (campaign.opportunityId) {
        opportunityIds.add(campaign.opportunityId);
      }
    });

    console.log(`Unique opportunities: ${opportunityIds.size}\n`);

    // Fetch details for first few opportunities
    const opportunitiesToCheck = Array.from(opportunityIds).slice(0, 10);

    console.log('=== Checking TVL for Sample Uniswap Pools ===\n');

    for (const oppId of opportunitiesToCheck) {
      try {
        const oppUrl = `${MERKL_API_BASE}/v4/opportunities/${oppId}`;
        const oppResponse = await fetch(oppUrl);
        const oppData = await oppResponse.json();

        const name = oppData.name || 'Unknown';
        const tvl = oppData.tvl;
        const apr = oppData.apr;

        console.log(`Pool: ${name}`);
        console.log(`  Opportunity ID: ${oppId}`);
        console.log(`  TVL from Merkl: ${tvl ? `$${tvl.toLocaleString()}` : 'N/A'}`);
        console.log(`  APR from Merkl: ${apr ? `${apr.toFixed(2)}%` : 'N/A'}`);

        // Also check campaign metrics for this opportunity
        const relatedCampaigns = campaigns.filter(c => c.opportunityId === oppId);
        if (relatedCampaigns.length > 0 && relatedCampaigns[0].campaignId) {
          const campaignId = relatedCampaigns[0].campaignId;

          try {
            const metricsUrl = `${MERKL_API_BASE}/v4/campaigns/${campaignId}/metrics`;
            const metricsResponse = await fetch(metricsUrl);
            const metrics = await metricsResponse.json();

            // Check if metrics has TVL data
            if (metrics.tvlRecords && metrics.tvlRecords.length > 0) {
              const latestTVL = metrics.tvlRecords[metrics.tvlRecords.length - 1];
              console.log(`  Latest TVL from campaign metrics: $${latestTVL.value?.toLocaleString() || 'N/A'} (${new Date(latestTVL.timestamp * 1000).toISOString().split('T')[0]})`);
            }

            if (metrics.aprRecords && metrics.aprRecords.length > 0) {
              const latestAPR = metrics.aprRecords[metrics.aprRecords.length - 1];
              console.log(`  Latest APR from campaign metrics: ${latestAPR.value?.toFixed(2)}% (${new Date(latestAPR.timestamp * 1000).toISOString().split('T')[0]})`);
            }
          } catch (metricsError) {
            console.log(`  Could not fetch campaign metrics`);
          }
        }

        console.log('');

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`Error fetching opportunity ${oppId}:`, error.message);
      }
    }

    // Look for specific pools
    console.log('\n=== Looking for Specific Pools ===\n');
    const poolsToFind = ['MON-WETH', 'MON-USDC', 'MON-AUSD', 'AUSD-USDC'];

    for (const searchPair of poolsToFind) {
      console.log(`Searching for ${searchPair}...`);

      let found = false;
      for (const oppId of opportunityIds) {
        try {
          const oppUrl = `${MERKL_API_BASE}/v4/opportunities/${oppId}`;
          const oppResponse = await fetch(oppUrl);
          const oppData = await oppResponse.json();

          const name = (oppData.name || '').toUpperCase();
          const [token1, token2] = searchPair.split('-');

          if (name.includes(token1) && name.includes(token2)) {
            found = true;
            console.log(`  Found: ${oppData.name}`);
            console.log(`    TVL: ${oppData.tvl ? `$${oppData.tvl.toLocaleString()}` : 'N/A'}`);
            console.log(`    APR: ${oppData.apr ? `${oppData.apr.toFixed(2)}%` : 'N/A'}`);
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          // Skip
        }
      }

      if (!found) {
        console.log(`  Not found`);
      }
      console.log('');
    }

  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run the test
testMerklTVL();
