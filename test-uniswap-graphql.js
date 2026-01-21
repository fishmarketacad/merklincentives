/**
 * Test script to explore Uniswap GraphQL API for pool TVL
 * Run with: node test-uniswap-graphql.js
 */

const UNISWAP_GRAPHQL_API = 'https://interface.gateway.uniswap.org/v1/graphql';

// GraphQL query to get pools
const POOLS_QUERY = `
  query GetPools {
    v4Pools(
      first: 20
      orderBy: totalValueLockedUSD
      orderDirection: desc
      where: { chainId: 143 }
    ) {
      id
      token0 {
        symbol
        name
      }
      token1 {
        symbol
        name
      }
      totalValueLockedUSD
      totalValueLockedToken0
      totalValueLockedToken1
      feeTier
      volumeUSD
    }
  }
`;

// Alternative query structure (in case the first one doesn't work)
const POOLS_QUERY_ALT = `
  query GetPools {
    pools(
      first: 20
      orderBy: totalValueLockedUSD
      orderDirection: desc
      where: { chain: "monad" }
    ) {
      id
      token0Symbol
      token1Symbol
      totalValueLockedUSD
      feeTier
      volumeUSD
    }
  }
`;

// Try to search for specific pools
const SPECIFIC_POOL_QUERY = `
  query SearchPools($search: String!) {
    searchPools(
      searchQuery: $search
      chains: [MONAD]
    ) {
      id
      protocolVersion
      token0 {
        symbol
        address
      }
      token1 {
        symbol
        address
      }
      tvl
      volume24h
      feeTier
    }
  }
`;

async function testUniswapGraphQL(query, variables = {}) {
  try {
    const response = await fetch(UNISWAP_GRAPHQL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Try without API key first
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error('GraphQL Errors:', JSON.stringify(data.errors, null, 2));
      return null;
    }

    return data.data;
  } catch (error) {
    console.error('Fetch error:', error.message);
    return null;
  }
}

async function runTests() {
  console.log('=== Testing Uniswap GraphQL API ===\n');

  // Test 1: Try first query structure
  console.log('Test 1: Querying v4Pools with chainId 143 (Monad)...\n');
  let result = await testUniswapGraphQL(POOLS_QUERY);

  if (result) {
    console.log('SUCCESS! Query result:');
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Test 1 failed. Trying alternative query structure...\n');

    // Test 2: Try alternative query structure
    console.log('Test 2: Querying with alternative structure...\n');
    result = await testUniswapGraphQL(POOLS_QUERY_ALT);

    if (result) {
      console.log('SUCCESS! Query result:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('Test 2 failed. Trying search query...\n');

      // Test 3: Try search query
      console.log('Test 3: Searching for MON-WETH pool...\n');
      result = await testUniswapGraphQL(SPECIFIC_POOL_QUERY, { search: 'MON-WETH' });

      if (result) {
        console.log('SUCCESS! Query result:');
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Test 3 failed.\n');
        console.log('=== All tests failed ===');
        console.log('Possible reasons:');
        console.log('1. API requires authentication');
        console.log('2. GraphQL schema is different than expected');
        console.log('3. Monad chain not indexed in this endpoint');
        console.log('\nRecommendation: Check Uniswap docs for correct schema');
      }
    }
  }

  // Test 4: Simple introspection query to check if API is accessible
  console.log('\n\nTest 4: Checking API accessibility with introspection...\n');
  const introspectionQuery = `
    query {
      __schema {
        queryType {
          name
        }
      }
    }
  `;

  const introspection = await testUniswapGraphQL(introspectionQuery);
  if (introspection) {
    console.log('API is accessible! Schema introspection result:');
    console.log(JSON.stringify(introspection, null, 2));
  } else {
    console.log('API requires authentication or is not accessible.');
  }
}

// Run all tests
runTests();
