/**
 * Epoch definitions for Merkl Incentives tracking
 * Each epoch represents a weekly incentive period
 */

import { getDynamicEpochs, addDynamicEpoch, DynamicEpoch } from '@/app/lib/cache';

export interface Epoch {
  id: string;           // Unique identifier (e.g., "4b", "4", "3")
  name: string;         // Display name (e.g., "Epoch 4b")
  startDate: string;    // Start date YYYY-MM-DD
  endDate: string;      // End date YYYY-MM-DD
  snapshotDate: string; // Snapshot date YYYY-MM-DD
  monTwap: number;      // MON 7-day TWAP price
  monTwapChange: string; // % change from previous epoch
  isGenerated?: boolean; // True if auto-generated (TWAP may not be set yet)
}

export interface Week {
  id: string;           // Week identifier (e.g., "5-w1", "5-w2")
  name: string;         // Display name (e.g., "Epoch 5 - Week 1")
  startDate: string;    // Start date YYYY-MM-DD
  endDate: string;      // End date YYYY-MM-DD (exclusive)
  epochId: string;      // Parent epoch ID
  epoch: Epoch;         // Reference to parent epoch
}

// Hardcoded epochs (historical/verified data)
// Epochs ordered from newest to oldest
// NOTE: Using 2026 dates to match the Merkl API data
const HARDCODED_EPOCHS: Epoch[] = [
  {
    id: '6b',
    name: 'Epoch 6b Week 12',
    startDate: '2026-02-09',
    endDate: '2026-02-16',
    snapshotDate: '2026-02-17',
    monTwap: 0,
    monTwapChange: 'TBD',
    isGenerated: true,
  },
  {
    id: '6',
    name: 'Epoch 6 Week 11',
    startDate: '2026-02-02',
    endDate: '2026-02-09',
    snapshotDate: '2026-02-10',
    monTwap: 0,
    monTwapChange: 'TBD',
    isGenerated: true,
  },
  {
    id: '5',
    name: 'Epoch 5 Week 10',
    startDate: '2026-01-26',
    endDate: '2026-02-02',
    snapshotDate: '2026-02-03',
    monTwap: 0,
    monTwapChange: 'TBD',
    isGenerated: true,
  },
  {
    id: '4b',
    name: 'Epoch 4b Week 9',
    startDate: '2026-01-19',
    endDate: '2026-01-26',
    snapshotDate: '2026-01-27',
    monTwap: 0.01901,
    monTwapChange: '-32.5%',
  },
  {
    id: '4',
    name: 'Epoch 4 Week 8',
    startDate: '2026-01-12',
    endDate: '2026-01-19',
    snapshotDate: '2026-01-20',
    monTwap: 0.02239,
    monTwapChange: '-20.5%',
  },
  {
    id: '3b',
    name: 'Epoch 3b Week 7',
    startDate: '2026-01-05',
    endDate: '2026-01-12',
    snapshotDate: '2026-01-13',
    monTwap: 0.02644,
    monTwapChange: '+30.1%',
  },
  {
    id: '3',
    name: 'Epoch 3 Week 6',
    startDate: '2025-12-29',
    endDate: '2026-01-05',
    snapshotDate: '2026-01-05',
    monTwap: 0.02491,
    monTwapChange: '+22%',
  },
  {
    id: '2a',
    name: 'Epoch 2 Week 5',
    startDate: '2025-12-15',
    endDate: '2025-12-22',
    snapshotDate: '2025-12-22',
    monTwap: 0.01925,
    monTwapChange: '-28%',
  },
  {
    id: '1b',
    name: 'Epoch 1b Week 4',
    startDate: '2025-12-08',
    endDate: '2025-12-15',
    snapshotDate: '2025-12-15',
    monTwap: 0.025,
    monTwapChange: '-32%',
  },
  {
    id: '1',
    name: 'Epoch 1 Week 3',
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

// Export hardcoded epochs for backward compatibility
export const EPOCHS = HARDCODED_EPOCHS;

/**
 * Get all epochs (hardcoded + dynamic from Redis)
 * Returns epochs ordered from newest to oldest
 */
export async function getAllEpochs(): Promise<Epoch[]> {
  const dynamicEpochs = await getDynamicEpochs();

  // Convert dynamic epochs to Epoch interface
  const dynamicAsEpochs: Epoch[] = dynamicEpochs.map(d => ({
    id: d.id,
    name: d.name,
    startDate: d.startDate,
    endDate: d.endDate,
    snapshotDate: d.snapshotDate,
    monTwap: d.monTwap,
    monTwapChange: d.monTwapChange,
    isGenerated: d.isGenerated,
  }));

  // Merge: dynamic first (newest), then hardcoded
  // Filter out any hardcoded epochs that have same ID as dynamic (dynamic wins)
  const dynamicIds = new Set(dynamicAsEpochs.map(e => e.id));
  const filteredHardcoded = HARDCODED_EPOCHS.filter(e => !dynamicIds.has(e.id));

  // Combine and sort by endDate (newest first)
  const allEpochs = [...dynamicAsEpochs, ...filteredHardcoded];
  allEpochs.sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());

  return allEpochs;
}

export function getEpochById(id: string): Epoch | undefined {
  return HARDCODED_EPOCHS.find(e => e.id === id);
}

/**
 * Get epoch by ID (checks both hardcoded and dynamic epochs)
 */
export async function getEpochByIdAsync(id: string): Promise<Epoch | undefined> {
  // Check hardcoded first
  const hardcoded = HARDCODED_EPOCHS.find(e => e.id === id);
  if (hardcoded) return hardcoded;

  // Check dynamic epochs
  const dynamicEpochs = await getDynamicEpochs();
  const dynamic = dynamicEpochs.find(e => e.id === id);
  if (dynamic) {
    return {
      id: dynamic.id,
      name: dynamic.name,
      startDate: dynamic.startDate,
      endDate: dynamic.endDate,
      snapshotDate: dynamic.snapshotDate,
      monTwap: dynamic.monTwap,
      monTwapChange: dynamic.monTwapChange,
      isGenerated: dynamic.isGenerated,
    };
  }

  return undefined;
}

export function getCurrentEpoch(): Epoch {
  return HARDCODED_EPOCHS[0]; // Most recent hardcoded epoch
}

/**
 * Get the current/most recent epoch (including dynamic)
 */
export async function getCurrentEpochAsync(): Promise<Epoch> {
  const allEpochs = await getAllEpochs();
  return allEpochs[0];
}

export function getEpochLabel(epoch: Epoch): string {
  const start = formatDisplayDate(epoch.startDate);
  const end = formatDisplayDate(epoch.endDate);
  const twapStr = epoch.isGenerated && epoch.monTwap === 0
    ? 'TBD'
    : `$${epoch.monTwap.toFixed(5)} (${epoch.monTwapChange})`;
  return `${epoch.name} - ${start} to ${end} - MON TWAP ${twapStr}`;
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

/**
 * Get ISO week number from a date
 */
export function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Get the Monday of a given ISO week
 */
function getWeekStart(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);

  const targetDate = new Date(firstMonday);
  targetDate.setUTCDate(firstMonday.getUTCDate() + (week - 1) * 7);
  return targetDate;
}

/**
 * Generate an epoch for a specific week
 * Uses sequential program week for naming (e.g. "Week 10") when sequentialNumber is provided
 */
export async function generateWeekEpoch(
  weekNumber: number,
  year: number = 2026,
  sequentialNumber?: number
): Promise<DynamicEpoch | null> {
  // Calculate week dates (Monday to Sunday) first so we can check by startDate
  const weekStart = getWeekStart(year, weekNumber);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6); // Sunday

  const snapshotDate = new Date(weekEnd);
  snapshotDate.setUTCDate(weekEnd.getUTCDate() + 1); // Monday after

  const startDateStr = weekStart.toISOString().split('T')[0];
  const endDateStr = weekEnd.toISOString().split('T')[0];
  const snapshotDateStr = snapshotDate.toISOString().split('T')[0];

  // Check if this period already exists (by startDate, so we don't double-add)
  const existingEpochs = await getAllEpochs();
  if (existingEpochs.some(e => e.startDate === startDateStr)) {
    console.log(`[Epochs] Period ${startDateStr} already exists, skipping`);
    return null;
  }

  const displayNum = sequentialNumber ?? weekNumber;
  const weekId = `w${displayNum}`;

  const newEpoch: DynamicEpoch = {
    id: weekId,
    name: `Week ${displayNum}`,
    startDate: startDateStr,
    endDate: endDateStr,
    snapshotDate: snapshotDateStr,
    monTwap: 0, // Will be updated when TWAP is known
    monTwapChange: 'TBD',
    isGenerated: true,
  };

  // Save to Redis
  await addDynamicEpoch(newEpoch);
  console.log('[Epochs] Generated Week', displayNum, ':', newEpoch.startDate, 'to', newEpoch.endDate);

  return newEpoch;
}

/**
 * Check which weeks need to be generated
 * Only generates weeks that have ENDED (so data is available)
 * Returns list of week numbers that should be generated
 */
export async function getWeeksToGenerate(): Promise<number[]> {
  const allEpochs = await getAllEpochs();
  const now = new Date();

  const currentWeek = getISOWeekNumber(now);
  const currentYear = now.getUTCFullYear();

  // Track covered periods by "year-week" (from each epoch's startDate)
  const coveredYearWeeks = new Set<string>();
  for (const epoch of allEpochs) {
    const startDate = new Date(epoch.startDate + 'T00:00:00Z');
    const year = startDate.getUTCFullYear();
    const weekNum = getISOWeekNumber(startDate);
    coveredYearWeeks.add(`${year}-${weekNum}`);
  }

  // Latest covered week for current year
  let latestCoveredWeekThisYear = 0;
  for (const key of coveredYearWeeks) {
    const [y, w] = key.split('-').map(Number);
    if (y === currentYear) latestCoveredWeekThisYear = Math.max(latestCoveredWeekThisYear, w);
  }
  const startFromWeek = latestCoveredWeekThisYear > 0 ? latestCoveredWeekThisYear + 1 : 1;

  const weeksToGenerate: number[] = [];
  for (let week = startFromWeek; week <= currentWeek; week++) {
    if (coveredYearWeeks.has(`${currentYear}-${week}`)) continue;

    const weekEnd = getWeekStart(currentYear, week);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    weekEnd.setUTCHours(23, 59, 59, 999);

    if (now > weekEnd) {
      weeksToGenerate.push(week);
    }
  }

  return weeksToGenerate;
}

/**
 * Generate all missing week epochs
 * Only generates weeks that have ended (so data is available)
 */
export async function generateMissingWeekEpochs(): Promise<DynamicEpoch[]> {
  const allEpochs = await getAllEpochs();
  const weeksToGenerate = await getWeeksToGenerate();
  const generated: DynamicEpoch[] = [];
  const year = new Date().getUTCFullYear();
  // Sequential program week: next epoch = (existing count) + 1, then 11, 12, ...
  let sequentialNumber = allEpochs.length + 1;

  for (const week of weeksToGenerate) {
    const epoch = await generateWeekEpoch(week, year, sequentialNumber);
    if (epoch) {
      generated.push(epoch);
      sequentialNumber++;
    }
  }

  return generated;
}

/**
 * Check if we need to generate new epochs
 * Returns true if there are weeks that ended but haven't been generated yet
 */
export async function shouldGenerateNewEpoch(): Promise<boolean> {
  const weeksToGenerate = await getWeeksToGenerate();
  return weeksToGenerate.length > 0;
}

/**
 * Split an epoch into individual 7-day weeks for dropdown display
 * Each 2-week epoch becomes 2 separate weeks
 */
export function splitEpochIntoWeeks(epoch: Epoch): Week[] {
  const weeks: Week[] = [];
  const start = new Date(epoch.startDate + 'T00:00:00Z');
  const end = new Date(epoch.endDate + 'T00:00:00Z');

  // Calculate total days to determine if we need week numbers
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const hasMultipleWeeks = totalDays > 7;

  // Split into 7-day chunks
  let currentStart = new Date(start);
  let weekNum = 1;

  while (currentStart < end) {
    const weekEnd = new Date(currentStart);
    weekEnd.setUTCDate(currentStart.getUTCDate() + 7);

    // Don't go past the epoch end
    const actualEnd = weekEnd > end ? end : weekEnd;

    // Only add week number suffix if epoch has multiple weeks
    const weekName = hasMultipleWeeks
      ? `${epoch.name} - Week ${weekNum}`
      : epoch.name;

    weeks.push({
      id: `${epoch.id}-w${weekNum}`,
      name: weekName,
      startDate: currentStart.toISOString().split('T')[0],
      endDate: actualEnd.toISOString().split('T')[0],
      epochId: epoch.id,
      epoch: epoch,
    });

    currentStart = new Date(actualEnd);
    weekNum++;
  }

  return weeks;
}

/**
 * Get all weeks from all epochs (splits each epoch into weeks)
 */
export function getAllWeeks(): Week[] {
  const weeks: Week[] = [];

  for (const epoch of EPOCHS) {
    weeks.push(...splitEpochIntoWeeks(epoch));
  }

  return weeks;
}

/**
 * Get all weeks from all epochs including dynamic (async version)
 */
export async function getAllWeeksAsync(): Promise<Week[]> {
  const allEpochs = await getAllEpochs();
  const weeks: Week[] = [];

  for (const epoch of allEpochs) {
    weeks.push(...splitEpochIntoWeeks(epoch));
  }

  return weeks;
}
