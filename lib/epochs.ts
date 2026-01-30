/**
 * Epoch definitions for Merkl Incentives tracking
 * Each epoch represents a weekly incentive period
 */

export interface Epoch {
  id: string;           // Unique identifier (e.g., "4b", "4", "3")
  name: string;         // Display name (e.g., "Epoch 4b")
  startDate: string;    // Start date YYYY-MM-DD
  endDate: string;      // End date YYYY-MM-DD
  snapshotDate: string; // Snapshot date YYYY-MM-DD
  monTwap: number;      // MON 7-day TWAP price
  monTwapChange: string; // % change from previous epoch
}

// Epochs ordered from newest to oldest
// NOTE: Using 2026 dates to match the Merkl API data
export const EPOCHS: Epoch[] = [
  {
    id: '4b',
    name: 'Epoch 4b',
    startDate: '2026-01-19',
    endDate: '2026-01-26',
    snapshotDate: '2026-01-27',
    monTwap: 0.01901,
    monTwapChange: '-32.5%',
  },
  {
    id: '4',
    name: 'Epoch 4',
    startDate: '2026-01-12',
    endDate: '2026-01-19',
    snapshotDate: '2026-01-20',
    monTwap: 0.02239,
    monTwapChange: '-20.5%',
  },
  {
    id: '3b',
    name: 'Epoch 3',
    startDate: '2026-01-05',
    endDate: '2026-01-12',
    snapshotDate: '2026-01-13',
    monTwap: 0.02644,
    monTwapChange: '+30.1%',
  },
  {
    id: '3',
    name: 'Epoch 3',
    startDate: '2025-12-29',
    endDate: '2026-01-05',
    snapshotDate: '2026-01-05',
    monTwap: 0.02491,
    monTwapChange: '+22%',
  },
  {
    id: '2a',
    name: 'Epoch 2a',
    startDate: '2025-12-15',
    endDate: '2025-12-22',
    snapshotDate: '2025-12-22',
    monTwap: 0.01925,
    monTwapChange: '-28%',
  },
  {
    id: '1b',
    name: 'Epoch 1',
    startDate: '2025-12-08',
    endDate: '2025-12-15',
    snapshotDate: '2025-12-15',
    monTwap: 0.025,
    monTwapChange: '-32%',
  },
  {
    id: '1',
    name: 'Epoch 1',
    startDate: '2025-12-01',
    endDate: '2025-12-08',
    snapshotDate: '2025-12-08',
    monTwap: 0.028,
    monTwapChange: '-24%',
  },
  {
    id: '0',
    name: 'Epoch 0',
    startDate: '2025-11-27',
    endDate: '2025-12-04',
    snapshotDate: '2025-12-04',
    monTwap: 0.037,
    monTwapChange: 'N/A',
  },
];

export function getEpochById(id: string): Epoch | undefined {
  return EPOCHS.find(e => e.id === id);
}

export function getCurrentEpoch(): Epoch {
  return EPOCHS[0]; // Most recent epoch
}

export function getEpochLabel(epoch: Epoch): string {
  const start = formatDisplayDate(epoch.startDate);
  const end = formatDisplayDate(epoch.endDate);
  return `${epoch.name} - ${start} to ${end} - MON TWAP $${epoch.monTwap.toFixed(5)} (${epoch.monTwapChange})`;
}

function formatDisplayDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}`;
}

export function getPeriodDays(epoch: Epoch): number {
  const start = new Date(epoch.startDate);
  const end = new Date(epoch.endDate);
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}
