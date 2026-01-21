/**
 * Test script to verify Curve TVL works with curve-dex slug
 * Run with: node test-curve-dex-tvl.js
 */

const DEFILLAMA_API_BASE = 'https://api.llama.fi';

async function testCurveDexTVL() {
  console.log('=== Testing Curve with curve-dex slug ===\n');

  try {
    const url = `${DEFILLAMA_API_BASE}/protocol/curve-dex`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      return;
    }

    const data = await response.json();

    console.log('Protocol name:', data.name);
    console.log('Total TVL:', `$${data.tvl?.toLocaleString() || 'N/A'}`);
    console.log('Chains:', data.chains?.join(', '));

    // Check currentChainTvls for Monad
    if (data.currentChainTvls) {
      const monadTVL = data.currentChainTvls['Monad'] || data.currentChainTvls['monad'];
      if (monadTVL) {
        console.log('\n✅ Current Monad TVL:', `$${monadTVL.toLocaleString()}`);
      } else {
        console.log('\n❌ No Monad TVL in currentChainTvls');
        console.log('Available chains:', Object.keys(data.currentChainTvls));
      }
    }

    // Check chainTvls for historical Monad data
    if (data.chainTvls) {
      const monadData = data.chainTvls['Monad'] || data.chainTvls['monad'];
      if (monadData && monadData.tvl && Array.isArray(monadData.tvl)) {
        console.log('\n✅ Historical Monad TVL data available');
        console.log('Latest 3 entries:');
        monadData.tvl.slice(-3).forEach(entry => {
          const date = new Date(entry.date * 1000).toISOString().split('T')[0];
          console.log(`  ${date}: $${entry.totalLiquidityUSD?.toLocaleString() || 'N/A'}`);
        });
      } else {
        console.log('\n❌ No historical Monad TVL data');
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testCurveDexTVL();
