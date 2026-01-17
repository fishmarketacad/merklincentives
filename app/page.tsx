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

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [protocols, setProtocols] = useState<string[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [monPrice, setMonPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<QueryResult[]>([]);
  const [error, setError] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const [protocolTVL, setProtocolTVL] = useState<ProtocolTVL>({});
  const [protocolTVLMetadata, setProtocolTVLMetadata] = useState<ProtocolTVLMetadata>({});
  
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
    router.replace(newURL, { scroll: false });
  }, [protocols, startDate, endDate, monPrice, isInitialized, router]);

  const commonProtocols = [
    'clober',
    'curvance',
    'gearbox',
    'kuru',
    'morpho',
    'euler',
    'pancakeswap',
    'monday-trade',
    'renzo',
    'upshift',
    'townsquare',
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

    try {
      // Fetch MON spent data and TVL in parallel
      const [monSpentResponse, tvlResponse] = await Promise.all([
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
            endDate, // Pass end date for historical TVL lookup
          }),
        }),
      ]);

      const monSpentData = await monSpentResponse.json();
      if (!monSpentResponse.ok) {
        throw new Error(monSpentData.error || 'Failed to fetch data');
      }

      setResults(monSpentData.results || []);

      // Update TVL data
      const tvlData = await tvlResponse.json();
      if (tvlData.success && tvlData.tvlData) {
        setProtocolTVL(tvlData.tvlData);
      }
      if (tvlData.success && tvlData.tvlMetadata) {
        setProtocolTVLMetadata(tvlData.tvlMetadata);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    if (results.length === 0) return;

    const csvLines = ['Platform Protocol,Funding Protocol,Market,Total MON'];
    
    for (const platform of results) {
      for (const funding of platform.fundingProtocols) {
        for (const market of funding.markets) {
          csvLines.push(
            `${platform.platformProtocol},${funding.fundingProtocol},"${market.marketName}",${market.totalMON}`
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <svg width="64" height="64" viewBox="0 0 182 184" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M90.5358 0C64.3911 0 0 65.2598 0 91.7593C0 118.259 64.3911 183.52 90.5358 183.52C116.681 183.52 181.073 118.258 181.073 91.7593C181.073 65.2609 116.682 0 90.5358 0ZM76.4273 144.23C65.4024 141.185 35.7608 88.634 38.7655 77.4599C41.7703 66.2854 93.62 36.2439 104.645 39.2892C115.67 42.3341 145.312 94.8846 142.307 106.059C139.302 117.234 87.4522 147.276 76.4273 144.23Z" fill="#6E54FF"/>
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">
            Merkl MON Spent Query Tool
          </h1>
          <p className="text-gray-400 text-lg">
            Query MON incentives spent across protocols on Monad
          </p>
        </div>

        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700/50 p-6 mb-4">
          {/* Date Range */}
          <div className="grid grid-cols-2 gap-4 mb-6">
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
          </div>

          {/* MON Price (Optional) */}
          <div className="mb-6">
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
              Enter the MON price at the snapshot date to calculate USD values for the grand total
            </p>
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
                      <strong>APR</strong> and <strong>TVL</strong> are historical values at the end of your date range, not the current values.
                    </span>
                </div>
              </div>
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

            <div className="space-y-4">
              {results.map((platform, platformIdx) => {
                const protocolKey = platform.platformProtocol.toLowerCase();
                const protocolTVLValue = protocolTVL[protocolKey];
                const tvlMetadata = protocolTVLMetadata[protocolKey];
                const isHistorical = tvlMetadata?.isHistorical ?? false;
                
                return (
                  <div key={platformIdx} className="border-l-4 border-purple-500/50 pl-4 py-2 hover:border-purple-500 transition-all">
                    <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-700">
                      <div className="flex items-center gap-3">
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
                            <div key={marketIdx} className="flex justify-between items-center text-sm text-gray-400 py-1">
                              <div className="flex items-center gap-2 truncate max-w-md">
                                {market.merklUrl ? (
                                  <a
                                    href={market.merklUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium hover:text-purple-400 transition-colors underline decoration-purple-500/50 hover:decoration-purple-400"
                                    title={`View ${market.marketName} on Merkl`}
                                  >
                                    {market.marketName}
                                  </a>
                                ) : (
                                  <span className="font-medium" title={market.marketName}>
                                    {market.marketName}
                                  </span>
                                )}
                                {market.apr !== undefined && (
                                  <span 
                                    className="text-xs text-purple-400 font-semibold bg-purple-500/10 px-2 py-0.5 rounded cursor-help"
                                    title="APR (Annual Percentage Rate) represents the annualized return from Merkl incentives. This value shows the APR at the end of your selected date range, calculated from campaign metrics. APR = (Daily Rewards / TVL) × 365 × 100"
                                  >
                                    {market.apr.toFixed(2)}% APR
                                  </span>
                                )}
                                {market.tvl !== undefined && (
                                  <span 
                                    className="text-xs text-blue-400 font-semibold bg-blue-500/10 px-2 py-0.5 rounded cursor-help"
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
                              <span className="ml-4 whitespace-nowrap text-gray-300 font-semibold">
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
