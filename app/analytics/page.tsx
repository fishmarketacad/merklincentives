'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ScatterChart, Scatter, ZAxis,
  LineChart, Line,
} from 'recharts';

// Types
interface FunderTotals {
  [funder: string]: number;
}

interface ProtocolData {
  protocol: string;
  totalMON: number;
  totalUSD: number;
  tvl: number | null;
  poolCount: number;
}

interface PoolEfficiency {
  name: string;
  protocol: string;
  funder: string;
  incentiveMON: number;
  incentiveUSD: number;
  tvl: number;
  annualizedCost: number; // annualized cost = (weekly incentive * 52) / TVL as percentage
}

interface TVLTierData {
  tier: string;
  totalIncentiveUSD: number;
  poolCount: number;
  avgIncentiveUSD: number;
}

// Color palette for charts (purple theme matching the dashboard)
const COLORS = [
  '#8b5cf6', // purple-500
  '#a78bfa', // purple-400
  '#c4b5fd', // purple-300
  '#6366f1', // indigo-500
  '#818cf8', // indigo-400
  '#60a5fa', // blue-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#f87171', // red-400
  '#fb923c', // orange-400
  '#a3e635', // lime-400
  '#2dd4bf', // teal-400
];

// Date utility functions
const getYesterdayUTC = (): string => {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().split('T')[0];
};

const getSevenDaysAgoUTC = (): string => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 8);
  return sevenDaysAgo.toISOString().split('T')[0];
};

// Custom tooltip for charts
const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl">
        <p className="text-white font-medium">{label || payload[0]?.name}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-gray-300 text-sm">
            {entry.name}: {typeof entry.value === 'number'
              ? entry.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
              : entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

function AnalyticsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // State from URL params or defaults
  const [startDate, setStartDate] = useState(searchParams.get('startDate') || getSevenDaysAgoUTC());
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || getYesterdayUTC());
  const [monPrice, setMonPrice] = useState(searchParams.get('monPrice') || '');

  // Data state
  const [funderTotals, setFunderTotals] = useState<FunderTotals>({});
  const [protocolData, setProtocolData] = useState<ProtocolData[]>([]);
  const [poolEfficiency, setPoolEfficiency] = useState<PoolEfficiency[]>([]);
  const [tvlTierData, setTvlTierData] = useState<TVLTierData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Table interaction state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<'name' | 'protocol' | 'funder' | 'tvl' | 'incentiveUSD' | 'annualizedCost'>('annualizedCost');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterProtocol, setFilterProtocol] = useState<string>('all');
  const [filterFunder, setFilterFunder] = useState<string>('all');

  // Fetch MON price on mount
  useEffect(() => {
    const fetchMonPrice = async () => {
      if (!monPrice) {
        try {
          const response = await fetch('/api/mon-price');
          if (response.ok) {
            const data = await response.json();
            setMonPrice(data.price?.toString() || '0.025');
          }
        } catch (e) {
          setMonPrice('0.025');
        }
      }
    };
    fetchMonPrice();
  }, []);

  // Fetch analytics data
  useEffect(() => {
    const fetchAnalyticsData = async () => {
      setLoading(true);
      setError('');

      try {
        // Fetch funder totals
        const funderResponse = await fetch(
          `/api/funder-totals?startDate=${startDate}&endDate=${endDate}`
        );
        if (funderResponse.ok) {
          const funderData = await funderResponse.json();
          setFunderTotals(funderData.funderTotals || {});
        }

        // Fetch detailed protocol data
        const protocols = [
          'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
          'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
          'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi', 'neverland', 'balancer'
        ];

        const [monSpentResponse, tvlResponse] = await Promise.all([
          fetch('/api/query-mon-spent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ protocols, startDate, endDate, token: 'WMON' }),
          }),
          fetch('/api/protocol-tvl', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ protocols, startDate, endDate }),
          }),
        ]);

        if (monSpentResponse.ok) {
          const monData = await monSpentResponse.json();
          const tvlData = tvlResponse.ok ? await tvlResponse.json() : { tvlData: {} };

          // Process protocol data
          const priceNum = parseFloat(monPrice) || 0.025;
          const processedProtocols: ProtocolData[] = [];
          const processedPools: PoolEfficiency[] = [];

          // Calculate number of weeks in date range for annualization
          const days = Math.max(1, Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1);
          const weeks = days / 7;

          for (const result of monData.results || []) {
            const protocol = result.platformProtocol;
            const totalMON = result.totalMON || 0;
            const tvl = tvlData.tvlData?.[protocol.toLowerCase()] || null;
            let poolCount = 0;

            for (const funding of result.fundingProtocols || []) {
              const funder = funding.fundingProtocol || 'unknown';
              for (const market of funding.markets || []) {
                poolCount++;
                const marketMON = market.totalMON || 0;
                const marketTVL = market.tvl || 0;

                if (marketTVL > 0 && marketMON > 0) {
                  // Calculate annualized cost = (incentive per week * 52) / TVL as percentage
                  const incentiveUSD = marketMON * priceNum;
                  const weeklyIncentive = incentiveUSD / weeks;
                  const annualizedCost = ((weeklyIncentive * 52) / marketTVL) * 100;

                  processedPools.push({
                    name: market.marketName,
                    protocol,
                    funder,
                    incentiveMON: marketMON,
                    incentiveUSD,
                    tvl: marketTVL,
                    annualizedCost,
                  });
                }
              }
            }

            if (totalMON > 0) {
              processedProtocols.push({
                protocol,
                totalMON,
                totalUSD: totalMON * priceNum,
                tvl,
                poolCount,
              });
            }
          }

          setProtocolData(processedProtocols.sort((a, b) => b.totalMON - a.totalMON));
          setPoolEfficiency(processedPools.sort((a, b) => b.annualizedCost - a.annualizedCost));

          // Calculate TVL tier distribution
          const tiers = [
            { label: '$0-50k', min: 0, max: 50000 },
            { label: '$50k-100k', min: 50000, max: 100000 },
            { label: '$100k-500k', min: 100000, max: 500000 },
            { label: '$500k-1m', min: 500000, max: 1000000 },
            { label: '$1m-5m', min: 1000000, max: 5000000 },
            { label: '$5m-10m', min: 5000000, max: 10000000 },
            { label: '$10m-50m', min: 10000000, max: 50000000 },
            { label: '$50m+', min: 50000000, max: Infinity },
          ];

          const tierData: TVLTierData[] = tiers.map(tier => {
            const poolsInTier = processedPools.filter(
              p => p.tvl >= tier.min && p.tvl < tier.max
            );
            const totalIncentive = poolsInTier.reduce((sum, p) => sum + p.incentiveUSD, 0);
            return {
              tier: tier.label,
              totalIncentiveUSD: totalIncentive,
              poolCount: poolsInTier.length,
              avgIncentiveUSD: poolsInTier.length > 0 ? totalIncentive / poolsInTier.length : 0,
            };
          });

          setTvlTierData(tierData.filter(t => t.poolCount > 0));
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch analytics data');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalyticsData();
  }, [startDate, endDate, monPrice]);

  // Prepare chart data
  const funderChartData = useMemo(() => {
    const priceNum = parseFloat(monPrice) || 0.025;
    return Object.entries(funderTotals)
      .map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value: Math.round(value),
        valueUSD: Math.round(value * priceNum),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12); // Top 12 funders
  }, [funderTotals, monPrice]);

  const protocolChartData = useMemo(() => {
    return protocolData.slice(0, 15).map(p => ({
      name: p.protocol,
      MON: Math.round(p.totalMON),
      USD: Math.round(p.totalUSD),
      pools: p.poolCount,
    }));
  }, [protocolData]);

  const scatterData = useMemo(() => {
    return poolEfficiency
      .filter(p => p.tvl > 10000 && p.incentiveUSD > 100) // Filter noise
      .slice(0, 100)
      .map(p => ({
        x: p.tvl,
        y: p.incentiveUSD,
        z: p.annualizedCost,
        name: `${p.protocol}: ${p.name}`,
      }));
  }, [poolEfficiency]);

  const totalMONSpent = useMemo(() => {
    return Object.values(funderTotals).reduce((sum, val) => sum + val, 0);
  }, [funderTotals]);

  // Get unique protocols and funders for filters
  const uniqueProtocols = useMemo(() => {
    const protocols = new Set(poolEfficiency.map(p => p.protocol));
    return ['all', ...Array.from(protocols).sort()];
  }, [poolEfficiency]);

  const uniqueFunders = useMemo(() => {
    const funders = new Set(poolEfficiency.map(p => p.funder));
    return ['all', ...Array.from(funders).sort()];
  }, [poolEfficiency]);

  // Filtered and sorted pool data
  const filteredSortedPools = useMemo(() => {
    let filtered = poolEfficiency;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(query) ||
        p.protocol.toLowerCase().includes(query) ||
        p.funder.toLowerCase().includes(query)
      );
    }

    // Apply protocol filter
    if (filterProtocol !== 'all') {
      filtered = filtered.filter(p => p.protocol === filterProtocol);
    }

    // Apply funder filter
    if (filterFunder !== 'all') {
      filtered = filtered.filter(p => p.funder === filterFunder);
    }

    // Apply sorting
    return [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'protocol':
          comparison = a.protocol.localeCompare(b.protocol);
          break;
        case 'funder':
          comparison = a.funder.localeCompare(b.funder);
          break;
        case 'tvl':
          comparison = a.tvl - b.tvl;
          break;
        case 'incentiveUSD':
          comparison = a.incentiveUSD - b.incentiveUSD;
          break;
        case 'annualizedCost':
          comparison = a.annualizedCost - b.annualizedCost;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [poolEfficiency, searchQuery, filterProtocol, filterFunder, sortColumn, sortDirection]);

  // Handle column header click for sorting
  const handleSort = (column: typeof sortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const priceNum = parseFloat(monPrice) || 0.025;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-8 px-4">
      <div className="max-w-[95vw] mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-4">
            <Link
              href={`/?startDate=${startDate}&endDate=${endDate}&monPrice=${monPrice}`}
              className="px-4 py-2 text-sm font-medium text-gray-400 border border-gray-600 rounded-lg hover:bg-gray-700/30 transition-colors"
            >
              &larr; Back to Dashboard
            </Link>
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">
            Incentives Analytics
          </h1>
          <p className="text-gray-400 text-lg">
            Visual insights into MON incentive distribution on Monad
          </p>
        </div>

        {/* Date Range & Summary */}
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700/50 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wide">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border-2 border-purple-500/50 rounded-lg text-white focus:outline-none focus:border-purple-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wide">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border-2 border-purple-500/50 rounded-lg text-white focus:outline-none focus:border-purple-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2 uppercase tracking-wide">
                MON Price (USD)
              </label>
              <input
                type="text"
                value={monPrice}
                onChange={(e) => setMonPrice(e.target.value)}
                className="w-full px-4 py-3 bg-gray-900/50 border-2 border-purple-500/50 rounded-lg text-white focus:outline-none focus:border-purple-500 transition-all"
                placeholder="0.025"
              />
            </div>
            <div className="flex flex-col justify-end">
              <div className="bg-purple-500/20 border border-purple-500/50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-400 uppercase tracking-wide">Total MON Spent</p>
                <p className="text-2xl font-bold text-purple-400">
                  {totalMONSpent.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-sm text-gray-400">
                  ${(totalMONSpent * priceNum).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
                </p>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
          </div>
        ) : error ? (
          <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-6 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        ) : (
          <>
            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Funder Distribution Pie Chart */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700/50 p-6">
                <h2 className="text-xl font-bold text-white mb-4">MON Distribution by Funder</h2>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={funderChartData}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        dataKey="value"
                        nameKey="name"
                        label={({ name, percent }: any) => `${name || ''} (${((percent || 0) * 100).toFixed(1)}%)`}
                        labelLine={false}
                      >
                        {funderChartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  {funderChartData.slice(0, 6).map((item, index) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="text-gray-300">{item.name}</span>
                      <span className="text-gray-500 ml-auto">{item.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Protocol Bar Chart */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700/50 p-6">
                <h2 className="text-xl font-bold text-white mb-4">Incentives by Protocol</h2>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={protocolChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis type="number" stroke="#9ca3af" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                      <YAxis type="category" dataKey="name" stroke="#9ca3af" width={100} tick={{ fontSize: 12 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="MON" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* TVL Tier Distribution */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700/50 p-6">
                <h2 className="text-xl font-bold text-white mb-4">Incentives by TVL Tier</h2>
                <p className="text-gray-400 text-sm mb-4">Distribution of incentive spending across pool TVL tiers</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tvlTierData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="tier" stroke="#9ca3af" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#9ca3af" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl">
                                <p className="text-white font-medium">{data.tier}</p>
                                <p className="text-gray-300 text-sm">Total: ${data.totalIncentiveUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                                <p className="text-gray-300 text-sm">Pools: {data.poolCount}</p>
                                <p className="text-gray-300 text-sm">Avg/Pool: ${data.avgIncentiveUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="totalIncentiveUSD" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 text-xs text-gray-500 text-center">
                  {tvlTierData.reduce((sum, t) => sum + t.poolCount, 0)} pools across {tvlTierData.length} TVL tiers
                </div>
              </div>

              {/* TVL vs Incentive Scatter */}
              <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700/50 p-6">
                <h2 className="text-xl font-bold text-white mb-4">TVL vs Incentive Cost</h2>
                <p className="text-gray-400 text-sm mb-4">Identify efficiency anomalies - bubble size = annualized cost %</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis
                        type="number"
                        dataKey="x"
                        name="TVL"
                        stroke="#9ca3af"
                        tickFormatter={(v) => `$${(v / 1000000).toFixed(1)}M`}
                        domain={['dataMin', 'dataMax']}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        name="Incentive (USD)"
                        stroke="#9ca3af"
                        tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                      />
                      <ZAxis type="number" dataKey="z" range={[50, 400]} name="Ann. Cost %" />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl max-w-xs">
                                <p className="text-white font-medium text-sm">{data.name}</p>
                                <p className="text-gray-300 text-sm">TVL: ${data.x.toLocaleString()}</p>
                                <p className="text-gray-300 text-sm">Incentive: ${data.y.toLocaleString()}</p>
                                <p className="text-purple-400 text-sm font-medium">{data.z.toFixed(2)}% Ann. Cost</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Scatter data={scatterData} fill="#8b5cf6" fillOpacity={0.6} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Pool Efficiency Table */}
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl shadow-2xl border border-gray-700/50 p-6">
              <h2 className="text-xl font-bold text-white mb-4">Pool Efficiency Analysis</h2>
              <p className="text-gray-400 text-sm mb-4">
                Annualized Cost % = (Weekly Incentive × 52) / TVL × 100
              </p>

              {/* Search and Filters */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Search</label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search pool, protocol, or funder..."
                    className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Protocol</label>
                  <select
                    value={filterProtocol}
                    onChange={(e) => setFilterProtocol(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 transition-all"
                  >
                    {uniqueProtocols.map(p => (
                      <option key={p} value={p}>{p === 'all' ? 'All Protocols' : p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Funder</label>
                  <select
                    value={filterFunder}
                    onChange={(e) => setFilterFunder(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-900/50 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-purple-500 transition-all"
                  >
                    {uniqueFunders.map(f => (
                      <option key={f} value={f}>{f === 'all' ? 'All Funders' : f}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <div className="bg-gray-700/30 rounded-lg px-4 py-2 text-sm">
                    <span className="text-gray-400">Showing </span>
                    <span className="text-white font-medium">{filteredSortedPools.length}</span>
                    <span className="text-gray-400"> of {poolEfficiency.length} pools</span>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-700">
                      <th
                        className="pb-3 font-medium cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('name')}
                      >
                        Pool {sortColumn === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="pb-3 font-medium cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('protocol')}
                      >
                        Protocol {sortColumn === 'protocol' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="pb-3 font-medium cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('funder')}
                      >
                        Funder {sortColumn === 'funder' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="pb-3 font-medium text-right cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('tvl')}
                      >
                        TVL {sortColumn === 'tvl' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="pb-3 font-medium text-right cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('incentiveUSD')}
                      >
                        Incentive (USD) {sortColumn === 'incentiveUSD' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="pb-3 font-medium text-right cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort('annualizedCost')}
                      >
                        Ann. Cost % {sortColumn === 'annualizedCost' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSortedPools.slice(0, 50).map((pool, index) => {
                      // Color code based on annualized cost thresholds
                      const isHigh = pool.annualizedCost > 100; // > 100% annual cost
                      const isModerate = pool.annualizedCost > 50;
                      return (
                        <tr key={index} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                          <td className="py-3 text-white font-medium max-w-[200px] truncate" title={pool.name}>{pool.name}</td>
                          <td className="py-3 text-gray-400">{pool.protocol}</td>
                          <td className="py-3 text-gray-400">{pool.funder}</td>
                          <td className="py-3 text-right text-gray-300">${pool.tvl.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="py-3 text-right text-gray-300">${pool.incentiveUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="py-3 text-right font-mono">
                            <span className={isHigh ? 'text-red-400' : isModerate ? 'text-amber-400' : 'text-green-400'}>
                              {pool.annualizedCost.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredSortedPools.length > 50 && (
                  <div className="text-center text-gray-400 text-sm mt-4">
                    Showing top 50 results. Use filters to narrow down.
                  </div>
                )}
                {filteredSortedPools.length === 0 && (
                  <div className="text-center text-gray-400 text-sm py-8">
                    No pools match your search criteria.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    }>
      <AnalyticsContent />
    </Suspense>
  );
}
