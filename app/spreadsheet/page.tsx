'use client';

import { useState, useEffect, useMemo } from 'react';
import { EPOCHS, Epoch, getAllWeeksAsync, Week } from '@/lib/epochs';

// Helper to format dates as MM/DD
function formatDisplayDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${month}/${day}`;
}

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
  warnings?: string[];  // Data fetching warnings
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
  // Load all weeks (including dynamic epochs from Redis)
  const [allWeeks, setAllWeeks] = useState<Week[]>([]);
  const [weeksLoading, setWeeksLoading] = useState(true);

  // Load weeks on mount
  useEffect(() => {
    const loadWeeks = async () => {
      setWeeksLoading(true);
      try {
        const weeks = await getAllWeeksAsync();
        setAllWeeks(weeks);
      } catch (error) {
        console.error('Failed to load weeks:', error);
        // Fallback to EPOCHS if dynamic fetch fails
        const fallbackWeeks: Week[] = [];
        for (const epoch of EPOCHS) {
          const start = new Date(epoch.startDate + 'T00:00:00Z');
          const end = new Date(epoch.endDate + 'T00:00:00Z');
          const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
          fallbackWeeks.push({
            id: `${epoch.id}-w1`,
            name: epoch.name,
            startDate: epoch.startDate,
            endDate: epoch.endDate,
            epochId: epoch.id,
            epoch: epoch,
          });
        }
        setAllWeeks(fallbackWeeks);
      } finally {
        setWeeksLoading(false);
      }
    };
    loadWeeks();
  }, []);

  // Find the current week (or most recent week if today is not in any week)
  const getCurrentWeekId = () => {
    if (allWeeks.length === 0) return EPOCHS[0]?.id || '5-w1';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Try to find a week that contains today
    for (const week of allWeeks) {
      const weekStart = new Date(week.startDate + 'T00:00:00Z');
      const weekEnd = new Date(week.endDate + 'T00:00:00Z');

      if (today >= weekStart && today < weekEnd) {
        return week.id;
      }
    }

    // If no week contains today, return the most recent week (first in list)
    return allWeeks[0]?.id || EPOCHS[0].id;
  };

  const [selectedWeekId, setSelectedWeekId] = useState<string>('');
  const [epochData, setEpochData] = useState<EpochData | null>(null);
  const [prevEpochData, setPrevEpochData] = useState<EpochData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState<1 | 2 | 3 | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'protocols' | 'pools' | 'funders'>('protocols');
  const [showDebug, setShowDebug] = useState(false);

  // Client-side cache for epoch data
  const [epochCache, setEpochCache] = useState<Record<string, EpochData>>({});

  // Sorting state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Editable MON TWAP price
  const [customMonTwap, setCustomMonTwap] = useState<number | null>(null);
  const [editingTwap, setEditingTwap] = useState(false);
  const [twapInput, setTwapInput] = useState('');

  // Collapsible protocol groups
  const [expandedProtocols, setExpandedProtocols] = useState<Set<string>>(new Set());

  // Initialize selectedWeekId on mount
  useEffect(() => {
    if (allWeeks.length > 0 && !selectedWeekId) {
      setSelectedWeekId(getCurrentWeekId());
    }
  }, [allWeeks]);

  // Find selected week and its epoch
  const selectedWeek = allWeeks.find(w => w.id === selectedWeekId);
  const selectedEpoch = selectedWeek?.epoch;

  // Find previous week for comparison
  const selectedWeekIndex = allWeeks.findIndex(w => w.id === selectedWeekId);
  const prevWeek = selectedWeekIndex < allWeeks.length - 1 ? allWeeks[selectedWeekIndex + 1] : null;
  const prevEpoch = prevWeek?.epoch;

  // Use custom TWAP or epoch default
  const effectiveMonTwap = customMonTwap ?? selectedEpoch?.monTwap ?? 0;

  useEffect(() => {
    if (selectedEpoch) {
      fetchEpochData(selectedEpoch.id, false);
      setCustomMonTwap(null); // Reset custom TWAP when week changes
    }
  }, [selectedWeekId, selectedEpoch]);

  const fetchEpochData = async (epochId: string, forceRefresh: boolean) => {
    // Check cache first (unless force refresh)
    if (!forceRefresh && epochCache[epochId]) {
      console.log(`[Cache] Using cached data for epoch ${epochId}`);
      setEpochData(epochCache[epochId]);
      return;
    }

    setLoading(true);
    setError(null);
    setLoadingStage(null);

    try {
      // If force refresh, use the full endpoint (not progressive)
      if (forceRefresh) {
        const url = `/api/epoch-data?epoch=${epochId}&refresh=true`;
        const response = await fetch(url);
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.details || errData.error || `Failed to fetch: ${response.statusText}`);
        }
        const data = await response.json();
        setEpochData(data);
        setEpochCache(prev => ({ ...prev, [epochId]: data }));
      } else {
        // Progressive loading: fetch in 3 stages
        // Stage 1: MON incentive data
        setLoadingStage(1);
        const stage1Response = await fetch(`/api/epoch-data-progressive?epoch=${epochId}&stage=1`);
        if (!stage1Response.ok) {
          const errData = await stage1Response.json();
          throw new Error(errData.details || errData.error || 'Stage 1 failed');
        }
        const stage1Data = await stage1Response.json();
        setEpochData(stage1Data);

        // Stage 2: Add TVL data
        setLoadingStage(2);
        const stage2Response = await fetch(`/api/epoch-data-progressive?epoch=${epochId}&stage=2`);
        if (!stage2Response.ok) {
          const errData = await stage2Response.json();
          throw new Error(errData.details || errData.error || 'Stage 2 failed');
        }
        const stage2Data = await stage2Response.json();
        setEpochData(stage2Data);

        // Stage 3: Add volume data
        setLoadingStage(3);
        const stage3Response = await fetch(`/api/epoch-data-progressive?epoch=${epochId}&stage=3`);
        if (!stage3Response.ok) {
          const errData = await stage3Response.json();
          throw new Error(errData.details || errData.error || 'Stage 3 failed');
        }
        const stage3Data = await stage3Response.json();
        setEpochData(stage3Data);

        // Cache the complete data
        setEpochCache(prev => ({ ...prev, [epochId]: stage3Data }));
      }

      // Fetch previous epoch (for comparison) - use full endpoint
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
      setLoadingStage(null);
    }
  };

  // Calculate week duration in days (should always be 7 for weeks)
  const epochDays = useMemo(() => {
    if (!selectedWeek) return 7; // default to 7 days
    const start = new Date(selectedWeek.startDate);
    const end = new Date(selectedWeek.endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 7;
  }, [selectedWeek]);

  // Recalculate values with custom TWAP
  const recalculatedData = useMemo(() => {
    if (!epochData) return null;

    const recalcPool = (pool: PoolData, debug = false): PoolData => {
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

      // Debug logging for TVL Cost calculation
      if (debug && pool.pool === 'ALL') {
        console.log(`[TVL Cost Debug] ${pool.protocol}:`, {
          monQuantity: pool.monQuantity,
          effectiveMonTwap,
          monValueUSD,
          externalIncentiveUSD: pool.externalIncentiveUSD,
          adjustedTotal,
          tvl: pool.tvl,
          epochDays,
          annualizedMON: monValueUSD / epochDays * 365,
          tvlCost,
          adjustedTvlCost,
          formula: `(${monValueUSD.toFixed(2)} / ${epochDays} * 365) / ${pool.tvl} * 100 = ${tvlCost?.toFixed(4)}%`
        });
      }

      return {
        ...pool,
        monValueUSD,
        adjustedTotal,
        tvlCost,
        adjustedTvlCost,
      };
    };

    // Debug: log first few pools to check TVL values
    const uniswapPools = epochData.pools.filter(p => p.protocol.toLowerCase().includes('uniswap'));
    if (uniswapPools.length > 0) {
      console.log('[Pool TVL Debug] First 3 Uniswap pools from API:', uniswapPools.slice(0, 3).map(p => ({
        pool: p.pool,
        monQuantity: p.monQuantity,
        tvl: p.tvl,
        hasPoolTvl: p.tvl !== null && p.tvl !== undefined
      })));
    }

    const pools = epochData.pools.map(p => recalcPool(p, false));
    const protocolTotals: Record<string, PoolData> = {};
    const funderTotals: Record<string, PoolData> = {};

    console.log('[TVL Cost Debug] epochDays:', epochDays, 'effectiveMonTwap:', effectiveMonTwap);
    for (const [key, total] of Object.entries(epochData.protocolTotals)) {
      protocolTotals[key] = recalcPool(total, true); // Enable debug for protocol totals
    }

    for (const [key, total] of Object.entries(epochData.funderTotals || {})) {
      funderTotals[key] = recalcPool(total, false);
    }

    return { ...epochData, pools, protocolTotals, funderTotals };
  }, [epochData, effectiveMonTwap, epochDays]);

  // Calculate previous week duration
  const prevEpochDays = useMemo(() => {
    if (!prevWeek) return 7;
    const start = new Date(prevWeek.startDate);
    const end = new Date(prevWeek.endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 7;
  }, [prevWeek]);

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

  // Handler for sorting (cycles: none → desc → asc → none)
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      if (sortDirection === 'desc') {
        setSortDirection('asc');
      } else {
        // Reset to no sort
        setSortColumn(null);
        setSortDirection('desc');
      }
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Group pools by protocol for collapsible view
  const protocolGroups = useMemo((): (ProtocolGroup & { key: string })[] => {
    if (!recalculatedData) return [];

    const groups: Record<string, ProtocolGroup & { key: string }> = {};

    // First, create groups from protocol totals
    for (const [key, total] of Object.entries(recalculatedData.protocolTotals)) {
      groups[key] = {
        key, // Store the original key to avoid duplicate key issues
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

    let sorted = Object.values(groups);

    // Apply sorting if column is selected
    if (sortColumn) {
      sorted = sorted.sort((a, b) => {
        let aVal: any = 0;
        let bVal: any = 0;

        switch (sortColumn) {
          case 'protocol':
            aVal = a.total.protocol.toLowerCase();
            bVal = b.total.protocol.toLowerCase();
            break;
          case 'monQuantity':
            aVal = a.total.monQuantity;
            bVal = b.total.monQuantity;
            break;
          case 'monValueUSD':
            aVal = a.total.monValueUSD;
            bVal = b.total.monValueUSD;
            break;
          case 'externalIncentiveUSD':
            aVal = a.total.externalIncentiveUSD;
            bVal = b.total.externalIncentiveUSD;
            break;
          case 'adjustedTotal':
            aVal = a.total.adjustedTotal;
            bVal = b.total.adjustedTotal;
            break;
          case 'tvl':
            aVal = a.total.tvl || 0;
            bVal = b.total.tvl || 0;
            break;
          case 'tvlCost':
            aVal = a.total.tvlCost || 0;
            bVal = b.total.tvlCost || 0;
            break;
          case 'adjustedTvlCost':
            aVal = a.total.adjustedTvlCost || 0;
            bVal = b.total.adjustedTvlCost || 0;
            break;
          case 'volume':
            aVal = a.total.volume || 0;
            bVal = b.total.volume || 0;
            break;
          default:
            aVal = a.total.monValueUSD;
            bVal = b.total.monValueUSD;
        }

        if (typeof aVal === 'string') {
          return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      });
    } else {
      // Default sort by MON value descending
      sorted = sorted.sort((a, b) => b.total.monValueUSD - a.total.monValueUSD);
    }

    return sorted;
  }, [recalculatedData, expandedProtocols, sortColumn, sortDirection]);

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

    const header = 'Protocol\tPool\tMON Quantity\tMON Value USD\tExternal USD\tAdjusted Total\tTVL\tTVL Cost %\tAdj TVL Cost %\tVolume';
    let dataRows: string[] = [];

    if (viewMode === 'protocols') {
      // Include protocol totals AND sub-rows
      for (const group of protocolGroups) {
        // Add protocol total row
        const total = group.total;
        dataRows.push(
          `${total.protocol}\t${total.pool}\t${total.monQuantity}\t${total.monValueUSD}\t${total.externalIncentiveUSD}\t${total.adjustedTotal}\t${total.tvl || ''}\t${total.tvlCost?.toFixed(4) || ''}\t${total.adjustedTvlCost?.toFixed(4) || ''}\t${total.volume || ''}`
        );
        // Add sub-rows (individual pools)
        for (const pool of group.pools) {
          dataRows.push(
            `  ${pool.protocol}\t${pool.pool}\t${pool.monQuantity}\t${pool.monValueUSD}\t${pool.externalIncentiveUSD}\t${pool.adjustedTotal}\t${pool.tvl || ''}\t${pool.tvlCost?.toFixed(4) || ''}\t${pool.adjustedTvlCost?.toFixed(4) || ''}\t${pool.volume || ''}`
          );
        }
      }
    } else {
      // For funders and all pools view, use simple row mapping
      const rows = viewMode === 'funders'
        ? Object.values(recalculatedData.funderTotals)
        : recalculatedData.pools;

      dataRows = rows.map(row =>
        `${row.protocol}\t${row.pool}\t${row.monQuantity}\t${row.monValueUSD}\t${row.externalIncentiveUSD}\t${row.adjustedTotal}\t${row.tvl || ''}\t${row.tvlCost?.toFixed(4) || ''}\t${row.adjustedTvlCost?.toFixed(4) || ''}\t${row.volume || ''}`
      );
    }

    navigator.clipboard.writeText(`${header}\n${dataRows.join('\n')}`);
    alert('Copied to clipboard! Paste into Google Sheets.');
  };

  const downloadCSV = () => {
    if (!recalculatedData) return;

    const header = 'Protocol,Pool,MON Quantity,MON Value USD,External USD,Adjusted Total,TVL,TVL Cost %,Adj TVL Cost %,Volume';
    let dataRows: string[] = [];

    if (viewMode === 'protocols') {
      // Include protocol totals AND sub-rows
      for (const group of protocolGroups) {
        // Add protocol total row
        const total = group.total;
        dataRows.push(
          `"${total.protocol}","${total.pool}",${total.monQuantity},${total.monValueUSD},${total.externalIncentiveUSD},${total.adjustedTotal},${total.tvl || ''},${total.tvlCost?.toFixed(4) || ''},${total.adjustedTvlCost?.toFixed(4) || ''},${total.volume || ''}`
        );
        // Add sub-rows (individual pools)
        for (const pool of group.pools) {
          dataRows.push(
            `"  ${pool.protocol}","${pool.pool}",${pool.monQuantity},${pool.monValueUSD},${pool.externalIncentiveUSD},${pool.adjustedTotal},${pool.tvl || ''},${pool.tvlCost?.toFixed(4) || ''},${pool.adjustedTvlCost?.toFixed(4) || ''},${pool.volume || ''}`
          );
        }
      }
    } else {
      // For funders and all pools view, use simple row mapping
      const rows = viewMode === 'funders'
        ? Object.values(recalculatedData.funderTotals)
        : recalculatedData.pools;

      dataRows = rows.map(row =>
        `"${row.protocol}","${row.pool}",${row.monQuantity},${row.monValueUSD},${row.externalIncentiveUSD},${row.adjustedTotal},${row.tvl || ''},${row.tvlCost?.toFixed(4) || ''},${row.adjustedTvlCost?.toFixed(4) || ''},${row.volume || ''}`
      );
    }

    const csv = `${header}\n${dataRows.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `merkl-${selectedWeekId}-${viewMode}.csv`;
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

        {/* Week Selector */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[300px]">
              <label className="block text-sm text-gray-400 mb-1">Select Week</label>
              <select
                value={selectedWeekId}
                onChange={(e) => setSelectedWeekId(e.target.value)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              >
                {allWeeks.map(week => {
                  const start = formatDisplayDate(week.startDate);
                  const end = formatDisplayDate(week.endDate);
                  const twapStr = week.epoch.monTwap > 0
                    ? `$${week.epoch.monTwap.toFixed(5)}${week.epoch.monTwapChange ? ` (${week.epoch.monTwapChange})` : ''}`
                    : '';
                  return (
                    <option key={week.id} value={week.id}>
                      {week.name} - {start} to {end}{twapStr ? ` - MON Price ${twapStr}` : ''}
                    </option>
                  );
                })}
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
                  onClick={() => selectedEpoch && fetchEpochData(selectedEpoch.id, true)}
                  disabled={loading || !selectedEpoch}
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

          {/* Week Info with Editable TWAP */}
          {selectedWeek && selectedEpoch && (
            <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Week Period:</span>{' '}
                <span className="font-mono">{selectedWeek.startDate} to {selectedWeek.endDate}</span>
              </div>
              <div>
                <span className="text-gray-400">Epoch Snapshot:</span>{' '}
                <span className="font-mono">{selectedEpoch.snapshotDate}</span>
              </div>
              <div>
                <span className="text-gray-400">MON Price:</span>{' '}
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

        {/* Loading Indicator (non-blocking) */}
        {loading && loadingStage && (
          <div className="mb-4 bg-gray-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
              <div className="flex-1">
                <p className="text-sm text-gray-300 mb-2">
                  Loading data (Stage {loadingStage}/3)
                </p>
                <div className="flex gap-4 text-xs mb-2">
                  <span className={loadingStage >= 1 ? 'text-green-400' : 'text-gray-500'}>
                    {loadingStage === 1 ? '⏳ ' : loadingStage > 1 ? '✓ ' : ''}MON Incentives
                  </span>
                  <span className={loadingStage >= 2 ? 'text-green-400' : 'text-gray-500'}>
                    {loadingStage === 2 ? '⏳ ' : loadingStage > 2 ? '✓ ' : ''}TVL Data
                  </span>
                  <span className={loadingStage >= 3 ? 'text-green-400' : 'text-gray-500'}>
                    {loadingStage === 3 ? '⏳ ' : ''}Volume Data
                  </span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${(loadingStage / 3) * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Initial Loading (before any data) */}
        {loading && !loadingStage && !epochData && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <p className="mt-4 text-gray-400">Fetching epoch data...</p>
          </div>
        )}

        {/* Data Warnings */}
        {epochData?.warnings && epochData.warnings.length > 0 && (
          <div className="mb-4 bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-yellow-500 text-lg">⚠️</span>
              <div className="flex-1">
                <p className="text-yellow-200 font-semibold text-sm mb-1">Data Incomplete</p>
                <ul className="text-yellow-300 text-xs space-y-1">
                  {epochData.warnings.map((warning, idx) => (
                    <li key={idx}>• {warning}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
            <p className="text-red-400 font-bold">Error</p>
            <p className="text-red-300 text-sm mt-1">{error}</p>
            <button
              onClick={() => selectedEpoch && fetchEpochData(selectedEpoch.id, true)}
              disabled={!selectedEpoch}
              className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 rounded text-sm"
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
                    <th
                      className="px-4 py-3 text-left cursor-pointer hover:bg-gray-600"
                      onClick={() => handleSort('protocol')}
                    >
                      <div className="flex items-center gap-1">
                        <Tooltip text="Protocol name from Merkl campaigns">Protocol</Tooltip>
                        {sortColumn === 'protocol' && <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left"><Tooltip text="Pool/market name or 'ALL' for protocol totals">Pool</Tooltip></th>
                    <th
                      className="px-4 py-3 text-right cursor-pointer hover:bg-gray-600"
                      onClick={() => handleSort('monQuantity')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip text="Raw MON token quantity from Merkl">MON Qty</Tooltip>
                        {sortColumn === 'monQuantity' && <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-right cursor-pointer hover:bg-gray-600"
                      onClick={() => handleSort('monValueUSD')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip text="MON Qty × MON Price">USD Value</Tooltip>
                        {sortColumn === 'monValueUSD' && <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-right cursor-pointer hover:bg-gray-600"
                      onClick={() => handleSort('externalIncentiveUSD')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip text="Non-MON incentives (AUSD, etc.) in USD">External</Tooltip>
                        {sortColumn === 'externalIncentiveUSD' && <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-right cursor-pointer hover:bg-gray-600"
                      onClick={() => handleSort('adjustedTotal')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip text="MON Incentives + External">Total Incentive</Tooltip>
                        {sortColumn === 'adjustedTotal' && <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-right cursor-pointer hover:bg-gray-600"
                      onClick={() => handleSort('tvl')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip text="Total Value Locked (DeFiLlama/The Graph)">TVL</Tooltip>
                        {sortColumn === 'tvl' && <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-right cursor-pointer hover:bg-gray-600"
                      onClick={() => handleSort('tvlCost')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip text="(MON Incentives ÷ days × 365 ÷ TVL) × 100">TVL Cost</Tooltip>
                        {sortColumn === 'tvlCost' && <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-right cursor-pointer hover:bg-gray-600"
                      onClick={() => handleSort('adjustedTvlCost')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip text="(Total Incentives ÷ days × 365 ÷ TVL) × 100">Total TVL Cost</Tooltip>
                        {sortColumn === 'adjustedTvlCost' && <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-right cursor-pointer hover:bg-gray-600"
                      onClick={() => handleSort('volume')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip text="Trading volume (Dune Analytics)">Volume</Tooltip>
                        {sortColumn === 'volume' && <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {viewMode === 'protocols' ? (
                    // Grouped view with collapsible protocols
                    protocolGroups.map((group) => {
                      const hasMultiplePools = group.pools.length > 1;

                      return (
                        <React.Fragment key={group.key}>
                          {/* Protocol total row */}
                          <tr
                            className={`border-t border-gray-700 ${hasMultiplePools ? 'cursor-pointer hover:bg-gray-700' : 'hover:bg-gray-750'} bg-gray-800`}
                            onClick={() => hasMultiplePools && toggleProtocol(group.key)}
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
                              const prevTotal = recalculatedPrevData?.protocolTotals[group.key];
                              return (
                                <>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.monQuantity} prev={prevTotal?.monQuantity} />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.monValueUSD} prev={prevTotal?.monValueUSD} format="currency" />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.externalIncentiveUSD} prev={prevTotal?.externalIncentiveUSD} format="currency" />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.adjustedTotal} prev={prevTotal?.adjustedTotal} format="currency" />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.tvl} prev={prevTotal?.tvl} format="large" />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.tvlCost} prev={prevTotal?.tvlCost} format="percent" invertColor />
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <ValueWithPrev current={group.total.adjustedTvlCost} prev={prevTotal?.adjustedTvlCost} format="percent" invertColor />
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
                              key={`${group.key}-${pool.pool}-${idx}`}
                              className="border-t border-gray-700/50 bg-gray-850 hover:bg-gray-800"
                            >
                              <td className="px-4 py-2"></td>
                              <td className="px-4 py-2 pl-8 text-gray-500 text-xs">↳</td>
                              <td className="px-4 py-2 text-gray-300 text-xs">{pool.pool}</td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
                                {pool.monQuantity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
                                ${pool.monValueUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
                                ${pool.externalIncentiveUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
                                ${pool.adjustedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
                                {pool.tvl ? `$${formatLargeNumber(pool.tvl)}` : '-'}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
                                {pool.tvlCost ? `${pool.tvlCost.toFixed(2)}%` : '-'}
                              </td>
                              <td className="px-4 py-2 text-right font-mono text-xs">
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
                            <ValueWithPrev current={row.monValueUSD} prev={prevFunder?.monValueUSD} format="currency" />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.externalIncentiveUSD} prev={prevFunder?.externalIncentiveUSD} format="currency" />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.adjustedTotal} prev={prevFunder?.adjustedTotal} format="currency" />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.tvl} prev={prevFunder?.tvl} format="large" />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.tvlCost} prev={prevFunder?.tvlCost} format="percent" invertColor />
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            <ValueWithPrev current={row.adjustedTvlCost} prev={prevFunder?.adjustedTvlCost} format="percent" invertColor />
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
                        <td className="px-4 py-3 text-right font-mono">
                          ${row.monValueUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          ${row.externalIncentiveUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          ${row.adjustedTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.tvl ? `$${formatLargeNumber(row.tvl)}` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {row.tvlCost ? `${row.tvlCost.toFixed(2)}%` : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
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
            <li>Click on the <span className="text-yellow-400">MON Price</span> to edit it if needed</li>
            <li>Click protocol rows to expand/collapse individual pools</li>
            <li>Click &quot;Copy&quot; to copy data to clipboard</li>
            <li>Paste into your Google Sheet</li>
          </ol>

          <div className="mt-4 p-4 bg-gray-700 rounded">
            <h3 className="font-bold mb-2">Column Explanations</h3>
            <ul className="text-sm text-gray-400 space-y-1">
              <li><strong>MON Qty</strong> - Raw MON token amount from Merkl</li>
              <li><strong>MON Value</strong> - MON Qty × MON Price</li>
              <li><strong>External</strong> - Non-MON incentives (AUSD, etc.) in USD</li>
              <li><strong>Adjusted Total</strong> - MON Incentives + External</li>
              <li><strong className="text-orange-400">TVL Cost</strong> - (Incentives / epoch_days × 365 / TVL) × 100 - annualized cost of MON incentives relative to TVL</li>
              <li><strong className="text-pink-400">Total TVL Cost</strong> - (Adjusted Total / epoch_days × 365 / TVL) × 100 - annualized total incentive cost relative to TVL</li>
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
