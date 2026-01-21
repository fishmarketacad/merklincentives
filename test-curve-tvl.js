/**
 * Test script to debug Curve TVL from DeFiLlama
 * Run with: node test-curve-tvl.js
 */

const DEFILLAMA_API_BASE = 'https://api.llama.fi';

async function testCurveTVL() {
  console.log('=== Testing Curve TVL from DeFiLlama ===\n');

  // Test 1: Current protocol endpoint
  console.log('Test 1: /protocol/curve endpoint\n');
  try {
    const url = `${DEFILLAMA_API_BASE}/protocol/curve`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
    } else {
      const data = await response.json();

      console.log('Protocol name:', data.name);
      console.log('Chains:', data.chains);
      console.log('Total TVL:', data.tvl);

      // Check chainTvls
      if (data.chainTvls) {
        console.log('\nchainTvls keys:', Object.keys(data.chainTvls));

        // Check for Monad in different cases
        if (data.chainTvls['Monad']) {
          console.log('Monad chainTvls:', data.chainTvls['Monad']);
        } else if (data.chainTvls['monad']) {
          console.log('monad chainTvls:', data.chainTvls['monad']);
        } else {
          console.log('No Monad in chainTvls');
        }
      }

      // Check currentChainTvls
      if (data.currentChainTvls) {
        console.log('\ncurrentChainTvls keys:', Object.keys(data.currentChainTvls));

        const monadTVL = data.currentChainTvls['Monad'] || data.currentChainTvls['monad'];
        if (monadTVL) {
          console.log('Current Monad TVL:', monadTVL);
        } else {
          console.log('No Monad in currentChainTvls');
        }
      }
    }
  } catch (error) {
    console.error('Test 1 error:', error.message);
  }

  // Test 2: Try TVL endpoint for Monad chain
  console.log('\n\nTest 2: /tvl/curve endpoint\n');
  try {
    const url = `${DEFILLAMA_API_BASE}/tvl/curve`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
    } else {
      const data = await response.json();
      console.log('TVL response:', data);
    }
  } catch (error) {
    console.error('Test 2 error:', error.message);
  }

  // Test 3: Check protocols list for Curve variations
  console.log('\n\nTest 3: Searching for Curve variations in protocols list\n');
  try {
    const url = `${DEFILLAMA_API_BASE}/protocols`;
    const response = await fetch(url);

    if (response.ok) {
      const protocols = await response.json();
      const curveProtocols = protocols.filter(p =>
        p.name?.toLowerCase().includes('curve') ||
        p.slug?.toLowerCase().includes('curve')
      );

      console.log(`Found ${curveProtocols.length} Curve-related protocols:`);
      curveProtocols.forEach(p => {
        console.log(`  - ${p.name} (slug: ${p.slug})`);
        console.log(`    Chains: ${p.chains?.join(', ') || 'N/A'}`);
        console.log(`    TVL: $${p.tvl?.toLocaleString() || 'N/A'}`);
      });
    }
  } catch (error) {
    console.error('Test 3 error:', error.message);
  }

  // Test 4: Check chain TVL endpoint for Monad
  console.log('\n\nTest 4: /v2/historicalChainTvl/Monad endpoint\n');
  try {
    const url = `${DEFILLAMA_API_BASE}/v2/historicalChainTvl/Monad`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
    } else {
      const data = await response.json();
      console.log('Latest entries:', data.slice(-5));
    }
  } catch (error) {
    console.error('Test 4 error:', error.message);
  }

  // Test 5: Try chart/curve endpoint
  console.log('\n\nTest 5: /chart/curve endpoint\n');
  try {
    const url = `${DEFILLAMA_API_BASE}/chart/curve`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
    } else {
      const data = await response.json();
      console.log('Sample entries:', data.slice(-3));
    }
  } catch (error) {
    console.error('Test 5 error:', error.message);
  }
}

// Run all tests
testCurveTVL();
