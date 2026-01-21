/**
 * Test script to explore DeFiLlama pools API for Uniswap pool TVL
 * Run with: node test-pool-tvl.js
 */

const DEFILLAMA_POOLS_API = 'https://yields.llama.fi/pools';

async function testDeFiLlamaPools() {
  console.log('=== Testing DeFiLlama Pools API ===\n');

  try {
    console.log('Fetching all pools from DeFiLlama...');
    const response = await fetch(DEFILLAMA_POOLS_API);

    if (!response.ok) {
      console.error(`Error: ${response.status} ${response.statusText}`);
      return;
    }

    const data = await response.json();
    console.log(`Total pools found: ${data.data?.length || 0}\n`);

    // Filter for Monad chain
    const monadPools = data.data?.filter(pool =>
      pool.chain?.toLowerCase() === 'monad'
    ) || [];

    console.log(`Monad pools found: ${monadPools.length}\n`);

    if (monadPools.length === 0) {
      console.log('No Monad pools found. Checking for similar chain names...');
      const chainNames = new Set(data.data?.map(p => p.chain) || []);
      const possibleMonad = Array.from(chainNames).filter(name =>
        name?.toLowerCase().includes('mon')
      );
      console.log('Chains with "mon" in name:', possibleMonad);
      return;
    }

    // Filter for Uniswap pools on Monad
    const uniswapPools = monadPools.filter(pool =>
      pool.project?.toLowerCase().includes('uniswap')
    );

    console.log(`Uniswap pools on Monad: ${uniswapPools.length}\n`);

    if (uniswapPools.length > 0) {
      console.log('=== Sample Uniswap Pools ===\n');

      // Show first 10 pools with their details
      uniswapPools.slice(0, 10).forEach((pool, idx) => {
        console.log(`Pool ${idx + 1}:`);
        console.log(`  Project: ${pool.project}`);
        console.log(`  Symbol: ${pool.symbol}`);
        console.log(`  TVL: $${pool.tvlUsd?.toLocaleString() || 'N/A'}`);
        console.log(`  APY: ${pool.apy?.toFixed(2)}%`);
        console.log(`  Pool ID: ${pool.pool}`);
        console.log('');
      });

      // Look for specific pools mentioned in the screenshot
      console.log('=== Looking for specific pools ===\n');

      const poolsToFind = [
        'MON-WETH',
        'MON-USDC',
        'MON-AUSD',
        'AUSD-USDC',
        'MON-WBTC',
        'WBTC-USDC'
      ];

      poolsToFind.forEach(searchPair => {
        const found = uniswapPools.filter(pool => {
          const symbol = pool.symbol?.toUpperCase() || '';
          const [token1, token2] = searchPair.split('-');
          return (symbol.includes(token1) && symbol.includes(token2));
        });

        if (found.length > 0) {
          console.log(`Found ${searchPair}:`);
          found.forEach(pool => {
            console.log(`  ${pool.symbol}: $${pool.tvlUsd?.toLocaleString()} TVL (APY: ${pool.apy?.toFixed(2)}%)`);
          });
        } else {
          console.log(`${searchPair}: Not found`);
        }
        console.log('');
      });
    } else {
      console.log('No Uniswap pools found on Monad.');
      console.log('\nAll projects on Monad:');
      const projects = new Set(monadPools.map(p => p.project));
      console.log(Array.from(projects).join(', '));
    }

    // Also check the structure of a sample pool
    if (monadPools.length > 0) {
      console.log('\n=== Sample Pool Structure ===');
      console.log(JSON.stringify(monadPools[0], null, 2));
    }

  } catch (error) {
    console.error('Error fetching pools:', error);
  }
}

// Run the test
testDeFiLlamaPools();
