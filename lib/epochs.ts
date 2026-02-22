/**
 * Simplified Epoch/Week definitions for Merkl Incentives tracking
 * Auto-generates weeks from program start date to current date
 * No data storage - just date range presets for the UI
 */

export interface Week {
  id: string;           // e.g., "w1", "w2", "w12"
  name: string;         // Display name, e.g., "Week 12 - 02/09 to 02/16"
  startDate: string;    // YYYY-MM-DD
  endDate: string;      // YYYY-MM-DD
  weekNumber: number;   // 1, 2, 3, ...
  snapshotDate: string; // Same as endDate - used for TVL lookups
  monTwap: number;      // Default 0 - user can override in UI
}

// Program start date (first Monday of incentives)
const PROGRAM_START_DATE = '2025-11-24'; // Monday, Nov 24, 2025

/**
 * Generate all weeks from program start to current date
 * Each week is Monday to Sunday
 */
export function generateAllWeeks(): Week[] {
  const weeks: Week[] = [];
  const now = new Date();
  const startDate = new Date(PROGRAM_START_DATE + 'T00:00:00Z');

  let weekNumber = 1;
  let currentStart = new Date(startDate);

  while (currentStart < now) {
    // Week ends on Sunday (6 days after Monday)
    const currentEnd = new Date(currentStart);
    currentEnd.setUTCDate(currentStart.getUTCDate() + 6);

    // Only include weeks that have ended (or are current week)
    const weekEndPlusOne = new Date(currentEnd);
    weekEndPlusOne.setUTCDate(currentEnd.getUTCDate() + 1);

    const startStr = currentStart.toISOString().split('T')[0];
    const endStr = currentEnd.toISOString().split('T')[0];

    // Format display dates as MM/DD
    const startDisplay = `${(currentStart.getUTCMonth() + 1).toString().padStart(2, '0')}/${currentStart.getUTCDate().toString().padStart(2, '0')}`;
    const endDisplay = `${(currentEnd.getUTCMonth() + 1).toString().padStart(2, '0')}/${currentEnd.getUTCDate().toString().padStart(2, '0')}`;

    weeks.push({
      id: `w${weekNumber}`,
      name: `Week ${weekNumber} - ${startDisplay} to ${endDisplay}`,
      startDate: startStr,
      endDate: endStr,
      weekNumber,
      snapshotDate: endStr,  // Use end date for TVL lookups
      monTwap: 0,            // Default 0 - user can override in UI
    });

    // Move to next Monday
    currentStart.setUTCDate(currentStart.getUTCDate() + 7);
    weekNumber++;
  }

  // Return newest first
  return weeks.reverse();
}

/**
 * Get all weeks (alias for generateAllWeeks for backward compatibility)
 */
export function getAllWeeks(): Week[] {
  return generateAllWeeks();
}

/**
 * Get week by ID
 */
export function getWeekById(id: string): Week | undefined {
  return generateAllWeeks().find(w => w.id === id);
}

/**
 * Get the current/most recent week
 */
export function getCurrentWeek(): Week {
  const weeks = generateAllWeeks();
  return weeks[0]; // Newest first
}

/**
 * Get week label for dropdown display
 */
export function getWeekLabel(week: Week): string {
  return week.name;
}

/**
 * Calculate period days for a week
 */
export function getPeriodDays(week: Week): number {
  const start = new Date(week.startDate);
  const end = new Date(week.endDate);
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

// ============================================
// Backward compatibility exports
// ============================================

// Epoch is now just an alias for Week
export type Epoch = Week;

export const EPOCHS: Week[] = generateAllWeeks();

export function getEpochById(id: string): Week | undefined {
  return getWeekById(id);
}

export function getCurrentEpoch(): Week {
  return getCurrentWeek();
}

export function getEpochLabel(epoch: Week): string {
  return getWeekLabel(epoch);
}

// Async versions (no longer need Redis, but keep for compatibility)
export async function getAllEpochs(): Promise<Week[]> {
  return generateAllWeeks();
}

export async function getEpochByIdAsync(id: string): Promise<Week | undefined> {
  return getWeekById(id);
}

export async function getCurrentEpochAsync(): Promise<Week> {
  return getCurrentWeek();
}

export async function getAllWeeksAsync(): Promise<Week[]> {
  return generateAllWeeks();
}

// These functions are no longer needed but kept as no-ops for compatibility
export function splitEpochIntoWeeks(epoch: Week): Week[] {
  return [epoch]; // Each "epoch" is already a single week
}

export async function shouldGenerateNewEpoch(): Promise<boolean> {
  return false; // No longer needed - weeks auto-generate
}

export async function generateMissingWeekEpochs(): Promise<any[]> {
  return []; // No longer needed - weeks auto-generate
}
