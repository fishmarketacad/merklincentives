'use client';

import { useState, useEffect, useMemo } from 'react';
import { EPOCHS, Epoch, getEpochLabel } from '@/lib/epochs';

// Custom tooltip component with instant hover - shows below the element
function Tooltip({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <span className="group relative cursor-help">
      {children}
      <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-50 border border-gray-600 shadow-lg">
        {text}
      </span>
    </span>
  );
}

// Helper to render value with previous epoch percentage change
// invertColor: true means lower is better (for cost metrics)
function ValueWithPrev({
  current,
  prev,
  format = 'number',
  colorClass = '',
  invertColor = false
}: {
  current: number | null | undefined;
  prev: number | null | undefined;
  format?: 'number' | 'currency' | 'percent' | 'large';
  colorClass?: string;
  invertColor?: boolean; // true = lower is better (green when decreasing)
}) {
  const formatValue = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '-';
    switch (format) {
      case 'currency':
        return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      case 'percent':
        return `${val.toFixed(2)}%`;
      case 'large':
        if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
        if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
        if (val >= 1e3) return `$${(val / 1e3).toFixed(2)}K`;
        return `$${val.toFixed(2)}`;
      default:
        return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }
  };

  // Calculate percentage change
  const getPercentChange = () => {
    if (prev === null || prev === undefined || prev === 0) return null;
    if (current === null || current === undefined) return null;
    return ((current - prev) / prev) * 100;
  };

  const percentChange = getPercentChange();

  // Determine color: green = good, red = bad
  // For invertColor (costs): decrease is good (green), increase is bad (red)
  // For normal (TVL, volume): increase is good (green), decrease is bad (red)
  const getChangeColor = () => {
    if (percentChange === null) return 'text-gray-500';
    if (invertColor) {
      return percentChange <= 0 ? 'text-green-400' : 'text-red-400';
    } else {
      return percentChange >= 0 ? 'text-green-400' : 'text-red-400';
    }
  };

  const formatPercentChange = () => {
    if (percentChange === null) return '';
    const sign = percentChange >= 0 ? '+' : '';
    return `${sign}${percentChange.toFixed(1)}%`;
  };

  return (
    <div className="flex flex-col">
      <span className={colorClass}>{formatValue(current)}</span>
      {percentChange !== null && (
        <span className={`text-xs ${getChangeColor()}`}>
          ({formatPercentChange()})
        </span>
      )}
    </div>
  );
}

interface PoolData {
  protocol: string;
  pool: string;
  monQuantity: number;
  externalIncentiveUSD: number;
  tvl: number | null;
  volume: number | null;
  monValueUSD: number;
  adjustedTotal: number;
  // Calculated efficiency metrics
  tvlCost?: number | null;        // (MON Value) / TVL as percentage
  adjustedTvlCost?: number | null; // (MON Value + External) / TVL as percentage
}

interface EpochData {
  epoch: Epoch;
  pools: PoolData[];
  protocolTotals: Record<string, PoolData>;
  funderTotals: Record<string, PoolData>; // Aggregates by funding protocol (e.g., RENZO, WLFI)
  fetchedAt: string;
  debug?: {
    baseUrl: string;
    monDataResults: number;
    tvlDataKeys: string[];
    volumeDataKeys: string[];
  };
}

// Group pools by protocol for collapsible view
interface ProtocolGroup {
  protocol: string;
  total: PoolData;
  pools: PoolData[];
  isExpanded: boolean;
}

export default function SpreadsheetPage() {
  const [selectedEpochId, setSelectedEpochId] = useState<string>(EPOCHS[0].id);
  const [epochData, setEpochData] = useState<EpochData | null>(null);
  const [prevEpochData, setPrevEpochData] = useState<EpochData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'protocols' | 'pools' | 'funders'>('protocols');
  const [showDebug, setShowDebug] = useState(false);

  // Editable MON TWAP price
  const [customMonTwap, setCustomMonTwap] = useState<number | null>(null);
  const [editingTwap, setEditingTwap] = useState(false);
  const [twapInput, setTwapInput] = useState('');

  // Collapsible protocol groups
  const [expandedProtocols, setExpandedProtocols] = useState<Set<string>>(new Set());

  const selectedEpoch = EPOCHS.find(e => e.id === selectedEpochId);

  // Find previous epoch (EPOCHS is ordered newest to oldest)
  const selectedEpochIndex = EPOCHS.findIndex(e => e.id === selectedEpochId);
  const prevEpoch = selectedEpochIndex < EPOCHS.length - 1 ? EPOCHS[selectedEpochIndex + 1] : null;

  // Use custom TWAP or epoch default
  const effectiveMonTwap = customMonTwap ?? selectedEpoch?.monTwap ?? 0;

  useEffect(() => {
    fetchEpochData(selectedEpochId, false);
    setCustomMonTwap(null); // Reset custom TWAP when epoch changes
  }, [selectedEpochId]);

  const fetchEpochData = async (epochId: string, forceRefresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      // Fetch current epoch
      const url = forceRefresh
        ? `/api/epoch-data?epoch=${epochId}&refresh=true`
        : `/api/epoch-data?epoch=${epochId}`;
      const response = await fetch(url);
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.details || errData.error || `Failed to fetch: ${response.statusText}`);
      }
      const data = await response.json();
      setEpochData(data);

      // Fetch previous epoch (for comparison)
      const epochIndex = EPOCHS.findIndex(e => e.id === epochId);
      const previousEpoch = epochIndex < EPOCHS.length - 1 ? EPOCHS[epochIndex + 1] : null;
      if (previousEpoch) {
        try {
          const prevUrl = `/api/epoch-data?epoch=${previousEpoch.id}`;
          const prevResponse = await fetch(prevUrl);
          if (prevResponse.ok) {
            const prevData = await prevResponse.json();
            setPrevEpochData(prevData);
          } else {
            setPrevEpochData(null);
          }
        } catch {
          setPrevEpochData(null);
        }
      } else {
        setPrevEpochData(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // Calculate epoch duration in days
  const epochDays = useMemo(() => {
    if (!selectedEpoch) return 7; // default to 7 days
    const start = new Date(selectedEpoch.startDate);
    const end = new Date(selectedEpoch.endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 7;
  }, [selectedEpoch]);

  // Recalculate values with custom TWAP
  const recalculatedData = useMemo(() => {
    if (!epochData) return null;

    const recalcPool = (pool: PoolData): PoolData => {
      const monValueUSD = pool.monQuantity * effectiveMonTwap;
      const adjustedTotal = monValueUSD + pool.externalIncentiveUSD;
      // TVL Cost = (MON Value / epoch_days * 365) / TVL * 100 (annualized)
      const tvlCost = pool.tvl && pool.tvl > 0
        ? ((monValueUSD / epochDays * 365) / pool.tvl) * 100
        : null;
      // Adjusted TVL Cost = (Adjusted Total / epoch_days * 365) / TVL * 100 (annualized)
      const adjustedTvlCost = pool.tvl && pool.tvl > 0
        ? ((adjustedTotal / epochDays * 365) / pool.tvl) * 100
        : null;

      return {
        ...pool,
        monValueUSD,
        adjustedTotal,
        tvlCost,
        adjustedTvlCost,
      };
    };

    const pools = epochData.pools.map(recalcPool);
    const protocolTotals: Record<string, PoolData> = {};
    const funderTotals: Record<string, PoolData> = {};

    for (const [key, total] of Object.entries(epochData.protocolTotals)) {
      protocolTotals[key] = recalcPool(total);
    }

    for (const [key, total] of Object.entries(epochData.funderTotals || {})) {
      funderTotals[key] = recalcPool(total);
    }

    return { ...epochData, pools, protocolTotals, funderTotals };
  }, [epochData, effectiveMonTwap, epochDays]);

  // Calculate previous epoch duration
  const prevEpochDays = useMemo(() => {
    if (!prevEpoch) return 7;
    const start = new Date(prevEpoch.startDate);
    const end = new Date(prevEpoch.endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 7;
  }, [prevEpoch]);

  // Recalculate previous epoch values (using its own TWAP)
  const recalculatedPrevData = useMemo(() => {
    if (!prevEpochData || !prevEpoch) return null;

    const prevTwap = prevEpoch.monTwap;

    const recalcPool = (pool: PoolData): PoolData => {
      const monValueUSD = pool.monQuantity * prevTwap;
      const adjustedTotal = monValueUSD + pool.externalIncentiveUSD;
      const tvlCost = pool.tvl && pool.tvl > 0
        ? ((monValueUSD / prevEpochDays * 365) / pool.tvl) * 100
        : null;
      const adjustedTvlCost = pool.tvl && pool.tvl > 0
        ? ((adjustedTotal / prevEpochDays * 365) / pool.tvl) * 100
        : null;

      return {
        ...pool,
        monValueUSD,
        adjustedTotal,
        tvlCost,
        adjustedTvlCost,
      };
    };

    const protocolTotals: Record<string, PoolData> = {};
    const funderTotals: Record<string, PoolData> = {};

    for (const [key, total] of Object.entries(prevEpochData.protocolTotals)) {
      protocolTotals[key] = recalcPool(total);
    }

    for (const [key, total] of Object.entries(prevEpochData.funderTotals || {})) {
      funderTotals[key] = recalcPool(total);
    }

    return { ...prevEpochData, protocolTotals, funderTotals };
  }, [prevEpochData, prevEpoch, prevEpochDays]);

  // Group pools by protocol for collapsible view
  const protocolGroups = useMemo((): ProtocolGroup[] => {
    if (!recalculatedData) return [];

    const groups: Record<string, ProtocolGroup> = {};

    // First, create groups from protocol totals
    for (const [key, total] of Object.entries(recalculatedData.protocolTotals)) {
      groups[key] = {
        protocol: total.protocol,
        total,
        pools: [],
        isExpanded: expandedProtocols.has(key),
      };
    }

    // Then add individual pools to their protocol groups
    for (const pool of recalculatedData.pools) {
      const key = normalizeProtocol(pool.protocol);
      if (groups[key]) {
        groups[key].pools.push(pool);
      }
    }

    // Sort by total MON value descending
    return Object.values(groups).sort((a, b) => b.total.monValueUSD - a.total.monValueUSD);
  }, [recalculatedData, expandedProtocols]);

  const toggleProtocol = (protocolKey: string) => {
    setExpandedProtocols(prev => {
      const next = new Set(prev);
      if (next.has(protocolKey)) {
        next.delete(protocolKey);
      } else {
        next.add(protocolKey);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedProtocols(new Set(protocolGroups.map(g => normalizeProtocol(g.protocol))));
  };

  const collapseAll = () => {
    setExpandedProtocols(new Set());
  };

  const handleTwapEdit = () => {
    setTwapInput(effectiveMonTwap.toString());
    setEditingTwap(true);
  };

  const saveTwap = () => {
    const value = parseFloat(twapInput);
    if (!isNaN(value) && value > 0) {
      setCustomMonTwap(value);
    }
    setEditingTwap(false);
  };

  const resetTwap = () => {
    setCustomMonTwap(null);
    setEditingTwap(false);
  };

  const copyToClipboard = () => {
    if (!recalculatedData) return;

    const rows = viewMode === 'protocols'
      ? Object.values(recalculatedData.protocolTotals)
      : viewMode === 'funders'
      ? Object.values(recalculatedData.funderTotals)
      : recalculatedData.pools;

    const header = 'Protocol\tPool\tMON Quantity\tMON Value USD\tExternal USD\tAdjusted Total\tTVL\tTVL Cost %\tAdj TVL Cost %\tVolume';
    const dataRows = rows.map(row =>
      `${row.protocol}\t${row.pool}\t${row.monQuantity}\t${row.monValueUSD}\t${row.externalIncentiveUSD}\t${row.adjustedTotal}\t${row.tvl || ''}\t${row.tvlCost?.toFixed(4) || ''}\t${row.adjustedTvlCost?.toFixed(4) || ''}\t${row.volume || ''}`
    ).join('\n');

    navigator.clipboard.writeText(`${header}\n${dataRows}`);
    alert('Copied to clipboard! Paste into Google Sheets.');
  };

  const downloadCSV = () => {
    if (!recalculatedData) return;

    const rows = viewMode === 'protocols'
      ? Object.values(recalculatedData.protocolTotals)
      : viewMode === 'funders'
      ? Object.values(recalculatedData.funderTotals)
      : recalculatedData.pools;

    const header = 'Protocol,Pool,MON Quantity,MON Value USD,External USD,Adjusted Total,TVL,TVL Cost %,Adj TVL Cost %,Volume';
    const dataRows = rows.map(row =>
      `"${row.protocol}","${row.pool}",${row.monQuantity},${row.monValueUSD},${row.externalIncentiveUSD},${row.adjustedTotal},${row.tvl || ''},${row.tvlCost?.toFixed(4) || ''},${row.adjustedTvlCost?.toFixed(4) || ''},${row.volume || ''}`
    ).join('\n');

    const csv = `${header}\n${dataRows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `merkl-epoch-${selectedEpochId}-${viewMode}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Merkl Incentives - Spreadsheet Export</h1>
          <p className="text-gray-400">
            Select an epoch to view data. Copy to clipboard for easy paste into Google Sheets.
          </p>
          <a href="/" className="text-blue-400 hover:text-blue-300 text-sm">
            ← Back to Dashboard
          </a>
        </div>

        {/* Epoch Selector */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[300px]">
              <label className="block text-sm text-gray-400 mb-1">Select Epoch</label>
              <select
                value={selectedEpochId}
                onChange={(e) => setSelectedEpochId(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              >
                {EPOCHS.map(epoch => (
                  <option key={epoch.id} value={epoch.id}>
                    {getEpochLabel(epoch)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">View</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setViewMode('protocols')}
                  className={`px-4 py-2 rounded ${viewMode === 'protocols' ? 'bg-blue-600' : 'bg-gray-700'}`}
                  title="Group by platform protocol (where assets are deployed)"
                >
                  Platforms
                </button>
                <button
                  onClick={() => setViewMode('funders')}
                  className={`px-4 py-2 rounded ${viewMode === 'funders' ? 'bg-blue-600' : 'bg-gray-700'}`}
                  title="Group by funding protocol (who pays for incentives, e.g., RENZO, WLFI)"
                >
                  Funders
                </button>
                <button
                  onClick={() => setViewMode('pools')}
                  className={`px-4 py-2 rounded ${viewMode === 'pools' ? 'bg-blue-600' : 'bg-gray-700'}`}
                  title="Show all individual pools"
                >
                  All Pools
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Actions</label>
              <div className="flex gap-2">
                <button
                  onClick={() => fetchEpochData(selectedEpochId, true)}
                  disabled={loading}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 rounded"
                >
                  {loading ? 'Loading...' : 'Refresh'}
                </button>
                <button
                  onClick={copyToClipboard}
                  disabled={!recalculatedData || loading}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded"
                >
                  Copy
                </button>
                <button
                  onClick={downloadCSV}
                  disabled={!recalculatedData || loading}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded"
                >
                  CSV
                </button>
              </div>
            </div>
          </div>

          {/* Epoch Info with Editable TWAP */}
          {selectedEpoch && (
            <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Period:</span>{' '}
                <span className="font-mono">{selectedEpoch.startDate} to {selectedEpoch.endDate}</span>
              </div>
              <div>
                <span className="text-gray-400">Snapshot:</span>{' '}
                <span className="font-mono">{selectedEpoch.snapshotDate}</span>
              </div>
              <div>
                <span className="text-gray-400">MON TWAP:</span>{' '}
                {editingTwap ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="number"
                      step="0.00001"
                      value={twapInput}
                      onChange={(e) => setTwapInput(e.target.value)}
                      className="w-24 bg-gray-700 border border-gray-500 rounded px-2 py-0.5 text-sm"
                      autoFocus
                    />
                    <button onClick={saveTwap} className="text-green-400 hover:text-green-300">Save</button>
                    <button onClick={resetTwap} className="text-gray-400 hover:text-gray-300">Reset</button>
                  </span>
                ) : (
                  <span
                    className={`font-mono cursor-pointer hover:underline ${customMonTwap ? 'text-green-400' : 'text-yellow-400'}`}
                    onClick={handleTwapEdit}
                    title="Click to edit"
                  >
                    ${effectiveMonTwap.toFixed(5)}
                    {customMonTwap && <span className="text-xs ml-1">(custom)</span>}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Loading / Error */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <p className="mt-4 text-gray-400">Fetching epoch data from Merkl API...</p>
            <p className="text-xs text-gray-500 mt-2">This may take 30-60 seconds</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-400 font-bold">Error</p>
            <p className="text-red-300 text-sm mt-1">{error}</p>
            <button
              onClick={() => fetchEpochData(selectedEpochId, true)}
              className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm"
            >
              Retry
            </button>
          </div>
        )}

        {/* Debug Info */}
        {epochData?.debug && (
          <div className="mb-4">
            <button
              onClick={() => setShowDebug(!showDebug)}
              className="text-xs text-gray-500 hover:text-gray-400"
            >
              {showDebug ? '▼ Hide Debug Info' : '▶ Show Debug Info'}
            </button>
            {showDebug && (
              <div className="mt-2 p-3 bg-gray-800 rounded text-xs font-mono text-gray-400">
                <div>Base URL: {epochData.debug.baseUrl}</div>
                <div>Merkl Results: {epochData.debug.monDataResults}</div>
                <div>TVL Keys: {epochData.debug.tvlDataKeys.join(', ') || 'none'}</div>
                <div>Volume Keys: {epochData.debug.volumeDataKeys.join(', ') || 'none'}</div>
              </div>
            )}
          </div>
        )}

        {/* Data Table */}
        {recalculatedData && !loading && (
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            {/* Expand/Collapse controls for grouped view */}
            {viewMode === 'protocols' && (
              <div className="px-4 py-2 bg-gray-750 border-b border-gray-700 flex gap-2">
                <button
                  onClick={expandAll}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Expand All
                </button>
                <span className="text-gray-600">|</span>
                <button
                  onClick={collapseAll}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Collapse All
                </button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left w-8"></th>
                    <th className="px-4 py-3 text-left"><Tooltip text="Protocol name from Merkl campaigns">Protocol</Tooltip></th>
                    <th className="px-4 py-3 text-left"><Tooltip text="Pool/market name or 'ALL' for protocol totals">Pool</Tooltip></th>
                    <th className="px-4 py-3 text-right"><Tooltip text="Raw MON token quantity from Merkl">MON Qty</Tooltip></th>
                    <th className="px-4 py-3 text-right"><Tooltip text="MON Qty × MON TWAP Price">USD Value</Tooltip></th>
                    <th className="px-4 py-3 text-right"><Tooltip text="Non-MON incentives (AUSD, etc.) in USD">External</Tooltip></th>
                    <th className="px-4 py-3 text-right"><Tooltip text="MON Value + External">Total Incentive</Tooltip></th>
                    <th className="px-4 py-3 text-right"><Tooltip text="Total Value Locked (DeFiLlama/The Graph)">TVL</Tooltip></th>
                    <th className="px-4 py-3 text-right"><Tooltip text="(MON Value ÷ days × 365 ÷ TVL) × 100">TVL Cost</Tooltip></th>
                    <th className="px-4 py-3 text-right"><Tooltip text="(Adj Total ÷ days × 365 ÷ TVL) × 100">Total TVL Cost</Tooltip></th>
                    <th className="px-4 py-3 text-right"><Tooltip text="Trading volume (Dune Analytics)">Volume</Tooltip></th>
                  </tr>
                </thead>
                <tbody>
                  {viewMode === 'protocols' ? (
                    // Grouped view with collapsible protocols
                    protocolGroups.map((group) => {
                      const key = normalizeProtocol(group.protocol);
                      const hasMultiplePools = group.pools.length > 1;

                      return (
                        <React.Fragment key={key}>
                          {/* Protocol total row */}
                          <tr
                            className={`border-t border-gray-700 ${hasMultiplePools ? 'cursor-pointer hover:bg-gray-700' : 'hover:bg-gray-750'} bg-gray-800`}
                            onClick={() => hasMultiplePools && toggleProtocol(key)}
                          >
                            <td className="px-4 py-3 text-gray-500">
                              {hasMultiplePools && (
                                <span className="text-xs">
                                  {group.isExpanded ? '▼' : '▶'}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-medium">
                              {group.total.protocol}
                              {hasMultiplePools && (
                                <span className="ml-2 text-xs text-gray-500">
                                  ({group.pools.length} pools)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-400">ALL</td>
                            {(() => {
                              const prevTotal = recalculatedPrevData?.protocolTotals[key];
                              return (
                                <>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.monQuantity} prev={prevTotal?.monQuantity} />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.monValueUSD} prev={prevTotal?.monValueUSD} format="currency" colorClass="text-yellow-400" />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.externalIncentiveUSD} prev={prevTotal?.externalIncentiveUSD} format="currency" colorClass="text-blue-400" />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.adjustedTotal} prev={prevTotal?.adjustedTotal} format="currency" colorClass="text-green-400" />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.tvl} prev={prevTotal?.tvl} format="large" />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.tvlCost} prev={prevTotal?.tvlCost} format="percent" colorClass="text-orange-400" invertColor />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.adjustedTvlCost} prev={prevTotal?.adjustedTvlCost} format="percent" colorClass="text-pink-400" invertColor />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.volume} prev={prevTotal?.volume} format="large" />
                                  </td>
                                </>
                              );
                            })()}
                          </tr>

                          {/* Individual pool rows (when expanded) */}
                          {group.isExpanded && group.pools.map((pool, idx) => (
                            <tr
                              key={`${key}-${pool.pool}-${idx}`}
                              className="border-t border-gray-700/50 bg-gray-850 hover:bg-gray-800"
                            >
                              <td className="px-4 py-2"></td>
                              <td className="px-4 py-2 pl-8 text-gray-500 text-xs">↳</td>
                              <td className="px-4 py-2 text-gray-300 text-xs">{pool.pool}</td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
                                {pool.monQuantity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-yellow-400/70 text-xs">
                                ${pool.monValueUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-blue-400/70 text-xs">
                                ${pool.externalIncentiveUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-green-400/70 text-xs">
                                ${pool.adjustedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
                                {pool.tvl ? `$${formatLargeNumber(pool.tvl)}` : '-'}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-orange-400/70 text-xs">
                                {pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : '-'}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-pink-400/70 text-xs">
                                {pool.adjustedTvlCost ? `${pool.adjustedTvlCost.toFixed(2)}%` : '-'}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
                                {pool.volume ? `$${formatLargeNumber(pool.volume)}` : '-'}
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })
                  ) : viewMode === 'funders' ? (
                    // Funders view - shows aggregated data by funding protocol
                    Object.entries(recalculatedData.funderTotals)
                      .sort(([, a], [, b]) => b.monValueUSD - a.monValueUSD)
                      .map(([funderKey, row]) => {
                        const prevFunder = recalculatedPrevData?.funderTotals[funderKey];
                        return (
                        <tr key={row.protocol} className="border-t border-gray-700 hover:bg-gray-750 bg-gray-800">
                          <td className="px-4 py-3"></td>
                          <td className="px-4 py-3 font-medium">
                            {row.protocol}
                            <span className="ml-2 text-xs text-purple-400">(Funder)</span>
                          </td>
                          <td className="px-4 py-3 text-gray-400">{row.pool}</td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.monQuantity} prev={prevFunder?.monQuantity} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.monValueUSD} prev={prevFunder?.monValueUSD} format="currency" colorClass="text-yellow-400" />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.externalIncentiveUSD} prev={prevFunder?.externalIncentiveUSD} format="currency" colorClass="text-blue-400" />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.adjustedTotal} prev={prevFunder?.adjustedTotal} format="currency" colorClass="text-green-400" />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.tvl} prev={prevFunder?.tvl} format="large" />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.tvlCost} prev={prevFunder?.tvlCost} format="percent" colorClass="text-orange-400" invertColor />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.adjustedTvlCost} prev={prevFunder?.adjustedTvlCost} format="percent" colorClass="text-pink-400" invertColor />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.volume} prev={prevFunder?.volume} format="large" />
                          </td>
                        </tr>
                        );
                      })
                  ) : (
                    // Flat pools view
                    recalculatedData.pools.map((row, idx) => (
                      <tr key={`${row.protocol}-${row.pool}-${idx}`} className="border-t border-gray-700 hover:bg-gray-750">
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3 font-medium">{row.protocol}</td>
                        <td className="px-4 py-3 text-gray-400">{row.pool}</td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.monQuantity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-yellow-400">
                          ${row.monValueUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-blue-400">
                          ${row.externalIncentiveUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-green-400">
                          ${row.adjustedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.tvl ? `$${formatLargeNumber(row.tvl)}` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-orange-400">
                          {row.tvlCost ? `${row.tvlCost.toFixed(2)}%` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-pink-400">
                          {row.adjustedTvlCost ? `${row.adjustedTvlCost.toFixed(2)}%` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.volume ? `$${formatLargeNumber(row.volume)}` : '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-gray-700 text-sm text-gray-400 flex justify-between">
              <span>
                {viewMode === 'protocols'
                  ? `${protocolGroups.length} platforms, ${recalculatedData.pools.length} pools`
                  : viewMode === 'funders'
                  ? `${Object.keys(recalculatedData.funderTotals).length} funders`
                  : `${recalculatedData.pools.length} pools`}
              </span>
              <span>Last fetched: {new Date(recalculatedData.fetchedAt).toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4">How to Use</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-300">
            <li>Select the epoch you want to export</li>
            <li>Click on the <span className="text-yellow-400">MON TWAP price</span> to edit it if needed</li>
            <li>Click protocol rows to expand/collapse individual pools</li>
            <li>Click &quot;Copy&quot; to copy data to clipboard</li>
            <li>Paste into your Google Sheet</li>
          </ol>

          <div className="mt-4 p-4 bg-gray-700 rounded">
            <h3 className="font-bold mb-2">Column Explanations</h3>
            <ul className="text-sm text-gray-400 space-y-1">
              <li><strong>MON Qty</strong> - Raw MON token amount from Merkl</li>
              <li><strong>MON Value</strong> - MON Qty × MON TWAP price</li>
              <li><strong>External</strong> - Non-MON incentives (AUSD, etc.) in USD</li>
              <li><strong>Adjusted Total</strong> - MON Value + External</li>
              <li><strong className="text-orange-400">TVL Cost</strong> - (MON Value / epoch_days × 365 / TVL) × 100 - annualized cost of MON incentives relative to TVL</li>
              <li><strong className="text-pink-400">Adj TVL Cost</strong> - (Adjusted Total / epoch_days × 365 / TVL) × 100 - annualized total incentive cost relative to TVL</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatLargeNumber(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toFixed(2);
}

function normalizeProtocol(name: string): string {
  return name.toLowerCase()
    .replace(/[-_\s]+/g, '')
    .replace('pancake-swap', 'pancakeswap');
}

// Need to import React for Fragment
import React from 'react';
