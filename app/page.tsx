'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface MarketResult {
  marketName: string;
  totalMON: number;
  apr?: number; // APR in percentage
  tvl?: number; // TVL in USD at the end of date range
  merklUrl?: string; // Link to Merkl opportunity/campaign page
}

interface FundingProtocolResult {
  fundingProtocol: string;
  totalMON: number;
  markets: MarketResult[];
}

interface QueryResult {
  platformProtocol: string;
  totalMON: number;
  fundingProtocols: FundingProtocolResult[];
}

interface ProtocolTVL {
  [protocol: string]: number | null;
}

interface ProtocolTVLMetadata {
  [protocol: string]: {
    isHistorical: boolean;
  };
}

interface ProtocolDEXVolume {
  [protocol: string]: {
    volumeInRange: number | null; // Volume for the exact date range
    volume24h: number | null;
    volume7d: number | null;
    volume30d: number | null;
    isHistorical: boolean;
    isMonadSpecific: boolean; // True if Monad-specific, false if all-chain fallback
  };
}

interface MarketVolume {
  volumeInRange: number | null;
  volume24h: number | null;
  volume7d: number | null;
  volume30d: number | null;
  isHistorical: boolean;
  isMonadSpecific: boolean;
  error?: string;
}

interface MarketVolumes {
  [marketKey: string]: MarketVolume; // marketKey format: "protocol-marketName"
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [protocols, setProtocols] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [monPrice, setMonPrice] = useState('0.025');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [error, setError] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [protocolTVL, setProtocolTVL] = useState<ProtocolTVL>({});
  const [protocolTVLMetadata, setProtocolTVLMetadata] = useState<ProtocolTVLMetadata>({});
  const [protocolDEXVolume, setProtocolDEXVolume] = useState<ProtocolDEXVolume>({});
  const [marketVolumes, setMarketVolumes] = useState<MarketVolumes>({});
  const [previousWeekResults, setPreviousWeekResults] = useState<QueryResult[]>([]);
  const [previousWeekProtocolTVL, setPreviousWeekProtocolTVL] = useState<ProtocolTVL>({});
  const [previousWeekProtocolDEXVolume, setPreviousWeekProtocolDEXVolume] = useState<ProtocolDEXVolume>({});
  const [previousWeekMarketVolumes, setPreviousWeekMarketVolumes] = useState<MarketVolumes>({});
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string | null; direction: 'asc' | 'desc' | null }>({ key: null, direction: null });
  
  // Handle column sorting
  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev.key !== key) {
        return { key, direction: 'asc' };
      } else if (prev.direction === 'asc') {
        return { key, direction: 'desc' };
      } else {
        return { key: null, direction: null };
      }
    });
  };
  
  // Read URL parameters on mount
  useEffect(() => {
    const urlProtocols = searchParams.get('protocols');
    const urlStartDate = searchParams.get('startDate');
    const urlEndDate = searchParams.get('endDate');
    const urlMonPrice = searchParams.get('monPrice');
    
    if (urlProtocols) {
      setProtocols(urlProtocols.split(',').filter(p => p));
    }
    if (urlStartDate) {
      setStartDate(urlStartDate);
    }
    if (urlEndDate) {
      setEndDate(urlEndDate);
    }
    if (urlMonPrice) {
      setMonPrice(urlMonPrice);
    } else {
      // Set default MON price
      setMonPrice('0.025');
    }
    setIsInitialized(true);
  }, [searchParams]);
  
  // Update URL parameters when state changes (but not during initialization)
  useEffect(() => {
    if (!isInitialized) return;
    
    const params = new URLSearchParams();
    if (protocols.length > 0) {
      params.set('protocols', protocols.join(','));
    }
    if (startDate) {
      params.set('startDate', startDate);
    }
    if (endDate) {
      params.set('endDate', endDate);
    }
    if (monPrice) {
      params.set('monPrice', monPrice);
    }
    const newURL = params.toString() ? `?${params.toString()}` : '';
    
    // Only update URL if it's different from current URL to prevent loops
    const currentURL = window.location.search;
    if (currentURL !== newURL) {
      router.replace(newURL, { scroll: false });
    }
  }, [protocols, startDate, endDate, monPrice, isInitialized, router]);

  const commonProtocols = [
    'clober',
    'curvance',
    'gearbox',
    'kuru',
    'morpho',
    'euler',
    'pancake-swap', // Note: Merkl uses "pancake-swap" with hyphen
    'monday-trade',
    'renzo',
    'upshift',
    'townsquare',
    'uniswap', // Added: Uniswap protocol
    'beefy',
    'accountable',
    'curve',
  ];

  const toggleProtocol = (protocol: string) => {
    setProtocols(prev =>
      prev.includes(protocol)
        ? prev.filter(p => p !== protocol)
        : [...prev, protocol]
    );
  };

  // Fetch protocol TVL from DeFiLlama
  const fetchProtocolTVL = async (protocolList: string[]) => {
    if (protocolList.length === 0) return;
    
    try {
      const response = await fetch('/api/protocol-tvl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          protocols: protocolList,
        }),
      });

      const data = await response.json();
      if (data.success && data.tvlData) {
        setProtocolTVL(data.tvlData);
      }
    } catch (err) {
      console.error('Error fetching protocol TVL:', err);
      // Don't show error to user, TVL is optional
    }
  };

  // Calculate previous week dates (7 days before)
  const getPreviousWeekDates = (startDateStr: string, endDateStr: string) => {
    const start = new Date(startDateStr + 'T00:00:00Z');
    const end = new Date(endDateStr + 'T00:00:00Z');
    const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    
    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - daysDiff - 1);
    
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    
    return {
      prevStartDate: prevStart.toISOString().split('T')[0],
      prevEndDate: prevEnd.toISOString().split('T')[0],
    };
  };

  // Calculate TVL Cost: (Incentives annualized / TVL) * 100
  const calculateTVLCost = (incentivesUSD: number, tvl: number, periodDays: number): number | null => {
    if (!tvl || tvl <= 0) return null;
    // Annualize: (incentives / periodDays) * 365
    const annualizedIncentives = (incentivesUSD / periodDays) * 365;
    // TVL Cost as percentage: (annualizedIncentives / TVL) * 100
    return (annualizedIncentives / tvl) * 100;
  };

  // Calculate Volume Cost: (Incentives annualized / Volume) * 100
  const calculateVolumeCost = (incentivesUSD: number, volume: number, periodDays: number): number | null => {
    if (!volume || volume <= 0) return null;
    // Annualize: (incentives / periodDays) * 365
    const annualizedIncentives = (incentivesUSD / periodDays) * 365;
    // Volume Cost as percentage: (annualizedIncentives / Volume) * 100
    return (annualizedIncentives / volume) * 100;
  };

  // Calculate WoW Change: ((Current - Previous) / Previous) * 100
  const calculateWoWChange = (current: number | null, previous: number | null): number | null => {
    if (current === null || previous === null || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  };

  // Generate tooltip content from AI analysis for a given pool
  const getAITooltip = (poolId: string, metricType: 'tvlCost' | 'tvlCostWoW' | 'volumeCost' | 'volumeCostWoW'): string | null => {
    if (!aiAnalysis) return null;

    const normalizedPoolId = poolId.toLowerCase();

    // For TVL Cost: show efficiency issues
    if (metricType === 'tvlCost' && aiAnalysis.efficiencyIssues) {
      const issue = aiAnalysis.efficiencyIssues.find((issue: any) => 
        issue.poolId.toLowerCase() === normalizedPoolId
      );
      if (issue) {
        return `${issue.issue}\n\n💡 ${issue.recommendation}`;
      }
    }

    // For WoW Changes: show explanations
    if ((metricType === 'tvlCostWoW' || metricType === 'volumeCostWoW') && aiAnalysis.wowExplanations) {
      const explanation = aiAnalysis.wowExplanations.find((exp: any) => 
        exp.poolId.toLowerCase() === normalizedPoolId
      );
      if (explanation) {
        let tooltip = explanation.explanation;
        if (explanation.competitorLinks && explanation.competitorLinks.length > 0) {
          tooltip += '\n\nCompeting pools:';
          explanation.competitorLinks.forEach((competitor: any) => {
            tooltip += `\n• ${competitor.protocol} ${competitor.marketName}`;
            if (competitor.reason) {
              tooltip += ` (${competitor.reason})`;
            }
          });
        }
        return tooltip;
      }
    }

    // For Volume Cost: check if there are volume-related insights in key findings
    if (metricType === 'volumeCost' && aiAnalysis.keyFindings) {
      // Look for volume-related findings that might mention this pool
      const volumeFindings = aiAnalysis.keyFindings.filter((finding: string) => 
        finding.toLowerCase().includes('volume') && 
        (finding.toLowerCase().includes(poolId.split('-')[0].toLowerCase()) || 
         finding.toLowerCase().includes(poolId.split('-')[1].toLowerCase()))
      );
      if (volumeFindings.length > 0) {
        return volumeFindings.join('\n\n');
      }
    }

    return null;
  };

  const handleQuery = async () => {
    if (protocols.length === 0) {
      setError('Please select at least one protocol');
      return;
    }

    if (!startDate || !endDate) {
      setError('Please select both start and end dates');
      return;
    }

    setLoading(true);
    setError('');
    setResults([]);
    setPreviousWeekResults([]);
    setPreviousWeekProtocolTVL({});
    setPreviousWeekProtocolDEXVolume({});
    setPreviousWeekMarketVolumes({});
    setAiAnalysis(null); // Clear previous AI analysis when querying new parameters
    setAiError('');

    try {
      // Calculate previous week dates
      const { prevStartDate, prevEndDate } = getPreviousWeekDates(startDate, endDate);
      const periodDays = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;

      // Fetch current week and previous week data in parallel
      const [monSpentResponse, tvlResponse, prevMonSpentResponse, prevTvlResponse] = await Promise.all([
        fetch('/api/query-mon-spent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            protocols,
            startDate,
            endDate,
            token: 'WMON',
          }),
        }),
        fetch('/api/protocol-tvl', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            protocols,
            startDate,
            endDate,
          }),
        }),
        fetch('/api/query-mon-spent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            protocols,
            startDate: prevStartDate,
            endDate: prevEndDate,
            token: 'WMON',
          }),
        }),
        fetch('/api/protocol-tvl', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            protocols,
            startDate: prevStartDate,
            endDate: prevEndDate,
          }),
        }),
      ]);

      const monSpentData = await monSpentResponse.json();
      if (!monSpentResponse.ok) {
        throw new Error(monSpentData.error || 'Failed to fetch data');
      }

      setResults(monSpentData.results || []);

      // Update TVL and DEX volume data
      const tvlData = await tvlResponse.json();
      if (tvlData.success && tvlData.tvlData) {
        setProtocolTVL(tvlData.tvlData);
      }
      if (tvlData.success && tvlData.tvlMetadata) {
        setProtocolTVLMetadata(tvlData.tvlMetadata);
      }
      if (tvlData.success && tvlData.dexVolumeData) {
        setProtocolDEXVolume(tvlData.dexVolumeData);
      }

      // Fetch previous week data (don't fail if this fails)
      let prevWeekResults: QueryResult[] = [];
      try {
        const prevMonSpentData = await prevMonSpentResponse.json();
        if (prevMonSpentResponse.ok && prevMonSpentData.results) {
          prevWeekResults = prevMonSpentData.results || [];
          setPreviousWeekResults(prevWeekResults);
        }

        const prevTvlData = await prevTvlResponse.json();
        if (prevTvlData.success && prevTvlData.tvlData) {
          setPreviousWeekProtocolTVL(prevTvlData.tvlData);
        }
        if (prevTvlData.success && prevTvlData.dexVolumeData) {
          setPreviousWeekProtocolDEXVolume(prevTvlData.dexVolumeData);
        }
      } catch (prevErr) {
        console.warn('Failed to fetch previous week data:', prevErr);
        // Continue without previous week data
      }

      // Fetch per-market volumes from Dune for previous week
      if (prevWeekResults.length > 0) {
        try {
          const prevMarkets: Array<{ protocol: string; marketName: string; tokenPair?: string }> = [];
          
          // Extract markets from previous week results
          for (const platform of prevWeekResults) {
            for (const funding of platform.fundingProtocols) {
              for (const market of funding.markets) {
                // Extract token pair from market name
                const tokenPairMatch = market.marketName.match(/([A-Z0-9a-z]+)-([A-Z0-9a-z]+)/gi);
                let tokenPair: string | undefined;
                if (tokenPairMatch && tokenPairMatch.length > 0) {
                  let longestMatch = tokenPairMatch[0];
                  for (const m of tokenPairMatch) {
                    if (m.length > longestMatch.length) {
                      longestMatch = m;
                    }
                  }
                  tokenPair = longestMatch;
                }
                
                prevMarkets.push({
                  protocol: platform.platformProtocol,
                  marketName: market.marketName,
                  tokenPair,
                });
              }
            }
          }

          if (prevMarkets.length > 0) {
            const prevMarketVolumeResponse = await fetch('/api/protocol-tvl', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                markets: prevMarkets,
                startDate: prevStartDate,
                endDate: prevEndDate,
              }),
            });

            if (prevMarketVolumeResponse.ok) {
              const prevMarketVolumeData = await prevMarketVolumeResponse.json();
              if (prevMarketVolumeData.success && prevMarketVolumeData.marketVolumes) {
                setPreviousWeekMarketVolumes(prevMarketVolumeData.marketVolumes);
              }
            }
          }
        } catch (prevMarketVolumeErr) {
          console.warn('Failed to fetch previous week per-market volumes:', prevMarketVolumeErr);
          // Continue without previous week per-market volumes
        }
      }

      // Fetch per-market volumes from Dune
      try {
        const markets: Array<{ protocol: string; marketName: string; tokenPair?: string }> = [];
        
        // Extract markets from results
        for (const platform of monSpentData.results || []) {
          for (const funding of platform.fundingProtocols) {
            for (const market of funding.markets) {
              // Extract token pair from market name (match full token names including lowercase)
              // Match the longest possible token pair (e.g., "AUSD-XAUt0", "wstETH-WETH")
              const tokenPairMatch = market.marketName.match(/([A-Z0-9a-z]+)-([A-Z0-9a-z]+)/gi);
              let tokenPair: string | undefined;
              if (tokenPairMatch && tokenPairMatch.length > 0) {
                // Get the longest match to ensure we get the full token pair
                let longestMatch = tokenPairMatch[0];
                for (const m of tokenPairMatch) {
                  if (m.length > longestMatch.length) {
                    longestMatch = m;
                  }
                }
                tokenPair = longestMatch;
              }
              
              markets.push({
                protocol: platform.platformProtocol,
                marketName: market.marketName,
                tokenPair,
              });
            }
          }
        }

        if (markets.length > 0) {
          const marketVolumeResponse = await fetch('/api/protocol-tvl', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              markets,
              startDate,
              endDate,
            }),
          });

          if (marketVolumeResponse.ok) {
            const marketVolumeData = await marketVolumeResponse.json();
            if (marketVolumeData.success && marketVolumeData.marketVolumes) {
              setMarketVolumes(marketVolumeData.marketVolumes);
            }
          }
        }
      } catch (marketVolumeErr) {
        console.warn('Failed to fetch per-market volumes:', marketVolumeErr);
        // Continue without per-market volumes
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    if (results.length === 0) return;

    // Format dates for CSV headers
    const formatDateForCSV = (dateStr: string) => {
      if (!dateStr) return '';
      const date = new Date(dateStr + 'T00:00:00Z');
      return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    };

    const endDateFormatted = formatDateForCSV(endDate);
    const startDateFormatted = formatDateForCSV(startDate);
    const dateRangeFormatted = `${startDateFormatted} - ${endDateFormatted}`;

    const csvLines = [
      `Platform Protocol,Funding Protocol,Market,Incentive,"TVL (as of ${endDateFormatted})","Volume (${dateRangeFormatted})"`
    ];
    
    for (const platform of results) {
      for (const funding of platform.fundingProtocols) {
        for (const market of funding.markets) {
          // Get per-market volume
          const marketKey = `${platform.platformProtocol}-${market.marketName}`;
          const marketVolume = marketVolumes[marketKey];
          const volumeValue = marketVolume?.volumeInRange ?? marketVolume?.volume7d ?? marketVolume?.volume30d ?? null;
          
          // Format MON value - use toFixed to avoid commas in CSV
          const monFormatted = market.totalMON.toFixed(2);
          
          // Format TVL value - use Merkl market-level TVL instead of protocol-level TVL
          // Use toFixed to avoid commas in CSV
          const tvlFormatted = market.tvl !== null && market.tvl !== undefined && market.tvl > 0
            ? market.tvl.toFixed(2)
            : '';
          
          // Format Volume value - use toFixed to avoid commas in CSV
          const volumeFormatted = volumeValue !== null && volumeValue !== undefined
            ? volumeValue.toFixed(2)
            : '';
          
          csvLines.push(
            `${platform.platformProtocol},${funding.fundingProtocol},"${market.marketName}",${monFormatted},"${tvlFormatted}","${volumeFormatted}"`
          );
        }
      }
    }

    const csv = csvLines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mon-spent-${startDate}-to-${endDate}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const totalMON = results.reduce((sum, r) => sum + r.totalMON, 0);
  const monPriceNum = parseFloat(monPrice);
  const totalUSD = !isNaN(monPriceNum) && monPriceNum > 0 ? totalMON * monPriceNum : null;

  // Helper function to find previous week market data
  const findPreviousWeekMarket = (
    platformProtocol: string,
    fundingProtocol: string,
    marketName: string
  ): MarketResult | null => {
    const prevPlatform = previousWeekResults.find(
      p => p.platformProtocol.toLowerCase() === platformProtocol.toLowerCase()
    );
    if (!prevPlatform) return null;
    
    const prevFunding = prevPlatform.fundingProtocols.find(
      f => f.fundingProtocol.toLowerCase() === fundingProtocol.toLowerCase()
    );
    if (!prevFunding) return null;
    
    const prevMarket = prevFunding.markets.find(
      m => m.marketName === marketName
    );
    return prevMarket || null;
  };

  // Prepare data for AI analysis
  const prepareAIData = () => {
    const monPriceNum = parseFloat(monPrice);
    const periodDays = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const currentPools = results.flatMap((platform) => {
      const protocolKey = platform.platformProtocol.toLowerCase();
      const dexVolume = protocolDEXVolume[protocolKey];
      const volumeValue = dexVolume?.volumeInRange ?? dexVolume?.volume7d ?? dexVolume?.volume30d ?? null;

      return platform.fundingProtocols.flatMap((funding) =>
        funding.markets.map((market) => {
          const prevMarket = findPreviousWeekMarket(
            platform.platformProtocol,
            funding.fundingProtocol,
            market.marketName
          );

          const incentiveUSD = !isNaN(monPriceNum) && monPriceNum > 0
            ? market.totalMON * monPriceNum
            : null;

          const tvlCost = market.tvl && incentiveUSD
            ? calculateTVLCost(incentiveUSD, market.tvl, periodDays)
            : null;

          const prevIncentiveUSD = prevMarket && !isNaN(monPriceNum) && monPriceNum > 0
            ? prevMarket.totalMON * monPriceNum
            : null;
          const prevTVLCost = prevMarket?.tvl && prevIncentiveUSD
            ? calculateTVLCost(prevIncentiveUSD, prevMarket.tvl, periodDays)
            : null;

          const wowChange = calculateWoWChange(tvlCost, prevTVLCost);

          return {
            protocol: platform.platformProtocol,
            fundingProtocol: funding.fundingProtocol,
            marketName: market.marketName,
            tokenPair: '', // Will be extracted on backend
            incentivesMON: market.totalMON,
            incentivesUSD: incentiveUSD,
            tvl: market.tvl || null,
            volume: volumeValue,
            apr: market.apr || null,
            tvlCost,
            wowChange,
            periodDays,
            merklUrl: market.merklUrl, // Include Merkl URL for AI analysis
          };
        })
      );
    });

    const previousPools = previousWeekResults.length > 0
      ? previousWeekResults.flatMap((platform) => {
          const protocolKey = platform.platformProtocol.toLowerCase();
          const dexVolume = previousWeekProtocolDEXVolume[protocolKey];
          const volumeValue = dexVolume?.volumeInRange ?? dexVolume?.volume7d ?? dexVolume?.volume30d ?? null;

          return platform.fundingProtocols.flatMap((funding) =>
            funding.markets.map((market) => ({
              protocol: platform.platformProtocol,
              fundingProtocol: funding.fundingProtocol,
              marketName: market.marketName,
              tokenPair: '',
              incentivesMON: market.totalMON,
              incentivesUSD: !isNaN(monPriceNum) && monPriceNum > 0 ? market.totalMON * monPriceNum : null,
              tvl: market.tvl || null,
              volume: volumeValue,
              apr: market.apr || null,
              tvlCost: null, // Will be calculated on backend if needed
              wowChange: null,
              periodDays,
            }))
          );
        })
      : null;

    return {
      currentWeek: {
        pools: currentPools,
        startDate,
        endDate,
        monPrice: !isNaN(monPriceNum) && monPriceNum > 0 ? monPriceNum : null,
      },
      previousWeek: previousPools ? {
        pools: previousPools,
        startDate: getPreviousWeekDates(startDate, endDate).prevStartDate,
        endDate: getPreviousWeekDates(startDate, endDate).prevEndDate,
      } : null,
    };
  };

  // Handle AI analysis
  const handleAIAnalysis = async () => {
    if (results.length === 0) {
      setAiError('Please query data first before running AI analysis');
      return;
    }

    setAiLoading(true);
    setAiError('');
    setAiAnalysis(null);

    try {
      const aiData = prepareAIData();
      // Include all campaigns and opportunities for comprehensive analysis
      const aiDataWithAll = {
        ...aiData,
        includeAllData: true,
      };
      const response = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(aiDataWithAll),
      });

      const data = await response.json();
      if (!response.ok) {
        const errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
        throw new Error(errorMsg || 'Failed to generate AI analysis');
      }

      if (!data.analysis) {
        throw new Error('No analysis data returned from API');
      }

      setAiAnalysis(data.analysis);
    } catch (err: any) {
      console.error('AI Analysis error:', err);
      const errorMsg = err.message || err.toString() || 'An error occurred during AI analysis';
      setAiError(errorMsg);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
      <div className="max-w-[95vw] mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <svg width="64" height="64" viewBox="0 0 182 184" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M90.5358 0C64.3911 0 0 65.2598 0 91.7593C0 118.259 64.3911 183.52 90.5358 183.52C116.681 183.52 181.073 118.258 181.073 91.7593C181.073 65.2609 116.682 0 90.5358 0ZM76.4273 144.23C65.4024 141.185 35.7608 88.634 38.7655 77.4599C41.7703 66.2854 93.62 36.2439 104.645 39.2892C115.67 42.3341 145.312 94.8846 142.307 106.059C139.302 117.234 87.4522 147.276 76.4273 144.23Z" fill="#6E54FF"/>
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">
            Merkl MON Incentives Efficiency Calculator
          </h1>
          <p className="text-gray-400 text-lg">
            Query MON incentives spent across protocols on Monad
          </p>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700/50 p-6 mb-4">
          {/* Date Range and MON Price - Single Row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wide">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border-2 border-purple-500/50 rounded-lg text-white text-lg font-medium focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all placeholder:text-gray-500"
                style={{
                  colorScheme: 'dark',
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wide">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border-2 border-purple-500/50 rounded-lg text-white text-lg font-medium focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all placeholder:text-gray-500"
                style={{
                  colorScheme: 'dark',
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wide">
                MON Price (USD) <span className="text-xs text-gray-500 normal-case font-normal">(optional)</span>
              </label>
              <input
                type="number"
                value={monPrice}
                onChange={e => setMonPrice(e.target.value)}
                placeholder="Enter MON price in USD"
                step="0.01"
                min="0"
                className="w-full px-4 py-3 bg-gray-900/50 border-2 border-purple-500/50 rounded-lg text-white text-lg font-medium focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 transition-all placeholder:text-gray-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Enter MON price at snapshot date
              </p>
            </div>
          </div>

          {/* Protocol Selection */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wide">
              Select Protocols
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {commonProtocols.map(protocol => (
                <label
                  key={protocol}
                  className={`flex items-center space-x-2 cursor-pointer p-2 rounded-lg border-2 transition-all ${
                    protocols.includes(protocol)
                      ? 'bg-purple-600/20 border-purple-500 text-white'
                      : 'bg-gray-900/30 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={protocols.includes(protocol)}
                    onChange={() => toggleProtocol(protocol)}
                    className="w-5 h-5 text-purple-600 focus:ring-purple-500 border-gray-600 rounded bg-gray-800"
                  />
                  <span className="text-sm font-medium capitalize">
                    {protocol.replace('-', ' ')}
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2 font-medium">
              Selected: <span className="text-purple-400 font-bold">{protocols.length}</span> protocol{protocols.length !== 1 ? 's' : ''}
          </p>
        </div>

          {/* Query Button */}
          <button
            onClick={handleQuery}
            disabled={loading}
            className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:from-purple-500 hover:to-purple-600 disabled:from-gray-700 disabled:to-gray-800 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-purple-500/50 transform hover:scale-[1.02] active:scale-[0.98]"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Querying...
              </span>
            ) : (
              'Query MON Spent'
            )}
          </button>

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-3 bg-red-900/30 border-2 border-red-500/50 rounded-lg text-red-300 text-sm font-medium">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700/50 p-6">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Results</h2>
                <div className="text-xs text-gray-400 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                    <span>
                      <strong>APR</strong>, <strong>TVL</strong>, and <strong>Volume</strong> are historical values at the end of your date range, not the current values.
                    </span>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleAIAnalysis}
                  disabled={aiLoading || results.length === 0}
                  className="px-5 py-2.5 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-500 transition-all shadow-lg hover:shadow-purple-500/50 transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:from-gray-700 disabled:to-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {aiLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      AI Analysis
                    </>
                  )}
                </button>
                <button
                  onClick={exportToCSV}
                  className="px-5 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-500 transition-all shadow-lg hover:shadow-green-500/50 transform hover:scale-105 active:scale-95 flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Export CSV
                </button>
              </div>
            </div>

            {/* AI Analysis Error */}
            {aiError && (
              <div className="mb-4 p-3 bg-red-900/30 border-2 border-red-500/50 rounded-lg text-red-300 text-sm font-medium">
                {aiError}
              </div>
            )}

            {/* AI Analysis Results */}
            {aiAnalysis && (
              <div className="mb-6 bg-purple-900/20 border-2 border-purple-500/50 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    AI Analysis Insights
                  </h3>
                  <button
                    onClick={(e) => {
                      const analysisText = JSON.stringify(aiAnalysis, null, 2);
                      navigator.clipboard.writeText(analysisText);
                      // Show temporary feedback
                      const btn = e.currentTarget;
                      const originalHTML = btn.innerHTML;
                      btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Copied!';
                      btn.classList.add('bg-green-500');
                      setTimeout(() => {
                        btn.innerHTML = originalHTML;
                        btn.classList.remove('bg-green-500');
                      }, 2000);
                    }}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                    title="Copy analysis to clipboard"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </button>
                </div>

                {/* Key Findings */}
                {aiAnalysis.keyFindings && aiAnalysis.keyFindings.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-lg font-semibold text-purple-300 mb-3">Key Findings</h4>
                    <ul className="space-y-2">
                      {aiAnalysis.keyFindings.map((finding: string, idx: number) => (
                        <li key={idx} className="text-gray-300 flex items-start gap-2">
                          <span className="text-purple-400 mt-1">•</span>
                          <span>{finding}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Efficiency Issues */}
                {aiAnalysis.efficiencyIssues && aiAnalysis.efficiencyIssues.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-lg font-semibold text-purple-300 mb-3">Efficiency Issues</h4>
                    <div className="space-y-3">
                      {aiAnalysis.efficiencyIssues.map((issue: any, idx: number) => (
                        <div key={idx} className="bg-gray-900/50 rounded-lg p-4 border-l-4 border-purple-500">
                          <div className="flex items-start justify-between mb-2">
                            <span className="text-white font-medium">{issue.poolId}</span>
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${
                              issue.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                              issue.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-blue-500/20 text-blue-400'
                            }`}>
                              {issue.severity.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-gray-400 text-sm mb-2">{issue.issue}</p>
                          <p className="text-purple-300 text-sm font-medium">💡 {issue.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* WoW Explanations */}
                {aiAnalysis.wowExplanations && aiAnalysis.wowExplanations.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-lg font-semibold text-purple-300 mb-3">Week-over-Week Change Explanations</h4>
                    <div className="space-y-3">
                      {aiAnalysis.wowExplanations.map((explanation: any, idx: number) => (
                        <div key={idx} className="bg-gray-900/50 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white font-medium">{explanation.poolId}</span>
                            <span className={`px-2 py-1 rounded text-sm font-semibold ${
                              explanation.change > 10 ? 'bg-red-500/20 text-red-400' :
                              explanation.change < -10 ? 'bg-green-500/20 text-green-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>
                              {explanation.change > 0 ? '+' : ''}{explanation.change.toFixed(2)}%
                            </span>
                          </div>
                          <p className="text-gray-300 text-sm mb-1">{explanation.explanation}</p>
                          <p className="text-gray-400 text-xs mb-2">Likely cause: {explanation.likelyCause}</p>
                          {explanation.competitorLinks && explanation.competitorLinks.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-700">
                              <p className="text-gray-400 text-xs mb-1">Competing pools:</p>
                              {explanation.competitorLinks.map((competitor: any, cIdx: number) => (
                                <div key={cIdx} className="text-xs text-gray-300 mb-1">
                                  <span className="text-purple-300">{competitor.protocol} {competitor.marketName}</span>
                                  {competitor.merklUrl && (
                                    <a 
                                      href={competitor.merklUrl} 
            target="_blank"
            rel="noopener noreferrer"
                                      className="ml-2 text-purple-400 hover:text-purple-300 underline"
                                    >
                                      [View on Merkl]
                                    </a>
                                  )}
                                  {competitor.reason && (
                                    <span className="text-gray-400 ml-2">({competitor.reason})</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0 && (
                  <div>
                    <h4 className="text-lg font-semibold text-purple-300 mb-3">Recommendations</h4>
                    <ul className="space-y-2">
                      {aiAnalysis.recommendations.map((rec: string, idx: number) => (
                        <li key={idx} className="text-gray-300 flex items-start gap-2">
                          <span className="text-green-400 mt-1">✓</span>
                          <span>{rec}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Table View */}
            <div className="overflow-x-auto mb-6 relative overflow-y-visible">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('protocol'); }} className="hover:text-white flex items-center gap-1 cursor-pointer">
                          Protocol
                          {sortConfig.key === 'protocol' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute left-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          The DeFi protocol/platform where the liquidity pool exists (e.g., Uniswap, Curve, PancakeSwap)
                        </div>
                      </div>
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('fundingProtocol'); }} className="hover:text-white flex items-center gap-1 cursor-pointer">
                          Funding Protocol
                          {sortConfig.key === 'fundingProtocol' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute left-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          The protocol that provided the MON incentives for this pool (e.g., Upshift, Townsquare)
                        </div>
                      </div>
                    </th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('market'); }} className="hover:text-white flex items-center gap-1 cursor-pointer">
                          Market
                          {sortConfig.key === 'market' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute left-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          The specific liquidity pool/market name. Click to view on Merkl.
                        </div>
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block ml-auto cursor-help">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('incentiveMON'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                          Incentive (MON)
                          {sortConfig.key === 'incentiveMON' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          Total MON tokens distributed as incentives during the selected date range. Calculated from Merkl campaign daily rewards converted to MON using token price.
                        </div>
                      </div>
                    </th>
                    {monPrice && parseFloat(monPrice) > 0 && (
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                        <div className="group relative inline-block ml-auto cursor-help">
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('incentiveUSD'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                            Incentive (USD)
                            {sortConfig.key === 'incentiveUSD' && (
                              <span className="text-purple-400">
                                {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                              </span>
                            )}
                          </button>
                          <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                            USD value of MON incentives. Calculated as: Incentive (MON) × MON Price
                          </div>
                        </div>
                      </th>
                    )}
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block ml-auto cursor-help">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('period'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                          Period (days)
                          {sortConfig.key === 'period' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          Number of days in the selected date range (inclusive of start and end dates)
                        </div>
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block ml-auto cursor-help">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('tvl'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                          TVL (as of {endDate})
                          {sortConfig.key === 'tvl' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          Total Value Locked in the pool as of the end date. Historical TVL from Merkl campaign metrics, or current TVL if historical data unavailable.
                        </div>
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block ml-auto cursor-help">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('tvlCost'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                          TVL Cost (%)
                          {sortConfig.key === 'tvlCost' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          Annualized cost to attract TVL. Formula: (Incentives annualized / TVL) × 100. Lower is better. Red: &gt;50%, Yellow: &gt;20%, Green: ≤20%
                        </div>
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block ml-auto cursor-help">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('tvlCostWoW'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                          TVL Cost WoW Change (%)
                          {sortConfig.key === 'tvlCostWoW' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          Week-over-week percentage change in TVL Cost. Negative (green) is better (cost decreased). Red: &gt;10% increase, Green: &lt;-10% decrease
                        </div>
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block ml-auto cursor-help">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('volume'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                          Volume ({startDate} - {endDate})
                          {sortConfig.key === 'volume' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          Trading volume for this specific pool during the date range. Fetched from Dune Analytics (Monad-specific). Shows "Not Found" if data unavailable.
                        </div>
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block ml-auto cursor-help">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('volumeCost'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                          Volume Cost (%)
                          {sortConfig.key === 'volumeCost' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          Annualized cost per volume. Formula: (Incentives annualized / Volume) × 100. Lower is better. Shows "-" for lending protocols or when volume unavailable.
                        </div>
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block ml-auto cursor-help">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('volumeCostWoW'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                          Volume Cost WoW Change (%)
                          {sortConfig.key === 'volumeCostWoW' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case">
                          Week-over-week percentage change in Volume Cost. Negative (green) is better (cost decreased). Red: &gt;10% increase, Green: &lt;-10% decrease. Shows "-" when volume unavailable.
                        </div>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Flatten all rows first
                    const allRows = results.flatMap((platform) => {
                      const protocolKey = platform.platformProtocol.toLowerCase();
                      const monPriceNum = parseFloat(monPrice);
                      const periodDays = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;

                      return platform.fundingProtocols.flatMap((funding) =>
                        funding.markets.map((market, marketIdx) => {
                        // Get per-market volume from Dune
                        const marketKey = `${platform.platformProtocol}-${market.marketName}`;
                        const marketVolume = marketVolumes[marketKey];
                        const volumeValue = marketVolume?.volumeInRange ?? marketVolume?.volume7d ?? marketVolume?.volume30d ?? null;
                        const volumeError = marketVolume?.error;
                        const prevMarket = findPreviousWeekMarket(
                          platform.platformProtocol,
                          funding.fundingProtocol,
                          market.marketName
                        );
                        
                        // Calculate USD incentive
                        const incentiveUSD = !isNaN(monPriceNum) && monPriceNum > 0
                          ? market.totalMON * monPriceNum
                          : null;
                        
                        // Calculate TVL Cost (annualized incentives / TVL * 100)
                        const tvlCost = market.tvl && incentiveUSD
                          ? calculateTVLCost(incentiveUSD, market.tvl, periodDays)
                          : null;
                        
                        // Calculate previous week TVL Cost
                        const prevIncentiveUSD = prevMarket && !isNaN(monPriceNum) && monPriceNum > 0
                          ? prevMarket.totalMON * monPriceNum
                          : null;
                        const prevTVLCost = prevMarket?.tvl && prevIncentiveUSD
                          ? calculateTVLCost(prevIncentiveUSD, prevMarket.tvl, periodDays)
                          : null;
                        
                        // Calculate WoW Change for TVL Cost
                        const wowChange = calculateWoWChange(tvlCost, prevTVLCost);
                        
                        // Calculate Volume Cost (annualized incentives / volume * 100)
                        const volumeCost = volumeValue && incentiveUSD && !volumeError
                          ? calculateVolumeCost(incentiveUSD, volumeValue, periodDays)
                          : null;
                        
                        // Calculate previous week Volume Cost
                        const prevVolumeValue = prevMarket ? (() => {
                          const prevMarketKey = `${platform.platformProtocol}-${prevMarket.marketName}`;
                          const prevMarketVolume = previousWeekMarketVolumes[prevMarketKey];
                          return prevMarketVolume?.volumeInRange ?? prevMarketVolume?.volume7d ?? prevMarketVolume?.volume30d ?? null;
                        })() : null;
                        const prevVolumeError = prevMarket ? (() => {
                          const prevMarketKey = `${platform.platformProtocol}-${prevMarket.marketName}`;
                          const prevMarketVolume = previousWeekMarketVolumes[prevMarketKey];
                          return prevMarketVolume?.error;
                        })() : null;
                        const prevVolumeCost = prevVolumeValue && prevIncentiveUSD && !prevVolumeError
                          ? calculateVolumeCost(prevIncentiveUSD, prevVolumeValue, periodDays)
                          : null;
                        
                        // Calculate WoW Change for Volume Cost
                        const volumeWowChange = calculateWoWChange(volumeCost, prevVolumeCost);
                        
                        return {
                          platform,
                          funding,
                          market,
                          marketIdx,
                          protocolKey,
                          monPriceNum,
                          periodDays,
                          marketKey,
                          marketVolume,
                          volumeValue,
                          volumeError,
                          prevMarket,
                          incentiveUSD,
                          tvlCost,
                          prevIncentiveUSD,
                          prevTVLCost,
                          wowChange,
                          volumeCost,
                          prevVolumeValue,
                          prevVolumeError,
                          prevVolumeCost,
                          volumeWowChange,
                        };
                      })
                    );
                  });

                    // Sort rows if sortConfig is set
                    let sortedRows = allRows;
                    if (sortConfig.key && sortConfig.direction) {
                      sortedRows = [...allRows].sort((a, b) => {
                        let aValue: any;
                        let bValue: any;

                        switch (sortConfig.key) {
                          case 'protocol':
                            aValue = a.platform.platformProtocol.toLowerCase();
                            bValue = b.platform.platformProtocol.toLowerCase();
                            break;
                          case 'fundingProtocol':
                            aValue = a.funding.fundingProtocol.toLowerCase();
                            bValue = b.funding.fundingProtocol.toLowerCase();
                            break;
                          case 'market':
                            aValue = a.market.marketName.toLowerCase();
                            bValue = b.market.marketName.toLowerCase();
                            break;
                          case 'incentiveMON':
                            aValue = a.market.totalMON;
                            bValue = b.market.totalMON;
                            break;
                          case 'incentiveUSD':
                            aValue = a.incentiveUSD ?? 0;
                            bValue = b.incentiveUSD ?? 0;
                            break;
                          case 'period':
                            aValue = a.periodDays;
                            bValue = b.periodDays;
                            break;
                          case 'tvl':
                            aValue = a.market.tvl ?? 0;
                            bValue = b.market.tvl ?? 0;
                            break;
                          case 'tvlCost':
                            aValue = a.tvlCost ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            bValue = b.tvlCost ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            break;
                          case 'tvlCostWoW':
                            aValue = a.wowChange ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            bValue = b.wowChange ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            break;
                          case 'volume':
                            aValue = a.volumeValue ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            bValue = b.volumeValue ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            break;
                          case 'volumeCost':
                            aValue = a.volumeCost ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            bValue = b.volumeCost ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            break;
                          case 'volumeCostWoW':
                            aValue = a.volumeWowChange ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            bValue = b.volumeWowChange ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                            break;
                          default:
                            return 0;
                        }

                        // Handle string comparison
                        if (typeof aValue === 'string' && typeof bValue === 'string') {
                          if (sortConfig.direction === 'asc') {
                            return aValue.localeCompare(bValue);
                          } else {
                            return bValue.localeCompare(aValue);
                          }
                        }

                        // Handle numeric comparison
                        if (sortConfig.direction === 'asc') {
                          return (aValue ?? 0) - (bValue ?? 0);
                        } else {
                          return (bValue ?? 0) - (aValue ?? 0);
                        }
                      });
                    }

                    // Render sorted rows
                    return sortedRows.map((row) => (
                      <tr key={`${row.platform.platformProtocol}-${row.funding.fundingProtocol}-${row.marketIdx}`} className="border-b border-gray-800 hover:bg-gray-800/30">
                            <td className="py-3 px-4 text-sm text-white capitalize">{row.platform.platformProtocol.replace('-', ' ')}</td>
                            <td className="py-3 px-4 text-sm text-gray-300 capitalize">{row.funding.fundingProtocol.replace('-', ' ')}</td>
                            <td className="py-3 px-4 text-sm text-gray-400">
                              {row.market.merklUrl ? (
                                <a href={row.market.merklUrl} target="_blank" rel="noopener noreferrer" className="hover:text-purple-400 underline">
                                  {row.market.marketName}
                                </a>
                              ) : (
                                row.market.marketName
                              )}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-white font-medium">
                              {row.market.totalMON.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            {monPrice && parseFloat(monPrice) > 0 && (
                              <td className="py-3 px-4 text-sm text-right text-gray-300">
                                {row.incentiveUSD ? `$${row.incentiveUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}
                              </td>
                            )}
                            <td className="py-3 px-4 text-sm text-right text-gray-400">{row.periodDays}</td>
                            <td className="py-3 px-4 text-sm text-right text-gray-300">
                              {row.market.tvl ? `$${(row.market.tvl / 1000000).toFixed(2)}M` : '-'}
                            </td>
                            <td className={`py-3 px-4 text-sm text-right font-medium ${
                              row.tvlCost && row.tvlCost > 50 ? 'text-red-400' : row.tvlCost && row.tvlCost > 20 ? 'text-yellow-400' : 'text-green-400'
                            }`}>
                              {(() => {
                                const poolId = `${row.platform.platformProtocol}-${row.funding.fundingProtocol}-${row.market.marketName}`;
                                const tooltip = getAITooltip(poolId, 'tvlCost');
                                const content = row.tvlCost !== null ? `${row.tvlCost.toFixed(2)}%` : '-';
                                
                                if (tooltip) {
                                  return (
                                    <div className="group relative inline-block cursor-help">
                                      <span className="underline decoration-dotted decoration-purple-400/50 hover:decoration-purple-400">
                                        {content}
                                      </span>
                                      <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-80 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-pre-line normal-case">
                                        {tooltip}
                                      </div>
                                    </div>
                                  );
                                }
                                return content;
                              })()}
                            </td>
                            <td className={`py-3 px-4 text-sm text-right font-medium ${
                              row.wowChange !== null && row.wowChange > 10 ? 'text-red-400' : row.wowChange !== null && row.wowChange < -10 ? 'text-green-400' : 'text-gray-400'
                            }`}>
                              {(() => {
                                const poolId = `${row.platform.platformProtocol}-${row.funding.fundingProtocol}-${row.market.marketName}`;
                                const tooltip = getAITooltip(poolId, 'tvlCostWoW');
                                const content = row.wowChange !== null ? `${row.wowChange > 0 ? '+' : ''}${row.wowChange.toFixed(2)}%` : '-';
                                
                                if (tooltip) {
                                  return (
                                    <div className="group relative inline-block cursor-help">
                                      <span className="underline decoration-dotted decoration-purple-400/50 hover:decoration-purple-400">
                                        {content}
                                      </span>
                                      <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-80 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-pre-line normal-case">
                                        {tooltip}
                                      </div>
                                    </div>
                                  );
                                }
                                return content;
                              })()}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-gray-300">
                              {row.volumeError ? (
                                <span className="text-red-400 text-xs" title={row.volumeError}>Not Found</span>
                              ) : row.volumeValue ? (
                                `$${(row.volumeValue / 1000000).toFixed(2)}M`
                              ) : (
                                '-'
                              )}
                            </td>
                            <td className={`py-3 px-4 text-sm text-right font-medium ${
                              row.volumeCost && row.volumeCost > 50 ? 'text-red-400' : row.volumeCost && row.volumeCost > 20 ? 'text-yellow-400' : row.volumeCost !== null ? 'text-green-400' : 'text-gray-400'
                            }`}>
                              {(() => {
                                const poolId = `${row.platform.platformProtocol}-${row.funding.fundingProtocol}-${row.market.marketName}`;
                                const tooltip = getAITooltip(poolId, 'volumeCost');
                                const content = row.volumeCost !== null ? `${row.volumeCost.toFixed(2)}%` : '-';
                                
                                if (tooltip) {
                                  return (
                                    <div className="group relative inline-block cursor-help">
                                      <span className="underline decoration-dotted decoration-purple-400/50 hover:decoration-purple-400">
                                        {content}
                                      </span>
                                      <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-80 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-pre-line normal-case">
                                        {tooltip}
                                      </div>
                                    </div>
                                  );
                                }
                                return content;
                              })()}
                            </td>
                            <td className={`py-3 px-4 text-sm text-right font-medium ${
                              row.volumeWowChange !== null && row.volumeWowChange > 10 ? 'text-red-400' : row.volumeWowChange !== null && row.volumeWowChange < -10 ? 'text-green-400' : 'text-gray-400'
                            }`}>
                              {(() => {
                                const poolId = `${row.platform.platformProtocol}-${row.funding.fundingProtocol}-${row.market.marketName}`;
                                const tooltip = getAITooltip(poolId, 'volumeCostWoW');
                                const content = row.volumeWowChange !== null ? `${row.volumeWowChange > 0 ? '+' : ''}${row.volumeWowChange.toFixed(2)}%` : '-';
                                
                                if (tooltip) {
                                  return (
                                    <div className="group relative inline-block cursor-help">
                                      <span className="underline decoration-dotted decoration-purple-400/50 hover:decoration-purple-400">
                                        {content}
                                      </span>
                                      <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-80 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-pre-line normal-case">
                                        {tooltip}
                                      </div>
                                    </div>
                                  );
                                }
                                return content;
                              })()}
                            </td>
                          </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>

            {/* Original Hierarchical View (Collapsible) */}
            <details className="mt-6" open>
              <summary className="cursor-pointer text-purple-400 hover:text-purple-300 font-semibold mb-4">
                View Hierarchical Breakdown
              </summary>
              <div className="space-y-4 mt-4">
              {results.map((platform, platformIdx) => {
                const protocolKey = platform.platformProtocol.toLowerCase();
                const protocolTVLValue = protocolTVL[protocolKey];
                const tvlMetadata = protocolTVLMetadata[protocolKey];
                const isHistorical = tvlMetadata?.isHistorical ?? false;
                const dexVolume = protocolDEXVolume[protocolKey];
                
                // Format volume helper function
                const formatVolume = (volume: number | null | undefined) => {
                  if (volume === null || volume === undefined) return null;
                  if (volume >= 1000000) {
                    return `$${(volume / 1000000).toFixed(2)}M`;
                  } else if (volume >= 1000) {
                    return `$${(volume / 1000).toFixed(2)}K`;
                  } else {
                    return `$${volume.toFixed(2)}`;
                  }
                };
                
                return (
                  <div key={platformIdx} className="border-l-4 border-purple-500/50 pl-4 py-2 hover:border-purple-500 transition-all">
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-700">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-xl font-bold text-white capitalize flex items-center gap-2">
                          <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                          {platform.platformProtocol.replace('-', ' ')} Protocol
                        </h3>
                        {protocolTVLValue !== null && protocolTVLValue !== undefined && (
                          <span className="text-sm text-blue-400 font-semibold bg-blue-500/10 px-2 py-1 rounded flex items-center gap-1">
                            {protocolTVLValue >= 1000000 
                              ? `$${(protocolTVLValue / 1000000).toFixed(2)}M TVL`
                              : protocolTVLValue >= 1000
                              ? `$${(protocolTVLValue / 1000).toFixed(2)}K TVL`
                              : `$${protocolTVLValue.toFixed(2)} TVL`}
                            {!isHistorical && (
                              <span 
                                className="inline-flex items-center cursor-help"
                                title="This TVL is current (not historical). Historical TVL data for this date range is not available from DeFiLlama, so we're showing the current TVL instead."
                              >
                                <svg 
                                  className="w-3 h-3" 
                                  fill="none" 
                                  stroke="currentColor" 
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </span>
                            )}
                          </span>
                        )}
                        {dexVolume && (dexVolume.volumeInRange !== null || dexVolume.volume7d !== null || dexVolume.volume30d !== null) && (
                          <span className="text-sm text-green-400 font-semibold bg-green-500/10 px-2 py-1 rounded flex items-center gap-1">
                            {dexVolume.volumeInRange !== null ? (
                              <span title={`DEX Volume for your date range (${startDate} to ${endDate})${!dexVolume.isMonadSpecific ? ' - Note: This is all-chain volume, not Monad-specific' : ''}`}>
                                {formatVolume(dexVolume.volumeInRange)} Vol
                              </span>
                            ) : dexVolume.volume7d !== null ? (
                              <span title={`DEX Volume (7d) - Date range volume not available, showing 7d as fallback${!dexVolume.isMonadSpecific ? ' - Note: This is all-chain volume, not Monad-specific' : ''}`}>
                                {formatVolume(dexVolume.volume7d)} Vol 7d
                              </span>
                            ) : dexVolume.volume30d !== null ? (
                              <span title={`DEX Volume (30d) - Date range volume not available, showing 30d as fallback${!dexVolume.isMonadSpecific ? ' - Note: This is all-chain volume, not Monad-specific' : ''}`}>
                                {formatVolume(dexVolume.volume30d)} Vol 30d
                              </span>
                            ) : null}
                            {!dexVolume.isMonadSpecific && (
                              <span 
                                className="inline-flex items-center cursor-help text-yellow-400"
                                title="⚠️ WARNING: This volume is all-chain (not Monad-specific). DeFiLlama does not provide Monad-specific volume breakdown for this protocol, so we're showing total volume across all chains. This number will be much higher than actual Monad volume."
                              >
                                <svg 
                                  className="w-3 h-3" 
                                  fill="none" 
                                  stroke="currentColor" 
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                              </span>
                            )}
                            {dexVolume.isMonadSpecific && !dexVolume.isHistorical && (
                              <span 
                                className="inline-flex items-center cursor-help"
                                title="This volume is current (not historical). Historical volume data for this date range is not available from DeFiLlama."
                              >
                                <svg 
                                  className="w-3 h-3" 
                                  fill="none" 
                                  stroke="currentColor" 
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      <span className="text-lg font-bold text-purple-400">
                        {platform.totalMON.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} MON
                      </span>
                    </div>

                  <div className="space-y-2">
                    {platform.fundingProtocols.map((funding, fundingIdx) => (
                      <div key={fundingIdx} className="ml-4 border-l-2 border-purple-500/50 pl-4 py-1">
                        <div className="flex justify-between items-center mb-1">
                          <h4 className="text-md font-semibold text-gray-200 capitalize flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-purple-400 rounded-full"></span>
                            Funded by: <span className="text-purple-400">{funding.fundingProtocol.replace('-', ' ')}</span>
                          </h4>
                          <span className="text-sm font-bold text-gray-300 bg-gray-800 px-3 py-1 rounded-lg">
                            {funding.totalMON.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })} MON
                          </span>
                        </div>
                        
                        <div className="ml-6 space-y-1">
                          {funding.markets.map((market, marketIdx) => (
                            <div key={marketIdx} className="flex justify-between items-center text-sm text-gray-400 py-1 gap-4">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {market.merklUrl ? (
                                  <a
                                    href={market.merklUrl}
            target="_blank"
            rel="noopener noreferrer"
                                    className="font-medium hover:text-purple-400 transition-colors underline decoration-purple-500/50 hover:decoration-purple-400 truncate min-w-0"
                                    title={`View ${market.marketName} on Merkl`}
                                  >
                                    {market.marketName}
                                  </a>
                                ) : (
                                  <span className="font-medium truncate min-w-0" title={market.marketName}>
                                    {market.marketName}
                                  </span>
                                )}
                                {market.apr !== undefined && (
                                  <span 
                                    className="text-xs text-purple-400 font-semibold bg-purple-500/10 px-2 py-0.5 rounded cursor-help flex-shrink-0"
                                    title="APR (Annual Percentage Rate) represents the annualized return from Merkl incentives. This value shows the APR at the end of your selected date range, calculated from campaign metrics. APR = (Daily Rewards / TVL) × 365 × 100"
                                  >
                                    {market.apr.toFixed(2)}% APR
                                  </span>
                                )}
                                {market.tvl !== undefined && (
                                  <span 
                                    className="text-xs text-blue-400 font-semibold bg-blue-500/10 px-2 py-0.5 rounded cursor-help flex-shrink-0"
                                    title="TVL (Total Value Locked) shows the total value locked in this market at the end of your selected date range, in USD"
                                  >
                                    {market.tvl >= 1000000 
                                      ? `$${(market.tvl / 1000000).toFixed(2)}M TVL`
                                      : market.tvl >= 1000
                                      ? `$${(market.tvl / 1000).toFixed(2)}K TVL`
                                      : `$${market.tvl.toFixed(2)} TVL`}
                                  </span>
                                )}
        </div>
                              <span className="whitespace-nowrap text-gray-300 font-semibold flex-shrink-0">
                                {market.totalMON.toLocaleString(undefined, {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })} MON
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                );
              })}
              </div>
            </details>

            {/* Grand Total */}
            <div className="border-t-2 border-purple-500/50 pt-4 mt-4">
              <div className="flex justify-between items-center">
                <span className="text-xl font-bold text-white uppercase tracking-wide">Grand Total</span>
                <div className="text-right">
                  <div className="text-2xl font-bold text-purple-400">
                    {totalMON.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} MON
                  </div>
                  {totalUSD !== null && (
                    <div className="text-lg font-semibold text-gray-300 mt-1">
                      ${totalUSD.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} USD
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-700 text-sm text-gray-400">
              <p className="font-medium">
                Date Range: <span className="text-purple-400">{startDate}</span> to <span className="text-purple-400">{endDate}</span>
              </p>
              <p className="mt-1 text-gray-500">
                Note: Multiply MON amounts by MON price from snapshot date to get USD values
              </p>
            </div>
          </div>
        )}
        </div>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}
