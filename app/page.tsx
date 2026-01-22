'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
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

interface DashboardCache {
  endDate: string; // Used to validate if cache is still valid
  startDate: string;
  monPrice: string;
  protocols: string[];
  results: QueryResult[];
  previousWeekResults: QueryResult[];
  protocolTVL: ProtocolTVL;
  protocolTVLMetadata: ProtocolTVLMetadata;
  protocolDEXVolume: ProtocolDEXVolume;
  marketVolumes: MarketVolumes;
  previousWeekProtocolTVL: ProtocolTVL;
  previousWeekProtocolDEXVolume: ProtocolDEXVolume;
  previousWeekMarketVolumes: MarketVolumes;
  aiAnalysis: any | null;
  timestamp: number;
}

// Date utility functions for auto-refresh
const getYesterdayUTC = (): string => {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().split('T')[0];
};

const getSevenDaysAgoUTC = (): string => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 8); // 8 days ago to get 7 days before yesterday
  return sevenDaysAgo.toISOString().split('T')[0];
};

// Cache management functions
const saveDashboardCache = (cache: DashboardCache): void => {
  try {
    localStorage.setItem('dashboardCache', JSON.stringify(cache));
  } catch (err) {
    console.warn('Failed to save dashboard cache:', err);
  }
};

const loadDashboardCache = (): DashboardCache | null => {
  try {
    const cached = localStorage.getItem('dashboardCache');
    if (!cached) return null;
    return JSON.parse(cached) as DashboardCache;
  } catch (err) {
    console.warn('Failed to load dashboard cache:', err);
    return null;
  }
};

const isCacheValid = (cache: DashboardCache | null): boolean => {
  if (!cache) return false;
  const yesterday = getYesterdayUTC();
  // Cache is valid if the endDate matches yesterday (i.e., same data as today's default)
  return cache.endDate === yesterday;
};

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [protocols, setProtocols] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [monPrice, setMonPrice] = useState('0.025');
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [bulkAnalysisResult, setBulkAnalysisResult] = useState<any>(null);
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
  const [isAutoLoading, setIsAutoLoading] = useState(false);
  const [enhancedCsvLoading, setEnhancedCsvLoading] = useState(false);

  // Memoized computed values
  const periodDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    return Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;
  }, [startDate, endDate]);

  const monPriceNum = useMemo(() => parseFloat(monPrice), [monPrice]);

  // Memoized URL params
  const urlParams = useMemo(() => {
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
    return params.toString();
  }, [protocols, startDate, endDate, monPrice]);

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

  // Fetch MON price from API
  const fetchMonPrice = async (): Promise<string> => {
    try {
      const response = await fetch('/api/mon-price');
      if (!response.ok) {
        return '0.025';
      }
      const data = await response.json();
      return data.price?.toString() || '0.025';
    } catch {
      return '0.025';
    }
  };

  // Read URL parameters on mount and handle auto-initialization
  useEffect(() => {
    const initializeDashboard = async () => {
      const urlProtocols = searchParams.get('protocols');
      const urlStartDate = searchParams.get('startDate');
      const urlEndDate = searchParams.get('endDate');
      const urlMonPrice = searchParams.get('monPrice');

      // Check if URL params exist (manual override)
      const hasURLParams = urlProtocols || urlStartDate || urlEndDate || urlMonPrice;

      if (hasURLParams) {
        // Manual override: use URL parameters
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
          setMonPrice('0.025');
        }
      } else {
        // No URL params: try to load from server cache first
        try {
          const response = await fetch('/api/dashboard-default');
          const data = await response.json();

          if (response.ok && data.success && data.cached && data.data) {
            // Server cache hit - instant display!
            console.log('[Init] Server cache hit, loading data instantly');
            const cache = data.data;
            setStartDate(cache.startDate);
            setEndDate(cache.endDate);
            // Don't restore protocols - always start with none selected
            setMonPrice(cache.monPrice.toString());
            setResults(cache.results);
            setPreviousWeekResults(cache.previousWeekResults);
            setProtocolTVL(cache.protocolTVL);
            setProtocolTVLMetadata(cache.protocolTVLMetadata);
            setProtocolDEXVolume(cache.protocolDEXVolume);
            setMarketVolumes(cache.marketVolumes);
            setPreviousWeekProtocolTVL(cache.previousWeekProtocolTVL);
            setPreviousWeekProtocolDEXVolume(cache.previousWeekProtocolDEXVolume);
            setPreviousWeekMarketVolumes(cache.previousWeekMarketVolumes);
            setAiAnalysis(cache.aiAnalysis);

            // Also save to localStorage for backup
            saveDashboardCache({
              ...cache,
              monPrice: cache.monPrice.toString(),
              timestamp: cache.timestamp,
              cacheDate: cache.endDate,
            });
          } else {
            // Server cache miss - fall back to client behavior
            console.log('[Init] Server cache miss, falling back to manual load');
            const yesterday = getYesterdayUTC();
            const sevenDaysAgo = getSevenDaysAgoUTC();

            // Check localStorage as fallback
            const localCache = loadDashboardCache();
            if (isCacheValid(localCache)) {
              console.log('[Init] Using localStorage cache');
              setStartDate(localCache!.startDate);
              setEndDate(localCache!.endDate);
              // Don't restore protocols - always start with none selected
              setMonPrice(localCache!.monPrice);
              setResults(localCache!.results);
              setPreviousWeekResults(localCache!.previousWeekResults);
              setProtocolTVL(localCache!.protocolTVL);
              setProtocolTVLMetadata(localCache!.protocolTVLMetadata);
              setProtocolDEXVolume(localCache!.protocolDEXVolume);
              setMarketVolumes(localCache!.marketVolumes);
              setPreviousWeekProtocolTVL(localCache!.previousWeekProtocolTVL);
              setPreviousWeekProtocolDEXVolume(localCache!.previousWeekProtocolDEXVolume);
              setPreviousWeekMarketVolumes(localCache!.previousWeekMarketVolumes);
              setAiAnalysis(localCache!.aiAnalysis);
            } else {
              // No cache at all - trigger fresh fetch
              console.log('[Init] No cache available, triggering fresh fetch');
              setStartDate(sevenDaysAgo);
              setEndDate(yesterday);
              setProtocols([]);

              const price = await fetchMonPrice();
              setMonPrice(price);

              setIsAutoLoading(true);
            }
          }
        } catch (error) {
          // Error fetching server cache - fall back to localStorage or manual load
          console.error('[Init] Error fetching server cache:', error);
          const yesterday = getYesterdayUTC();
          const sevenDaysAgo = getSevenDaysAgoUTC();

          const localCache = loadDashboardCache();
          if (isCacheValid(localCache)) {
            console.log('[Init] Using localStorage cache after server error');
            setStartDate(localCache!.startDate);
            setEndDate(localCache!.endDate);
            // Don't restore protocols - always start with none selected
            setMonPrice(localCache!.monPrice);
            setResults(localCache!.results);
            setPreviousWeekResults(localCache!.previousWeekResults);
            setProtocolTVL(localCache!.protocolTVL);
            setProtocolTVLMetadata(localCache!.protocolTVLMetadata);
            setProtocolDEXVolume(localCache!.protocolDEXVolume);
            setMarketVolumes(localCache!.marketVolumes);
            setPreviousWeekProtocolTVL(localCache!.previousWeekProtocolTVL);
            setPreviousWeekProtocolDEXVolume(localCache!.previousWeekProtocolDEXVolume);
            setPreviousWeekMarketVolumes(localCache!.previousWeekMarketVolumes);
            setAiAnalysis(localCache!.aiAnalysis);
          } else {
            setStartDate(sevenDaysAgo);
            setEndDate(yesterday);
            setProtocols([]);

            const price = await fetchMonPrice();
            setMonPrice(price);

            setIsAutoLoading(true);
          }
        }
      }

      setIsInitialized(true);
    };

    initializeDashboard();
  }, [searchParams]);

  // Auto-trigger AI analysis and poll for updates if it's missing but cache exists
  useEffect(() => {
    // Only run if:
    // 1. Dashboard is initialized
    // 2. AI analysis is null
    // 3. We have results (cache was loaded)
    if (!isInitialized || aiAnalysis !== null || results.length === 0) {
      return;
    }

    let aiTriggered = false;

    const triggerAIAnalysis = async () => {
      if (aiTriggered) return; // Only trigger once
      aiTriggered = true;

      try {
        console.log('[AI Auto-Trigger] AI analysis missing, triggering automatically...');
        setAiLoading(true);
        setAiError('');

        // Prepare AI analysis data (same logic as cron job)
        const prepareAIData = () => {
          // Helper: Extract token pair from market name
          const extractTokenPair = (marketName: string): string => {
            const match = marketName.match(/([A-Z0-9]+)[-\/]([A-Z0-9]+)/);
            if (match) {
              return `${match[1]}-${match[2]}`;
            }
            return '';
          };

          // Helper: Calculate TVL Cost
          const calculateTVLCost = (incentivesUSD: number, tvl: number, days: number): number | null => {
            if (!tvl || tvl === 0 || !incentivesUSD) return null;
            const annualizedIncentives = (incentivesUSD / days) * 365;
            return (annualizedIncentives / tvl) * 100;
          };

          // Create a map to find previous week pools
          const prevPoolMap = new Map<string, any>();
          (previousWeekResults || []).forEach((platform: any) => {
            platform.fundingProtocols?.forEach((funding: any) => {
              funding.markets?.forEach((market: any) => {
                const key = `${platform.platformProtocol}-${funding.fundingProtocol}-${market.marketName}`;
                prevPoolMap.set(key.toLowerCase(), {
                  protocol: platform.platformProtocol,
                  fundingProtocol: funding.fundingProtocol,
                  marketName: market.marketName,
                  incentivesMON: market.totalMON || 0,
                  incentivesUSD: (market.totalMON || 0) * monPriceNum,
                  tvl: market.tvl || null,
                });
              });
            });
          });

          // Prepare current week pools
          const currentPools = (results || []).flatMap((platform: any) =>
            platform.fundingProtocols.flatMap((funding: any) =>
              funding.markets.map((market: any) => {
                const protocolKey = platform.platformProtocol.toLowerCase();
                const marketKey = `${platform.platformProtocol}-${funding.fundingProtocol}-${market.marketName}`.toLowerCase();

                // Get TVL from protocolTVL (prefer protocol-level TVL over market-level)
                let tvl = market.tvl || null;
                if (protocolTVL[protocolKey]) {
                  tvl = protocolTVL[protocolKey];
                }

                // Get volume from protocolDEXVolume (protocol-level)
                const tokenPair = extractTokenPair(market.marketName);
                let volume = null;
                const dexVolume = protocolDEXVolume[protocolKey];
                if (dexVolume) {
                  volume = dexVolume.volumeInRange ?? dexVolume.volume7d ?? dexVolume.volume30d ?? null;
                }

                // Calculate TVL Cost
                const incentivesUSD = (market.totalMON || 0) * monPriceNum;
                const tvlCost = calculateTVLCost(incentivesUSD, tvl || 0, periodDays);

                // Find previous week pool
                const prevPool = prevPoolMap.get(marketKey);
                let wowChange = null;
                if (prevPool && tvlCost !== null) {
                  const prevTvl = prevPool.tvl || null;
                  const prevIncentivesUSD = prevPool.incentivesUSD || 0;
                  const prevTVLCost = calculateTVLCost(prevIncentivesUSD, prevTvl || 0, periodDays);
                  if (prevTVLCost !== null && prevTVLCost !== 0) {
                    wowChange = ((tvlCost - prevTVLCost) / prevTVLCost) * 100;
                  }
                }

                return {
                  protocol: platform.platformProtocol,
                  fundingProtocol: funding.fundingProtocol,
                  marketName: market.marketName,
                  tokenPair,
                  incentivesMON: market.totalMON || 0,
                  incentivesUSD,
                  tvl,
                  volume,
                  apr: market.apr || null,
                  tvlCost,
                  wowChange,
                  periodDays,
                  merklUrl: market.merklUrl || null,
                };
              })
            )
          );

          // Prepare previous week pools
          const previousPools = (previousWeekResults || []).flatMap((platform: any) =>
            platform.fundingProtocols.flatMap((funding: any) =>
              funding.markets.map((market: any) => {
                const protocolKey = platform.platformProtocol.toLowerCase();
                const tokenPair = extractTokenPair(market.marketName);

                // Get TVL from previousWeekProtocolTVL
                let tvl = market.tvl || null;
                if (previousWeekProtocolTVL[protocolKey]) {
                  tvl = previousWeekProtocolTVL[protocolKey];
                }

                // Get volume from previousWeekProtocolDEXVolume (protocol-level)
                let volume = null;
                const prevDexVolume = previousWeekProtocolDEXVolume[protocolKey];
                if (prevDexVolume) {
                  volume = prevDexVolume.volumeInRange ?? prevDexVolume.volume7d ?? prevDexVolume.volume30d ?? null;
                }

                const incentivesUSD = (market.totalMON || 0) * monPriceNum;
                const tvlCost = calculateTVLCost(incentivesUSD, tvl || 0, periodDays);

                return {
                  protocol: platform.platformProtocol,
                  fundingProtocol: funding.fundingProtocol,
                  marketName: market.marketName,
                  tokenPair,
                  incentivesMON: market.totalMON || 0,
                  incentivesUSD,
                  tvl,
                  volume,
                  apr: market.apr || null,
                  tvlCost,
                  wowChange: null,
                  periodDays,
                };
              })
            )
          );

          return { currentPools, previousPools };
        };

        const { currentPools, previousPools } = prepareAIData();

        console.log('[AI Auto-Trigger] Prepared', currentPools.length, 'current pools and', previousPools.length, 'previous pools');

        // Calculate previous week dates
        const getPreviousWeekDates = (start: string, end: string) => {
          const startDate = new Date(start + 'T00:00:00Z');
          const endDate = new Date(end + 'T00:00:00Z');
          const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

          const prevEnd = new Date(startDate);
          prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);

          const prevStart = new Date(prevEnd);
          prevStart.setUTCDate(prevStart.getUTCDate() - daysDiff + 1);

          return {
            prevStartDate: prevStart.toISOString().split('T')[0],
            prevEndDate: prevEnd.toISOString().split('T')[0],
          };
        };

        const { prevStartDate, prevEndDate } = getPreviousWeekDates(startDate, endDate);

        // Call AI analysis endpoint
        const response = await fetch('/api/ai-analysis', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            currentWeek: {
              pools: currentPools,
              startDate,
              endDate,
              monPrice: monPriceNum,
            },
            previousWeek: {
              pools: previousPools,
              startDate: prevStartDate,
              endDate: prevEndDate,
            },
            includeAllData: true,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'AI analysis failed');
        }

        const aiData = await response.json();

        if (aiData.analysis) {
          console.log('[AI Auto-Trigger] ✅ AI analysis complete!');
          setAiAnalysis(aiData.analysis);
          setAiLoading(false);

          // Update localStorage
          const localCache = loadDashboardCache();
          if (localCache) {
            localCache.aiAnalysis = aiData.analysis;
            saveDashboardCache(localCache);
          }

          // Update server cache so other users can see AI analysis
          try {
            const cacheResponse = await fetch('/api/dashboard-default', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ aiAnalysis: aiData.analysis }),
            });

            if (cacheResponse.ok) {
              console.log('[AI Auto-Trigger] ✅ AI analysis saved to server cache for all users');
            } else {
              console.warn('[AI Auto-Trigger] ⚠️ Failed to save AI analysis to server cache');
            }
          } catch (cacheError) {
            console.warn('[AI Auto-Trigger] ⚠️ Error saving AI analysis to server cache:', cacheError);
          }
        } else {
          throw new Error('AI analysis response missing analysis field');
        }
      } catch (error: any) {
        console.error('[AI Auto-Trigger] ❌ Error:', error);
        setAiError(error.message || 'Failed to generate AI analysis');
        setAiLoading(false);
      }
    };

    const checkForAIAnalysis = async () => {
      try {
        const response = await fetch('/api/dashboard-default');
        const data = await response.json();

        if (response.ok && data.success && data.cached && data.data?.aiAnalysis) {
          console.log('[AI Poll] AI analysis now available, updating...');
          setAiAnalysis(data.data.aiAnalysis);
          setAiLoading(false);
          // Also update localStorage
          const localCache = loadDashboardCache();
          if (localCache) {
            localCache.aiAnalysis = data.data.aiAnalysis;
            saveDashboardCache(localCache);
          }
        }
      } catch (error) {
        console.warn('[AI Poll] Error checking for AI analysis:', error);
      }
    };

    // First, check if AI analysis is already being generated by cron
    checkForAIAnalysis();

    // Wait 5 seconds to see if cron has already started AI analysis
    const triggerTimeout = setTimeout(() => {
      if (aiAnalysis === null && !aiLoading) {
        // No AI analysis found after 5 seconds, trigger it ourselves
        triggerAIAnalysis();
      }
    }, 5000);

    // Continue polling every 15 seconds
    const interval = setInterval(checkForAIAnalysis, 15000);

    // Stop polling after 5 minutes
    const timeout = setTimeout(() => {
      clearInterval(interval);
      console.log('[AI Poll] Stopped polling for AI analysis after 5 minutes');
    }, 5 * 60 * 1000);

    return () => {
      clearTimeout(triggerTimeout);
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [isInitialized, aiAnalysis, results.length, previousWeekResults, protocolTVL, protocolDEXVolume, previousWeekProtocolTVL, previousWeekProtocolDEXVolume, monPriceNum, periodDays, startDate, endDate]);
  
  // Update URL parameters when state changes (but not during initialization)
  useEffect(() => {
    if (!isInitialized) return;

    // Check if current state matches default dashboard params
    const yesterday = getYesterdayUTC();
    const sevenDaysAgo = getSevenDaysAgoUTC();
    const isDefaultParams =
      startDate === sevenDaysAgo &&
      endDate === yesterday &&
      protocols.length === commonProtocols.length &&
      protocols.every(p => commonProtocols.includes(p));

    // Don't update URL for default dashboard view
    if (isDefaultParams) {
      const currentURL = window.location.search;
      if (currentURL !== '') {
        router.replace('/', { scroll: false });
      }
      return;
    }

    // Update URL for non-default params
    const newURL = urlParams ? `?${urlParams}` : '';
    const currentURL = window.location.search;
    if (currentURL !== newURL) {
      router.replace(newURL, { scroll: false });
    }
  }, [urlParams, isInitialized, router, startDate, endDate, protocols]);

  // Auto-run query when isAutoLoading is true
  useEffect(() => {
    if (isAutoLoading && isInitialized && protocols.length > 0 && startDate && endDate) {
      handleQuery(true);
    }
  }, [isAutoLoading, isInitialized, protocols.length, startDate, endDate]);

  // Save dashboard cache after data is loaded (when results and AI analysis are set)
  useEffect(() => {
    // Only save cache if we have results and we're using default dashboard params
    if (results.length === 0) return;

    const yesterday = getYesterdayUTC();
    const sevenDaysAgo = getSevenDaysAgoUTC();
    const isDefaultParams =
      startDate === sevenDaysAgo &&
      endDate === yesterday &&
      protocols.length === commonProtocols.length &&
      protocols.every(p => commonProtocols.includes(p));

    if (isDefaultParams) {
      // Save to cache
      const cache: DashboardCache = {
        endDate,
        startDate,
        monPrice,
        protocols,
        results,
        previousWeekResults,
        protocolTVL,
        protocolTVLMetadata,
        protocolDEXVolume,
        marketVolumes,
        previousWeekProtocolTVL,
        previousWeekProtocolDEXVolume,
        previousWeekMarketVolumes,
        aiAnalysis,
        timestamp: Date.now(),
      };
      saveDashboardCache(cache);
    }
  }, [results, aiAnalysis, startDate, endDate, protocols, monPrice]);

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
    'Beefy', // Capital B - Merkl API uses "Beefy" not "beefy"
    'accountable',
    'curve',
    'lfj', // LFJ DEX - shows TVL/Volume even without Merkl incentives
    'wlfi', // WLFI - appears as funding protocol only
  ];

  const toggleProtocol = (protocol: string) => {
    setProtocols(prev =>
      prev.includes(protocol)
        ? prev.filter(p => p !== protocol)
        : [...prev, protocol]
    );
  };

  const selectAllProtocols = () => {
    setProtocols(commonProtocols);
  };

  const deselectAllProtocols = () => {
    setProtocols([]);
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

  // Helper function to build tooltip text from explanation/issue
  const buildTooltipText = (item: any, includeCompetitors: boolean = true): string => {
    let tooltip = item.explanation || item.issue || '';
    if (includeCompetitors && item.competitorLinks && item.competitorLinks.length > 0) {
      tooltip += '\n\nCompeting pools:';
      item.competitorLinks.forEach((competitor: any) => {
        tooltip += `\n• ${competitor.protocol} ${competitor.marketName}`;
        if (competitor.reason) {
          tooltip += ` (${competitor.reason})`;
        }
      });
    }
    if (item.recommendation) {
      tooltip += `\n\n💡 ${item.recommendation}`;
    }
    return tooltip;
  };

  // Extract token pair and fee from market name for better matching
  const extractTokenPairAndFee = (name: string): { tokenPair: string | null; fee: string | null } => {
    const lowerName = name.toLowerCase();
    const tokenPairMatch = lowerName.match(/([a-z0-9]+)-([a-z0-9]+)/);
    const tokenPair = tokenPairMatch ? `${tokenPairMatch[1]}-${tokenPairMatch[2]}` : null;
    const feeMatch = lowerName.match(/(\d+\.?\d*)%/);
    const fee = feeMatch ? feeMatch[1] : null;
    return { tokenPair, fee };
  };

  // Helper function to check if a poolId matches (flexible matching)
  const matchesPoolId = (aiPoolId: string, normalizedPoolId: string, protocol: string, fundingProtocol: string, marketName: string): boolean => {
    if (!aiPoolId) return false;
    const aiNormalized = aiPoolId.toLowerCase();
    if (aiNormalized === normalizedPoolId) return true;
    
    const aiParts = aiNormalized.split('-');
    if (aiParts.length >= 3) {
      const aiProtocol = aiParts[0];
      const aiFunding = aiParts[1];
      const aiMarket = aiParts.slice(2).join('-');
      
      if (aiProtocol === protocol && aiFunding === fundingProtocol) {
        if (aiMarket === marketName || marketName.includes(aiMarket) || aiMarket.includes(marketName)) {
          return true;
        }
        
        const { tokenPair: ourTokenPair, fee: ourFee } = extractTokenPairAndFee(marketName);
        const { tokenPair: aiTokenPair, fee: aiFee } = extractTokenPairAndFee(aiMarket);
        if (ourTokenPair && aiTokenPair && ourTokenPair === aiTokenPair) {
          if (!ourFee || !aiFee || ourFee === aiFee) {
            return true;
          }
        }
      }
    }
    return false;
  };

  // Helper function to check if a poolName matches our market name
  const matchesPoolName = (poolName: string, marketName: string): boolean => {
    if (!poolName) return false;
    const normalizedName = poolName.toLowerCase();
    if (normalizedName.includes(marketName.toLowerCase()) || marketName.toLowerCase().includes(normalizedName)) {
      return true;
    }
    const { tokenPair: ourTokenPair, fee: ourFee } = extractTokenPairAndFee(marketName);
    const { tokenPair: nameTokenPair, fee: nameFee } = extractTokenPairAndFee(normalizedName);
    if (ourTokenPair && nameTokenPair && ourTokenPair === nameTokenPair) {
      if (!ourFee || !nameFee || ourFee === nameFee) {
        return true;
      }
    }
    return false;
  };

  // Pre-build AI tooltip cache for O(1) lookup
  const aiTooltipCache = useMemo(() => {
    if (!aiAnalysis) return {};
    
    const cache: Record<string, Record<string, string>> = {};
    
    // Build cache for wowExplanations (pool-level WoW change explanations)
    if (aiAnalysis.wowExplanations && Array.isArray(aiAnalysis.wowExplanations)) {
      for (const exp of aiAnalysis.wowExplanations) {
        if (!exp.poolId) continue;
        const normalizedId = exp.poolId.toLowerCase();
        const tooltipText = buildTooltipText(exp, true);

        // Skip if tooltip is empty
        if (!tooltipText || tooltipText.trim().length === 0) continue;

        const poolIdParts = normalizedId.split('-');

        // Store for TVL Cost metrics (WoW explanations are primarily for TVL Cost)
        // Only store volumeCostWoW if the explanation mentions volume/trading
        const isVolumeRelated = tooltipText.toLowerCase().includes('volume') ||
                                tooltipText.toLowerCase().includes('trading') ||
                                tooltipText.toLowerCase().includes('volume cost');

        if (!cache[normalizedId]) cache[normalizedId] = {};
        cache[normalizedId].tvlCostWoW = tooltipText;
        cache[normalizedId].tvlCost = tooltipText; // WoW explanations also help understand current TVL cost
        if (isVolumeRelated) {
          cache[normalizedId].volumeCostWoW = tooltipText;
        }
        
        if (poolIdParts.length >= 3) {
          const protocol = poolIdParts[0];
          const fundingProtocol = poolIdParts[1];
          const marketName = poolIdParts.slice(2).join('-');
          const marketNameLower = marketName.toLowerCase();
          
          // Store by protocol-fundingProtocol-marketName pattern for flexible matching
          const flexibleKey = `${protocol}-${fundingProtocol}-${marketName}`;
          if (!cache[flexibleKey]) cache[flexibleKey] = {};
          cache[flexibleKey].tvlCostWoW = tooltipText;
          cache[flexibleKey].tvlCost = tooltipText;
          if (isVolumeRelated) {
            cache[flexibleKey].volumeCostWoW = tooltipText;
          }
          
          // Store by market name alone for protocol-level analysis matching
          if (!cache[marketNameLower]) cache[marketNameLower] = {};
          cache[marketNameLower].tvlCostWoW = tooltipText;
          cache[marketNameLower].tvlCost = tooltipText;
          if (isVolumeRelated) {
            cache[marketNameLower].volumeCostWoW = tooltipText;
          }
          
          // Also try storing by just protocol-marketName (without funding protocol) for broader matching
          const protocolMarketKey = `${protocol}-${marketName}`;
          if (!cache[protocolMarketKey]) cache[protocolMarketKey] = {};
          cache[protocolMarketKey].tvlCostWoW = tooltipText;
          cache[protocolMarketKey].tvlCost = tooltipText;
          if (isVolumeRelated) {
            cache[protocolMarketKey].volumeCostWoW = tooltipText;
          }
        }
      }
    }
    
    // Build cache for volumeCostWowExplanations (volume-specific WoW changes)
    if (aiAnalysis.volumeCostWowExplanations && Array.isArray(aiAnalysis.volumeCostWowExplanations)) {
      for (const volExp of aiAnalysis.volumeCostWowExplanations) {
        if (!volExp.poolId) continue;
        const normalizedId = volExp.poolId.toLowerCase();
        const tooltipText = volExp.explanation || '';

        // Skip if tooltip is empty
        if (!tooltipText || tooltipText.trim().length === 0) continue;

        if (!cache[normalizedId]) cache[normalizedId] = {};
        cache[normalizedId].volumeCostWoW = tooltipText;
        cache[normalizedId].volumeCost = tooltipText; // Also use for Volume Cost column

        const poolIdParts = normalizedId.split('-');
        if (poolIdParts.length >= 3) {
          const protocol = poolIdParts[0];
          const fundingProtocol = poolIdParts[1];
          const marketName = poolIdParts.slice(2).join('-');
          const marketNameLower = marketName.toLowerCase();

          // Store by various key patterns
          const flexibleKey = `${protocol}-${fundingProtocol}-${marketName}`;
          if (!cache[flexibleKey]) cache[flexibleKey] = {};
          cache[flexibleKey].volumeCostWoW = tooltipText;
          cache[flexibleKey].volumeCost = tooltipText;

          if (!cache[marketNameLower]) cache[marketNameLower] = {};
          cache[marketNameLower].volumeCostWoW = tooltipText;
          cache[marketNameLower].volumeCost = tooltipText;

          const protocolMarketKey = `${protocol}-${marketName}`;
          if (!cache[protocolMarketKey]) cache[protocolMarketKey] = {};
          cache[protocolMarketKey].volumeCostWoW = tooltipText;
          cache[protocolMarketKey].volumeCost = tooltipText;
        }
      }
    }

    // Build cache for efficiency issues
    if (aiAnalysis.efficiencyIssues && Array.isArray(aiAnalysis.efficiencyIssues)) {
      for (const issue of aiAnalysis.efficiencyIssues) {
        if (!issue.poolId) continue;
        const normalizedId = issue.poolId.toLowerCase();
        const tooltipText = buildTooltipText(issue, false);

        // Skip if tooltip is empty
        if (!tooltipText || tooltipText.trim().length === 0) continue;

        if (!cache[normalizedId]) cache[normalizedId] = {};
        cache[normalizedId].tvlCost = tooltipText;

        const poolIdParts = normalizedId.split('-');
        if (poolIdParts.length >= 3) {
          const protocol = poolIdParts[0];
          const fundingProtocol = poolIdParts[1];
          const marketName = poolIdParts.slice(2).join('-');
          const flexibleKey = `${protocol}-${fundingProtocol}-${marketName}`;
          if (!cache[flexibleKey]) cache[flexibleKey] = {};
          cache[flexibleKey].tvlCost = tooltipText;
        }
      }
    }
    
    // Build cache for protocol-level poolLevelWowAnalysis
    if (aiAnalysis.protocolRecommendations && Array.isArray(aiAnalysis.protocolRecommendations)) {
      for (const protocolRec of aiAnalysis.protocolRecommendations) {
        const protocolLower = protocolRec.protocol?.toLowerCase();
        
        if (protocolRec.poolLevelWowAnalysis && Array.isArray(protocolRec.poolLevelWowAnalysis)) {
          for (const wowAnalysis of protocolRec.poolLevelWowAnalysis) {
            if (!wowAnalysis.poolName) continue;
            const poolNameLower = wowAnalysis.poolName.toLowerCase();
            const tooltipText = buildTooltipText(wowAnalysis, true);

            // Skip if tooltip is empty
            if (!tooltipText || tooltipText.trim().length === 0) continue;

            // Check if this is volume-related analysis
            const isVolumeRelated = tooltipText.toLowerCase().includes('volume') ||
                                    tooltipText.toLowerCase().includes('trading') ||
                                    tooltipText.toLowerCase().includes('volume cost');

            // Store by pool name pattern (for direct matching)
            if (!cache[poolNameLower]) cache[poolNameLower] = {};
            cache[poolNameLower].tvlCostWoW = tooltipText;
            cache[poolNameLower].tvlCost = tooltipText; // Also relevant for understanding current cost
            if (isVolumeRelated) {
              cache[poolNameLower].volumeCostWoW = tooltipText;
            }

            // Also store by protocol-poolName for protocol-specific matching
            if (protocolLower) {
              const protocolPoolKey = `${protocolLower}-${poolNameLower}`;
              if (!cache[protocolPoolKey]) cache[protocolPoolKey] = {};
              cache[protocolPoolKey].tvlCostWoW = tooltipText;
              cache[protocolPoolKey].tvlCost = tooltipText;
              if (isVolumeRelated) {
                cache[protocolPoolKey].volumeCostWoW = tooltipText;
              }
            }

            // Extract token pair for additional matching patterns
            const { tokenPair } = extractTokenPairAndFee(poolNameLower);
            if (tokenPair && protocolLower) {
              // Store by protocol-tokenPair for token pair matching
              const protocolTokenPairKey = `${protocolLower}-${tokenPair}`;
              if (!cache[protocolTokenPairKey]) cache[protocolTokenPairKey] = {};
              cache[protocolTokenPairKey].tvlCostWoW = tooltipText;
              if (isVolumeRelated) {
                cache[protocolTokenPairKey].volumeCostWoW = tooltipText;
              }
            }
          }
        }
        
        // Cache protocol-level key issues
        if (protocolRec.keyIssues && Array.isArray(protocolRec.keyIssues)) {
          const protocolLower = protocolRec.protocol?.toLowerCase();
          if (protocolLower) {
            for (const issue of protocolRec.keyIssues) {
              const issueLower = issue.toLowerCase();
              if (!cache[issueLower]) cache[issueLower] = {};
              cache[issueLower].tvlCost = issue;
            }
          }
        }
      }
    }

    // Debug: Log cache size and sample entries
    const cacheKeys = Object.keys(cache);
    if (cacheKeys.length > 0) {
      console.log(`[AI Tooltip Cache] Built cache with ${cacheKeys.length} pool entries`);
      const sampleKey = cacheKeys[0];
      console.log(`[AI Tooltip Cache] Sample entry "${sampleKey}":`, cache[sampleKey]);
    } else {
      console.warn('[AI Tooltip Cache] Cache is empty - no tooltips will be shown');
    }

    return cache;
  }, [aiAnalysis]);

  // Helper function to extract token pair + fee from market name
  // Converts "Provide liquidity to UniswapV4 MON-USDC 0.05%" → "MON-USDC 0.05%"
  const extractTokenPairFromMarketName = (marketName: string): string => {
    // Match pattern like "MON-USDC 0.05%" or "AUSD-XAUt0 0.0009%"
    const match = marketName.match(/([A-Z0-9a-z]+-[A-Z0-9a-z]+)\s*([\d.]+%)/i);
    if (match) {
      return `${match[1]} ${match[2]}`;
    }
    // Fallback: return the original name
    return marketName;
  };

  // Generate tooltip content from AI analysis for a given pool (now uses cache)
  const getAITooltip = (poolId: string, metricType: 'tvlCost' | 'tvlCostWoW' | 'volumeCost' | 'volumeCostWoW'): string | null => {
    if (!aiAnalysis) {
      return null;
    }

    const normalizedPoolId = poolId.toLowerCase();

    // Try direct lookup first
    const cachedTooltip = aiTooltipCache[normalizedPoolId]?.[metricType];
    if (cachedTooltip && cachedTooltip.trim().length > 0) {
      return cachedTooltip;
    }
    
    // Fallback to flexible matching for protocol-level analysis
    const poolIdParts = normalizedPoolId.split('-');
    if (poolIdParts.length >= 3) {
      const protocol = poolIdParts[0];
      const fundingProtocol = poolIdParts[1];
      const marketName = poolIdParts.slice(2).join('-');
      
      const marketNameLower = marketName.toLowerCase();
      
      // Try flexible key (protocol-fundingProtocol-marketName)
      const flexibleKey = `${protocol}-${fundingProtocol}-${marketName}`;
      const flexibleTooltip = aiTooltipCache[flexibleKey]?.[metricType];
      if (flexibleTooltip && flexibleTooltip.trim().length > 0) {
        return flexibleTooltip;
      }

      // Try protocol-marketName (without funding protocol)
      const protocolMarketKey = `${protocol}-${marketName}`;
      const protocolMarketTooltip = aiTooltipCache[protocolMarketKey]?.[metricType];
      if (protocolMarketTooltip && protocolMarketTooltip.trim().length > 0) {
        return protocolMarketTooltip;
      }

      // Try matching by market name alone (for protocol-level analysis)
      const marketTooltip = aiTooltipCache[marketNameLower]?.[metricType];
      if (marketTooltip && marketTooltip.trim().length > 0) {
        return marketTooltip;
      }

      // NEW: Extract token pair + fee from full market name and try matching shortened key
      // This handles cases where AI returns "uniswap-upshift-mon-usdc-0.05%" but we lookup "uniswap-upshift-provide liquidity to uniswapv4 mon-usdc 0.05%"
      const { tokenPair, fee } = extractTokenPairAndFee(marketNameLower);
      if (tokenPair && fee) {
        const shortenedKey = `${protocol}-${fundingProtocol}-${tokenPair}-${fee}%`;
        const shortenedTooltip = aiTooltipCache[shortenedKey]?.[metricType];
        if (shortenedTooltip && shortenedTooltip.trim().length > 0) {
          return shortenedTooltip;
        }

        // Also try without funding protocol
        const shortenedProtocolKey = `${protocol}-${tokenPair}-${fee}%`;
        const shortenedProtocolTooltip = aiTooltipCache[shortenedProtocolKey]?.[metricType];
        if (shortenedProtocolTooltip && shortenedProtocolTooltip.trim().length > 0) {
          return shortenedProtocolTooltip;
        }
      }
      
      // For TVL WoW metrics, check protocol-level poolLevelWowAnalysis with flexible matching
      // Note: volumeCostWoW is handled separately below to ensure only volume-related content is shown
      if ((metricType === 'tvlCostWoW' || metricType === 'tvlCost') && aiAnalysis.protocolRecommendations) {
        for (const protocolRec of aiAnalysis.protocolRecommendations) {
          if (protocolRec.protocol?.toLowerCase() === protocol && protocolRec.poolLevelWowAnalysis) {
            for (const wowAnalysis of protocolRec.poolLevelWowAnalysis) {
              if (!wowAnalysis.poolName) continue;

              const analysisPoolNameLower = wowAnalysis.poolName.toLowerCase();

              // Try exact match first
              if (analysisPoolNameLower === marketNameLower) {
                return buildTooltipText(wowAnalysis, true);
              }

              // Try substring matching (flexible matching)
              if (marketNameLower.includes(analysisPoolNameLower) || analysisPoolNameLower.includes(marketNameLower)) {
                return buildTooltipText(wowAnalysis, true);
              }

              // Try matching by token pair extracted from market name
              const { tokenPair: ourTokenPair } = extractTokenPairAndFee(marketNameLower);
              const { tokenPair: analysisTokenPair } = extractTokenPairAndFee(analysisPoolNameLower);
              if (ourTokenPair && analysisTokenPair && ourTokenPair === analysisTokenPair) {
                return buildTooltipText(wowAnalysis, true);
              }
            }
          }
        }
      }

      // For TVL WoW metrics, also try partial matching on wowExplanations poolIds
      // Note: volumeCostWoW is handled separately below to ensure only volume-related content is shown
      if ((metricType === 'tvlCostWoW' || metricType === 'tvlCost') && aiAnalysis.wowExplanations) {
        for (const exp of aiAnalysis.wowExplanations) {
          if (!exp.poolId) continue;
          const expPoolIdLower = exp.poolId.toLowerCase();
          const expParts = expPoolIdLower.split('-');

          // Check if market name matches any part of the explanation's poolId
          if (expParts.length >= 3) {
            const expMarketName = expParts.slice(2).join('-');
            if (expMarketName === marketNameLower ||
                marketNameLower.includes(expMarketName) ||
                expMarketName.includes(marketNameLower)) {
              return buildTooltipText(exp, true);
            }
          }
        }
      }
      
      // For volumeCost, check keyFindings and efficiencyIssues for volume-specific content
      if (metricType === 'volumeCost' || metricType === 'volumeCostWoW') {
        // First check keyFindings for volume-specific insights
        if (aiAnalysis.keyFindings) {
          const volumeFindings = aiAnalysis.keyFindings.filter((finding: string) => {
            const findingLower = finding.toLowerCase();
            return (findingLower.includes('volume') || findingLower.includes('trading') || findingLower.includes('volume cost')) && 
                   (findingLower.includes(protocol) || findingLower.includes(marketNameLower));
          });
          if (volumeFindings.length > 0) {
            return volumeFindings.join('\n\n');
          }
        }
        
        // Check efficiencyIssues for volume cost issues
        if (aiAnalysis.efficiencyIssues) {
          const volumeIssues = aiAnalysis.efficiencyIssues.filter((issue: any) => {
            if (!issue.poolId) return false;
            const issuePoolIdLower = issue.poolId.toLowerCase();
            const issueParts = issuePoolIdLower.split('-');
            if (issueParts.length >= 3) {
              const issueMarketName = issueParts.slice(2).join('-').toLowerCase();
              return issueMarketName === marketNameLower || 
                     marketNameLower.includes(issueMarketName) ||
                     issueMarketName.includes(marketNameLower);
            }
            return false;
          }).filter((issue: any) => {
            // Only include if the issue mentions volume
            const issueText = (issue.issue || '').toLowerCase();
            return issueText.includes('volume') || issueText.includes('trading') || issueText.includes('volume cost');
          });
          
          if (volumeIssues.length > 0) {
            return volumeIssues.map((issue: any) => buildTooltipText(issue, false)).join('\n\n');
          }
        }
        
        // Don't fall back to TVL cost explanations for volume cost - return null if no volume-specific content
        return null;
      }
    }

    return null;
  };

  const handleQuery = async (autoRun = false) => {
    if (protocols.length === 0) {
      setError('Please select at least one protocol');
      if (autoRun) setIsAutoLoading(false);
      return;
    }

    if (!startDate || !endDate) {
      setError('Please select both start and end dates');
      if (autoRun) setIsAutoLoading(false);
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

    let querySucceeded = false;

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

      // Mark query as succeeded
      querySucceeded = true;
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      if (autoRun) setIsAutoLoading(false);
    } finally {
      setLoading(false);

      // If this was an auto-run query and it succeeded, trigger AI analysis
      if (autoRun && querySucceeded) {
        setIsAutoLoading(false);
        // Add a small delay to ensure results state is updated
        setTimeout(() => {
          handleAIAnalysis(true).catch((err) => {
            console.error('Auto AI analysis failed:', err);
          });
        }, 100);
      }
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
      `Platform Protocol,Funding Protocol,Market,Incentive (MON),Incentive (USD),APR (%),"TVL (as of ${endDateFormatted})","TVL Cost (%)","TVL Cost WoW Change (%)","Volume (${dateRangeFormatted})","Volume Cost (%)","Volume Cost WoW Change (%)"`
    ];

    // Group rows by platform protocol for subtotals
    const groupedByProtocol: { [protocol: string]: typeof processedTableRows } = {};
    for (const row of processedTableRows) {
      const protocol = row.platform.platformProtocol;
      if (!groupedByProtocol[protocol]) {
        groupedByProtocol[protocol] = [];
      }
      groupedByProtocol[protocol].push(row);
    }

    // Process each protocol group
    for (const protocol of Object.keys(groupedByProtocol)) {
      const protocolRows = groupedByProtocol[protocol];
      let protocolTotalMON = 0;
      let protocolTotalUSD = 0;
      let protocolTotalTVL = 0;
      let protocolTotalVolume = 0;

      // Add rows for this protocol
      for (const row of protocolRows) {
        // Format MON value - use toFixed to avoid commas in CSV
        const monFormatted = row.market.totalMON.toFixed(2);

        // Format USD value
        const incentiveUSD = !isNaN(monPriceNum) && monPriceNum > 0
          ? row.market.totalMON * monPriceNum
          : 0;
        const usdFormatted = incentiveUSD > 0 ? incentiveUSD.toFixed(2) : '';

        // Format APR value
        const aprFormatted = row.market.apr !== null && row.market.apr !== undefined
          ? row.market.apr.toFixed(2)
          : '';

        // Track totals for subtotal row (sum of individual pools)
        protocolTotalMON += row.market.totalMON;
        protocolTotalUSD += incentiveUSD;
        if (row.market.tvl !== null && row.market.tvl !== undefined && row.market.tvl > 0) {
          protocolTotalTVL += row.market.tvl;
        }
        if (row.volumeValue !== null && row.volumeValue !== undefined) {
          protocolTotalVolume += row.volumeValue;
        }

        // Format TVL value - use Merkl market-level TVL
        const tvlFormatted = row.market.tvl !== null && row.market.tvl !== undefined && row.market.tvl > 0
          ? row.market.tvl.toFixed(2)
          : '';

        // Format TVL Cost
        const tvlCostFormatted = row.tvlCost !== null ? row.tvlCost.toFixed(2) : '';

        // Format TVL Cost WoW Change
        const tvlCostWoWFormatted = row.wowChange !== null
          ? `${row.wowChange > 0 ? '+' : ''}${row.wowChange.toFixed(2)}`
          : '';

        // Format Volume value
        const volumeFormatted = row.volumeValue !== null && row.volumeValue !== undefined
          ? row.volumeValue.toFixed(2)
          : '';

        // Format Volume Cost
        const volumeCostFormatted = row.volumeCost !== null ? row.volumeCost.toFixed(2) : '';

        // Format Volume Cost WoW Change
        const volumeCostWoWFormatted = row.volumeWowChange !== null
          ? `${row.volumeWowChange > 0 ? '+' : ''}${row.volumeWowChange.toFixed(2)}`
          : '';

        csvLines.push(
          `${row.platform.platformProtocol},${row.funding.fundingProtocol},"${row.market.marketName}",${monFormatted},"${usdFormatted}","${aprFormatted}","${tvlFormatted}","${tvlCostFormatted}","${tvlCostWoWFormatted}","${volumeFormatted}","${volumeCostFormatted}","${volumeCostWoWFormatted}"`
        );
      }

      // Add SUBTOTAL row - sum of individual pool values
      const subtotalMON = protocolTotalMON.toFixed(2);
      const subtotalUSD = protocolTotalUSD > 0 ? protocolTotalUSD.toFixed(2) : '';
      const subtotalTVL = protocolTotalTVL > 0 ? protocolTotalTVL.toFixed(2) : '';
      const subtotalVolume = protocolTotalVolume > 0 ? protocolTotalVolume.toFixed(2) : '';

      csvLines.push(
        `${protocol} SUBTOTAL,,,${subtotalMON},"${subtotalUSD}",,"${subtotalTVL}",,,\"${subtotalVolume}\",,`
      );

      // Add PROTOCOL TOTAL row - protocol-level data from DeFiLlama/Dune APIs
      const protocolKey = protocol.toLowerCase();
      const protocolTVLValue = protocolTVL[protocolKey];
      const protocolTVLFormatted = protocolTVLValue !== null && protocolTVLValue !== undefined && protocolTVLValue > 0
        ? protocolTVLValue.toFixed(2)
        : '';

      const dexVolume = protocolDEXVolume[protocolKey];
      const protocolVolume = dexVolume?.volumeInRange ?? dexVolume?.volume7d ?? dexVolume?.volume30d ?? null;
      const protocolVolumeFormatted = protocolVolume !== null ? protocolVolume.toFixed(2) : '';

      csvLines.push(
        `${protocol} PROTOCOL TOTAL,,,,,,\"${protocolTVLFormatted}\",,,\"${protocolVolumeFormatted}\",,`
      );
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

  const exportEnhancedCSV = async () => {
    if (results.length === 0) return;

    setEnhancedCsvLoading(true);

    try {
      // Prepare pools data
      const poolsData = processedTableRows.map(row => ({
        platform: {
          platformProtocol: row.platform.platformProtocol,
        },
        funding: {
          fundingProtocol: row.funding.fundingProtocol,
        },
        market: {
          marketName: row.market.marketName,
          totalMON: row.market.totalMON,
          tvl: row.market.tvl,
          apr: row.market.apr,
        },
        volumeValue: row.volumeValue,
        merklUrl: row.market.merklUrl,
      }));

      // Call the enhanced CSV API
      const response = await fetch('/api/enhanced-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pools: poolsData,
          startDate,
          endDate,
          monPrice: monPriceNum,
          protocolTVL,
          protocolDEXVolume,
          efficiencyIssues: aiAnalysis?.efficiencyIssues || [],
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to generate enhanced CSV: ${response.statusText}`);
      }

      // Download the CSV
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `merkl-incentives-enhanced-${startDate}-${endDate}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting enhanced CSV:', error);
      setError(error instanceof Error ? error.message : 'Failed to export enhanced CSV');
    } finally {
      setEnhancedCsvLoading(false);
    }
  };

  const totalMON = useMemo(() => results.reduce((sum, r) => sum + r.totalMON, 0), [results]);
  const totalUSD = useMemo(() => {
    if (!isNaN(monPriceNum) && monPriceNum > 0) {
      return totalMON * monPriceNum;
    }
    return null;
  }, [totalMON, monPriceNum]);

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

  // Memoized processed table rows - CRITICAL PERFORMANCE OPTIMIZATION
  // This prevents recalculating all TVL costs, WoW changes, etc. on every render
  const processedTableRows = useMemo(() => {
    if (results.length === 0) return [];
    
    // Flatten all rows first
    const allRows = results.flatMap((platform) => {
      const protocolKey = platform.platformProtocol.toLowerCase();

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
          
          // Calculate percentage changes for display
          const incentiveMONChange = prevMarket ? calculateWoWChange(market.totalMON, prevMarket.totalMON) : null;
          const incentiveUSDChange = prevIncentiveUSD ? calculateWoWChange(incentiveUSD, prevIncentiveUSD) : null;
          const tvlChange = (prevMarket?.tvl !== undefined && market.tvl !== undefined) ? calculateWoWChange(market.tvl ?? null, prevMarket.tvl ?? null) : null;
          const volumeChange = prevVolumeValue ? calculateWoWChange(volumeValue, prevVolumeValue) : null;
          
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
            incentiveMONChange,
            incentiveUSDChange,
            tvlChange,
            volumeChange,
          };
        })
      );
    });

    // Sort rows if sortConfig is set
    if (sortConfig.key && sortConfig.direction) {
      return [...allRows].sort((a, b) => {
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
          case 'apr':
            aValue = a.market.apr ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
            bValue = b.market.apr ?? (sortConfig.direction === 'asc' ? Infinity : -Infinity);
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
    
    return allRows;
  }, [results, previousWeekResults, monPriceNum, periodDays, sortConfig, 
      marketVolumes, previousWeekMarketVolumes]);

  // Prepare data for AI analysis
  const prepareAIData = () => {
    console.log('[prepareAIData] Called with results.length:', results.length, 'previousWeekResults.length:', previousWeekResults.length);

    const monPriceNum = parseFloat(monPrice);
    const periodDays = Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const currentPools = results.flatMap((platform) => {
      return platform.fundingProtocols.flatMap((funding) =>
        funding.markets.map((market) => {
          // Get per-market volume from Dune (preferred) or fallback to protocol-level volume
          const marketKey = `${platform.platformProtocol}-${market.marketName}`;
          const marketVolume = marketVolumes[marketKey];
          const volumeValue = marketVolume?.volumeInRange ?? marketVolume?.volume7d ?? marketVolume?.volume30d ?? 
            (() => {
              // Fallback to protocol-level volume if per-market volume not available
              const protocolKey = platform.platformProtocol.toLowerCase();
              const dexVolume = protocolDEXVolume[protocolKey];
              return dexVolume?.volumeInRange ?? dexVolume?.volume7d ?? dexVolume?.volume30d ?? null;
            })();

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
          return platform.fundingProtocols.flatMap((funding) =>
            funding.markets.map((market) => {
              // Get per-market volume from Dune (preferred) or fallback to protocol-level volume
              const marketKey = `${platform.platformProtocol}-${market.marketName}`;
              const prevMarketVolume = previousWeekMarketVolumes[marketKey];
              const volumeValue = prevMarketVolume?.volumeInRange ?? prevMarketVolume?.volume7d ?? prevMarketVolume?.volume30d ?? 
                (() => {
                  // Fallback to protocol-level volume if per-market volume not available
                  const protocolKey = platform.platformProtocol.toLowerCase();
                  const dexVolume = previousWeekProtocolDEXVolume[protocolKey];
                  return dexVolume?.volumeInRange ?? dexVolume?.volume7d ?? dexVolume?.volume30d ?? null;
                })();

              return {
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
              };
            })
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

  // Handle bulk protocol analysis
  const handleBulkAnalysis = async () => {
    if (protocols.length === 0) {
      setError('Please select at least one protocol');
      return;
    }

    if (!startDate || !endDate) {
      setError('Please select both start and end dates');
      return;
    }

    setAnalyzing(true);
    setError('');
    setBulkAnalysisResult(null);
    const startTime = Date.now();

    try {
      const response = await fetch('/api/bulk-protocol-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          protocols,
          startDate,
          endDate,
          monPrice: parseFloat(monPrice) || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to perform bulk analysis');
      }

      const data = await response.json();
      
      if (data.success) {
        setBulkAnalysisResult(data);
        // Export report automatically
        exportBulkAnalysisReport(data);
        setError(''); // Clear any previous errors
        // Show success message briefly
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        alert(`Analysis complete! Report downloaded. (Took ${elapsed}s)`);
      } else {
        throw new Error(data.error || 'Analysis failed');
      }
      
    } catch (err: any) {
      console.error('Bulk analysis error:', err);
      setError(err.message || 'Failed to perform bulk analysis');
      setBulkAnalysisResult(null);
    } finally {
      setAnalyzing(false);
    }
  };

  // Export bulk analysis report
  const exportBulkAnalysisReport = (data: any) => {
    const report = {
      generatedAt: new Date().toISOString(),
      dateRange: {
        start: startDate,
        end: endDate,
      },
      protocols: protocols,
      analysis: data.analysis,
      protocolData: data.protocolData,
    };

    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `protocol-analysis-${startDate}-to-${endDate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle AI analysis
  const handleAIAnalysis = async (autoRun = false) => {
    console.log('[handleAIAnalysis] Called with autoRun:', autoRun, 'results.length:', results.length);

    // Always check results length, even for auto-run
    if (results.length === 0) {
      const errorMsg = 'Please query data first before running AI analysis';
      console.error('[handleAIAnalysis] Error:', errorMsg);
      setAiError(errorMsg);
      return;
    }

    setAiLoading(true);
    setAiError('');
    setAiAnalysis(null);

    try {
      const aiData = prepareAIData();
      console.log('[handleAIAnalysis] Prepared AI data with', aiData.currentWeek.pools?.length || 0, 'current pools and', aiData.previousWeek?.pools?.length || 0, 'previous pools');
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
      setAiError(''); // Clear any previous errors on success
      console.log('[AI Analysis] Analysis set successfully. Keys:', Object.keys(data.analysis || {}));
      console.log('[AI Analysis] wowExplanations count:', data.analysis?.wowExplanations?.length || 0);
      console.log('[AI Analysis] efficiencyIssues count:', data.analysis?.efficiencyIssues?.length || 0);
      console.log('[AI Analysis] protocolRecommendations count:', data.analysis?.protocolRecommendations?.length || 0);

      // Update server cache so other users can see AI analysis
      try {
        const cacheResponse = await fetch('/api/dashboard-default', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ aiAnalysis: data.analysis }),
        });

        if (cacheResponse.ok) {
          console.log('[AI Analysis] ✅ AI analysis saved to server cache for all users');
        } else {
          console.warn('[AI Analysis] ⚠️ Failed to save AI analysis to server cache');
        }
      } catch (cacheError) {
        console.warn('[AI Analysis] ⚠️ Error saving AI analysis to server cache:', cacheError);
      }
    } catch (err: any) {
      console.error('AI Analysis error:', err);
      let errorMsg = err.message || err.toString() || 'An error occurred during AI analysis';

      // Make JSON parsing errors more user-friendly
      if (errorMsg.includes('Failed to parse') && errorMsg.includes('JSON')) {
        errorMsg = 'The AI service returned an incomplete response. This is usually temporary - please try again in a moment. If the issue persists, the AI service may be experiencing high load.';
      } else if (errorMsg.includes('Maximum retries exceeded')) {
        errorMsg = 'AI analysis failed after multiple attempts. Please wait a moment and try again.';
      }

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

        {/* Auto-Loading Indicator */}
        {isAutoLoading && (
          <div className="mb-4 p-4 bg-purple-900/30 border-2 border-purple-500/50 rounded-lg flex items-center gap-3 animate-pulse">
            <svg className="animate-spin h-5 w-5 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-purple-300 font-semibold">Auto-loading dashboard...</span>
          </div>
        )}

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
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-semibold text-gray-300 uppercase tracking-wide">
                Select Protocols
              </label>
              <div className="flex gap-2">
                <button
                  onClick={selectAllProtocols}
                  type="button"
                  className="px-3 py-1 text-xs font-medium text-purple-400 border border-purple-500/50 rounded hover:bg-purple-500/10 transition-colors"
                >
                  Select All
                </button>
                <button
                  onClick={deselectAllProtocols}
                  type="button"
                  className="px-3 py-1 text-xs font-medium text-gray-400 border border-gray-600 rounded hover:bg-gray-700/30 transition-colors"
                >
                  Deselect All
                </button>
              </div>
            </div>
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

          {/* Query and Analyze Buttons */}
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleQuery()}
              disabled={loading || analyzing}
              className="bg-gradient-to-r from-purple-600 to-purple-700 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:from-purple-500 hover:to-purple-600 disabled:from-gray-700 disabled:to-gray-800 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-purple-500/50 transform hover:scale-[1.02] active:scale-[0.98]"
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
            <button
              onClick={handleBulkAnalysis}
              disabled={loading || analyzing || protocols.length === 0}
              className="bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 px-6 rounded-lg font-semibold text-lg hover:from-blue-500 hover:to-blue-600 disabled:from-gray-700 disabled:to-gray-800 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-blue-500/50 transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {analyzing ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Analyzing...
                </span>
              ) : (
                'Analyze'
              )}
            </button>
          </div>


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
                  onClick={() => handleAIAnalysis()}
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
                <button
                  onClick={exportEnhancedCSV}
                  disabled={enhancedCsvLoading || !aiAnalysis || !aiAnalysis.efficiencyIssues || aiAnalysis.efficiencyIssues.length === 0}
                  className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg font-semibold hover:from-purple-500 hover:to-pink-500 transition-all shadow-lg hover:shadow-purple-500/50 transform hover:scale-105 active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {enhancedCsvLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Generating...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                      </svg>
                      Export Enhanced CSV
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* AI Analysis Error */}
            {aiError && (
              <div className="mb-4 p-3 bg-red-900/30 border-2 border-red-500/50 rounded-lg text-red-300 text-sm font-medium">
                {aiError}
              </div>
            )}

            {/* AI Analysis Loading Message */}
            {aiLoading && !aiAnalysis && (
              <div className="mb-4 p-4 bg-purple-900/20 border-2 border-purple-500/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <svg className="animate-spin h-5 w-5 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <div>
                    <div className="text-purple-200 font-semibold">Generating AI Analysis...</div>
                    <div className="text-purple-300/70 text-sm mt-1">
                      Analyzing incentive efficiency and identifying trends (this may take 30-90 seconds)
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AI Analysis Results */}
            {aiAnalysis && (
              <details className="mb-6 bg-purple-900/20 border-2 border-purple-500/50 rounded-lg p-6">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      AI Analysis Insights
                    </h3>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
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
                </summary>

                {/* Key Findings & Recommendations */}
                {((aiAnalysis.keyFindings && aiAnalysis.keyFindings.length > 0) || (aiAnalysis.recommendations && aiAnalysis.recommendations.length > 0)) && (
                  <div className="mb-6">
                    <h4 className="text-lg font-semibold text-purple-300 mb-3">Key Findings & Recommendations</h4>
                    <ul className="space-y-2">
                      {(() => {
                        const findings = aiAnalysis.keyFindings || [];
                        const recommendations = aiAnalysis.recommendations || [];
                        const maxLength = Math.max(findings.length, recommendations.length);
                        
                        return Array.from({ length: maxLength }, (_, idx) => {
                          const finding = findings[idx];
                          const recommendation = recommendations[idx];
                          
                          // If both exist, combine them
                          if (finding && recommendation) {
                            return (
                              <li key={`paired-${idx}`} className="text-gray-300 flex items-start gap-2">
                                <span className="text-purple-400 mt-1">•</span>
                                <span>
                                  {finding}
                                  <span className="text-green-400 ml-2">→ Recommendation: {recommendation}</span>
                                </span>
                              </li>
                            );
                          }
                          
                          // If only finding exists
                          if (finding) {
                            return (
                              <li key={`finding-${idx}`} className="text-gray-300 flex items-start gap-2">
                                <span className="text-purple-400 mt-1">•</span>
                                <span>{finding}</span>
                              </li>
                            );
                          }
                          
                          // If only recommendation exists
                          if (recommendation) {
                            return (
                              <li key={`rec-${idx}`} className="text-gray-300 flex items-start gap-2">
                                <span className="text-green-400 mt-1">✓</span>
                                <span>{recommendation}</span>
                              </li>
                            );
                          }
                          
                          return null;
                        });
                      })()}
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
                          <p className="text-gray-300 text-sm mb-1 text-left">{explanation.explanation}</p>
                          <p className="text-gray-400 text-xs mb-2 text-left">Likely cause: {explanation.likelyCause}</p>
                          {explanation.competitorLinks && explanation.competitorLinks.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-700 text-left">
                              <p className="text-gray-400 text-xs mb-1">Competing pools:</p>
                              {explanation.competitorLinks.map((competitor: any, cIdx: number) => (
                                <div key={cIdx} className="text-xs text-gray-300 mb-1">
                                  <span className="text-purple-300">{competitor.protocol} {competitor.marketName}</span>
                                  {competitor.apr !== undefined && competitor.apr !== null && typeof competitor.apr === 'number' && (
                                    <span className="text-gray-400 ml-2">(APR: {competitor.apr.toFixed(2)}%)</span>
                                  )}
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
                                    <span className="text-gray-400 ml-2">- {competitor.reason}</span>
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
              </details>
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
                        <div className="absolute left-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
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
                        <div className="absolute left-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
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
                        <div className="absolute left-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
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
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
                          Total MON tokens distributed as incentives during the selected date range. Calculated from Merkl campaign daily rewards converted to MON using token price. Percentage shown compares to the value from 7 days ago.
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
                          <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
                            USD value of MON incentives. Calculated as: Incentive (MON) × MON Price. Percentage shown compares to the value from 7 days ago.
                          </div>
                        </div>
                      </th>
                    )}
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-300 uppercase">
                      <div className="group relative inline-block ml-auto cursor-help">
                        <button type="button" onClick={(e) => { e.stopPropagation(); handleSort('apr'); }} className="hover:text-white flex items-center gap-1 ml-auto cursor-pointer">
                          APR (%)
                          {sortConfig.key === 'apr' && (
                            <span className="text-purple-400">
                              {sortConfig.direction === 'asc' ? '↑' : sortConfig.direction === 'desc' ? '↓' : ''}
                            </span>
                          )}
                        </button>
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
                          Annual Percentage Rate for the pool. Shows the expected annual return from providing liquidity.
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
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
                          Total Value Locked in the pool as of the end date. Historical TVL from Merkl campaign metrics. Percentage shown compares to the value from 7 days ago.
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
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
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
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
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
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
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
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
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
                        <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] w-64 p-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-normal normal-case text-left">
                          Week-over-week percentage change in Volume Cost. Negative (green) is better (cost decreased). Red: &gt;10% increase, Green: &lt;-10% decrease. Shows "-" when volume unavailable.
                        </div>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {processedTableRows.map((row) => (
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
                              {(() => {
                                const value = row.market.totalMON.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                const change = row.incentiveMONChange;
                                if (change !== null) {
                                  const changeColor = change > 10 ? 'text-green-400' : change < -10 ? 'text-red-400' : 'text-gray-400';
                                  return (
                                    <span>
                                      {value} <span className={`text-xs ${changeColor}`}>({change > 0 ? '+' : ''}{change.toFixed(1)}%)</span>
                                    </span>
                                  );
                                }
                                return value;
                              })()}
                            </td>
                            {monPrice && parseFloat(monPrice) > 0 && (
                              <td className="py-3 px-4 text-sm text-right text-gray-300">
                                {(() => {
                                  if (!row.incentiveUSD) return '-';
                                  const value = `$${row.incentiveUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                                  const change = row.incentiveUSDChange;
                                  if (change !== null) {
                                    const changeColor = change > 10 ? 'text-green-400' : change < -10 ? 'text-red-400' : 'text-gray-400';
                                    return (
                                      <span>
                                        {value} <span className={`text-xs ${changeColor}`}>({change > 0 ? '+' : ''}{change.toFixed(1)}%)</span>
                                      </span>
                                    );
                                  }
                                  return value;
                                })()}
                              </td>
                            )}
                            <td className="py-3 px-4 text-sm text-right text-gray-300">
                              {row.market.apr !== null && row.market.apr !== undefined
                                ? `${row.market.apr.toFixed(2)}%`
                                : '-'}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-gray-300">
                              {(() => {
                                if (!row.market.tvl) return '-';
                                const value = `$${(row.market.tvl / 1000000).toFixed(2)}M`;
                                const change = row.tvlChange;
                                if (change !== null) {
                                  const changeColor = change > 10 ? 'text-green-400' : change < -10 ? 'text-red-400' : 'text-gray-400';
                                  return (
                                    <span>
                                      {value} <span className={`text-xs ${changeColor}`}>({change > 0 ? '+' : ''}{change.toFixed(1)}%)</span>
                                    </span>
                                  );
                                }
                                return value;
                              })()}
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
                                      <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] max-w-md w-96 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-pre-line normal-case text-left max-h-96 overflow-y-auto">
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
                                      <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] max-w-md w-96 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-pre-line normal-case text-left max-h-96 overflow-y-auto">
                                        {tooltip}
                                      </div>
                                    </div>
                                  );
                                }
                                return content;
                              })()}
                            </td>
                            <td className="py-3 px-4 text-sm text-right text-gray-300">
                              {(() => {
                                if (row.volumeError) {
                                  return <span className="text-red-400 text-xs" title={row.volumeError}>Not Found</span>;
                                }
                                if (!row.volumeValue) return '-';
                                const value = `$${(row.volumeValue / 1000000).toFixed(2)}M`;
                                const change = row.volumeChange;
                                if (change !== null) {
                                  const changeColor = change > 10 ? 'text-green-400' : change < -10 ? 'text-red-400' : 'text-gray-400';
                                  return (
                                    <span>
                                      {value} <span className={`text-xs ${changeColor}`}>({change > 0 ? '+' : ''}{change.toFixed(1)}%)</span>
                                    </span>
                                  );
                                }
                                return value;
                              })()}
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
                                      <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] max-w-md w-96 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-pre-line normal-case text-left max-h-96 overflow-y-auto">
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
                                      <div className="absolute right-0 top-full mt-2 hidden group-hover:block z-[9999] max-w-md w-96 p-3 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-300 shadow-xl pointer-events-none whitespace-pre-line normal-case text-left max-h-96 overflow-y-auto">
                                        {tooltip}
                                      </div>
                                    </div>
                                  );
                                }
                                return content;
                              })()}
                            </td>
                          </tr>
                    ))}
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
                                    title={(() => {
                                      const poolId = `${platform.platformProtocol}-${funding.fundingProtocol}-${market.marketName}`;
                                      const tooltip = getAITooltip(poolId, 'tvlCost');
                                      if (tooltip) {
                                        return `APR (Annual Percentage Rate) represents the annualized return from Merkl incentives. This value shows the APR at the end of your selected date range, calculated from campaign metrics. APR = (Daily Rewards / TVL) × 365 × 100\n\nAI Analysis:\n${tooltip}`;
                                      }
                                      return "APR (Annual Percentage Rate) represents the annualized return from Merkl incentives. This value shows the APR at the end of your selected date range, calculated from campaign metrics. APR = (Daily Rewards / TVL) × 365 × 100";
                                    })()}
                                  >
                                    {market.apr !== undefined && market.apr !== null && typeof market.apr === 'number' ? `${market.apr.toFixed(2)}% APR` : 'APR N/A'}
                                  </span>
                                )}
                                {market.tvl !== undefined && (
                                  <span
                                    className="text-xs text-blue-400 font-semibold bg-blue-500/10 px-2 py-0.5 rounded cursor-help flex-shrink-0"
                                    title={(() => {
                                      const poolId = `${platform.platformProtocol}-${funding.fundingProtocol}-${market.marketName}`;
                                      const tooltip = getAITooltip(poolId, 'tvlCostWoW');
                                      if (tooltip) {
                                        return `TVL (Total Value Locked) shows the total value locked in this market at the end of your selected date range, in USD\n\nWoW Change Explanation:\n${tooltip}`;
                                      }
                                      return "TVL (Total Value Locked) shows the total value locked in this market at the end of your selected date range, in USD";
                                    })()}
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

                          {/* Subtotal row for this funding protocol */}
                          <div className="flex justify-between items-center text-sm pt-2 mt-2 border-t border-purple-500/30">
                            <span className="font-semibold text-purple-300 uppercase tracking-wide">
                              Subtotal
                            </span>
                            <span className="whitespace-nowrap text-purple-300 font-bold flex-shrink-0">
                              {funding.totalMON.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })} MON
                            </span>
                          </div>
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
