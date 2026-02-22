#!/usr/bin/env node

/**
 * Backfill Daily Index Script
 *
 * Populates the daily index cache with historical data from Monad mainnet launch.
 *
 * Usage:
 *   node scripts/backfill-daily-index.js [options]
 *
 * Options:
 *   --from=YYYY-MM-DD    Start date (default: 2025-11-24)
 *   --to=YYYY-MM-DD      End date (default: yesterday)
 *   --force              Re-index even if already indexed
 *   --dry-run            Show what would be indexed without actually indexing
 *   --batch=N            Number of dates to process before pausing (default: 10)
 *   --delay=N            Delay in ms between dates (default: 3000)
 *   --url=URL            Base URL of the dashboard API (default: http://localhost:3000)
 *
 * Examples:
 *   node scripts/backfill-daily-index.js
 *   node scripts/backfill-daily-index.js --from=2025-12-01 --to=2025-12-31
 *   node scripts/backfill-daily-index.js --force --batch=5
 *   node scripts/backfill-daily-index.js --url=https://your-dashboard.vercel.app
 */

const MONAD_MAINNET_LAUNCH = '2025-11-24';

// Parse command line arguments
function parseArgs() {
  const args = {
    from: MONAD_MAINNET_LAUNCH,
    to: getYesterday(),
    force: false,
    dryRun: false,
    batch: 10,
    delay: 3000, // 3 seconds between requests (CoinGecko rate limit)
    url: 'http://localhost:3000',
  };

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--from=')) {
      args.from = arg.split('=')[1];
    } else if (arg.startsWith('--to=')) {
      args.to = arg.split('=')[1];
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg.startsWith('--batch=')) {
      args.batch = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--delay=')) {
      args.delay = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--url=')) {
      args.url = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Backfill Daily Index Script

Usage:
  node scripts/backfill-daily-index.js [options]

Options:
  --from=YYYY-MM-DD    Start date (default: ${MONAD_MAINNET_LAUNCH})
  --to=YYYY-MM-DD      End date (default: yesterday)
  --force              Re-index even if already indexed
  --dry-run            Show what would be indexed without actually indexing
  --batch=N            Dates to process before pausing (default: 10)
  --delay=N            Delay in ms between dates (default: 3000)
  --url=URL            Base URL of the dashboard API

Examples:
  node scripts/backfill-daily-index.js
  node scripts/backfill-daily-index.js --from=2025-12-01 --to=2025-12-31
  node scripts/backfill-daily-index.js --force --batch=5
`);
      process.exit(0);
    }
  }

  return args;
}

function getYesterday() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split('T')[0];
}

function generateDateRange(startDate, endDate) {
  const dates = [];
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');

  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

async function checkIndexed(baseUrl, date) {
  try {
    const response = await fetch(`${baseUrl}/api/daily-index?date=${date}&check=true`);
    if (response.ok) {
      const data = await response.json();
      return data.indexed === true;
    }
  } catch (error) {
    // Assume not indexed if check fails
  }
  return false;
}

async function indexDate(baseUrl, date, force) {
  const response = await fetch(`${baseUrl}/api/daily-index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, force }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to index ${date}: ${error}`);
  }

  return response.json();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs();

  console.log('='.repeat(60));
  console.log('Daily Index Backfill');
  console.log('='.repeat(60));
  console.log(`Date range: ${args.from} to ${args.to}`);
  console.log(`Base URL: ${args.url}`);
  console.log(`Force re-index: ${args.force}`);
  console.log(`Dry run: ${args.dryRun}`);
  console.log(`Batch size: ${args.batch}`);
  console.log(`Delay between dates: ${args.delay}ms`);
  console.log('='.repeat(60));

  // Validate dates
  if (args.from < MONAD_MAINNET_LAUNCH) {
    console.error(`Error: Start date cannot be before Monad mainnet launch (${MONAD_MAINNET_LAUNCH})`);
    process.exit(1);
  }

  const today = new Date().toISOString().split('T')[0];
  if (args.to > today) {
    console.error(`Error: End date cannot be in the future`);
    process.exit(1);
  }

  if (args.from > args.to) {
    console.error(`Error: Start date must be before or equal to end date`);
    process.exit(1);
  }

  // Generate date range
  const dates = generateDateRange(args.from, args.to);
  console.log(`Total dates to process: ${dates.length}`);
  console.log('');

  if (args.dryRun) {
    console.log('Dry run - would index the following dates:');
    for (const date of dates) {
      const indexed = await checkIndexed(args.url, date);
      const status = indexed ? (args.force ? 'FORCE RE-INDEX' : 'SKIP (already indexed)') : 'INDEX';
      console.log(`  ${date}: ${status}`);
    }
    console.log('');
    console.log('Dry run complete. No changes made.');
    return;
  }

  // Process dates
  const results = {
    indexed: 0,
    skipped: 0,
    errors: 0,
  };

  let batchCount = 0;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const progress = `[${i + 1}/${dates.length}]`;

    try {
      // Check if already indexed (unless force)
      if (!args.force) {
        const indexed = await checkIndexed(args.url, date);
        if (indexed) {
          console.log(`${progress} ${date}: Skipped (already indexed)`);
          results.skipped++;
          continue;
        }
      }

      // Index the date
      console.log(`${progress} ${date}: Indexing...`);
      const result = await indexDate(args.url, date, args.force);

      if (result.results?.[0]?.status === 'indexed') {
        console.log(`${progress} ${date}: Indexed successfully`);
        results.indexed++;
      } else if (result.results?.[0]?.status === 'skipped') {
        console.log(`${progress} ${date}: Skipped`);
        results.skipped++;
      } else {
        console.log(`${progress} ${date}: Unknown status`, result);
      }

      batchCount++;

      // Pause after batch
      if (batchCount >= args.batch && i < dates.length - 1) {
        console.log(`\nBatch complete. Pausing for 10 seconds...\n`);
        await sleep(10000);
        batchCount = 0;
      } else if (i < dates.length - 1) {
        // Normal delay between dates
        await sleep(args.delay);
      }
    } catch (error) {
      console.error(`${progress} ${date}: Error - ${error.message}`);
      results.errors++;

      // On error, wait longer before continuing
      if (i < dates.length - 1) {
        console.log('Waiting 5 seconds before continuing...');
        await sleep(5000);
      }
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Backfill Complete');
  console.log('='.repeat(60));
  console.log(`Indexed: ${results.indexed}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Errors: ${results.errors}`);
  console.log(`Total: ${dates.length}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
