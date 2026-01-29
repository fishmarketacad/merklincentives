/**
 * Merkl Incentives Dashboard - Google Apps Script
 *
 * This script fetches data from your deployed Merkl dashboard and populates
 * the spreadsheet with incentive data for the current epoch.
 *
 * SETUP:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Paste this entire script
 * 4. Update the CONFIG section below with your settings
 * 5. Save and run "fetchAndUpdateSheet" or use the custom menu
 */

// ============================================================================
// CONFIGURATION - Update these values for your setup
// ============================================================================
const CONFIG = {
  // Your deployed Merkl dashboard URL
  BASE_URL: 'https://merklincentives.vercel.app',

  // Sheet name where data should be written
  SHEET_NAME: 'Incentives Efficiency', // Update if your sheet has a different name

  // Column where protocol names are (1-indexed)
  PROTOCOL_COL: 4, // Column D

  // Column where pool names are (1-indexed)
  POOL_COL: 5, // Column E

  // Row where data starts (after headers)
  DATA_START_ROW: 4,

  // MON price - will be fetched automatically, but can set manual override
  MON_PRICE_OVERRIDE: null, // Set to a number like 0.025 to override API price
};

// ============================================================================
// MENU SETUP - Adds custom menu to Google Sheets
// ============================================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Merkl Dashboard')
    .addItem('Fetch Current Week Data', 'fetchAndUpdateSheet')
    .addItem('Fetch Custom Date Range', 'showDateRangeDialog')
    .addItem('View API Status', 'checkAPIStatus')
    .addToUi();
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Main function to fetch data and update the sheet
 * Uses the last 7 days by default
 */
function fetchAndUpdateSheet() {
  const ui = SpreadsheetApp.getUi();

  // Calculate default date range (last 7 days ending yesterday)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(yesterday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const endDate = formatDate(yesterday);
  const startDate = formatDate(sevenDaysAgo);

  // Ask user to confirm or modify dates
  const response = ui.prompt(
    'Fetch Merkl Data',
    `Fetching data for:\nStart: ${startDate}\nEnd: ${endDate}\n\nEnter new dates (format: YYYY-MM-DD,YYYY-MM-DD) or click OK to use these:`,
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  let finalStartDate = startDate;
  let finalEndDate = endDate;

  if (response.getResponseText().trim()) {
    const parts = response.getResponseText().split(',');
    if (parts.length === 2) {
      finalStartDate = parts[0].trim();
      finalEndDate = parts[1].trim();
    }
  }

  // Show progress
  ui.alert('Fetching data...', `Fetching from ${finalStartDate} to ${finalEndDate}.\nThis may take a minute.`, ui.ButtonSet.OK);

  try {
    const data = fetchMerklData(finalStartDate, finalEndDate);
    updateSpreadsheet(data, finalStartDate, finalEndDate);
    ui.alert('Success!', `Data updated successfully!\n\nPools found: ${data.pools.length}\nMON Price: $${data.monPrice.toFixed(4)}`, ui.ButtonSet.OK);
  } catch (error) {
    ui.alert('Error', `Failed to fetch data: ${error.message}`, ui.ButtonSet.OK);
    console.error(error);
  }
}

/**
 * Fetch all data from the Merkl dashboard APIs
 */
function fetchMerklData(startDate, endDate) {
  // Get list of all protocols
  const protocols = [
    'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
    'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
    'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi'
  ];

  // Fetch MON price
  let monPrice = CONFIG.MON_PRICE_OVERRIDE;
  if (!monPrice) {
    try {
      const priceResponse = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/api/mon-price`);
      const priceData = JSON.parse(priceResponse.getContentText());
      monPrice = priceData.price || 0.025;
    } catch (e) {
      console.log('Failed to fetch MON price, using default');
      monPrice = 0.025;
    }
  }

  // Fetch incentives data (MON spent)
  const monSpentResponse = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/api/query-mon-spent`, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify({
      protocols: protocols,
      startDate: startDate,
      endDate: endDate,
      token: 'MON'
    }),
    muteHttpExceptions: true
  });

  if (monSpentResponse.getResponseCode() !== 200) {
    throw new Error(`MON spent API error: ${monSpentResponse.getContentText()}`);
  }

  const monSpentData = JSON.parse(monSpentResponse.getContentText());

  // Fetch TVL and volume data
  const tvlResponse = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/api/protocol-tvl`, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify({
      protocols: protocols,
      startDate: startDate,
      endDate: endDate
    }),
    muteHttpExceptions: true
  });

  let tvlData = { tvlData: {}, dexVolumeData: {} };
  if (tvlResponse.getResponseCode() === 200) {
    tvlData = JSON.parse(tvlResponse.getContentText());
  }

  // Process into a flat list of pools
  const pools = [];

  for (const platform of (monSpentData.results || [])) {
    const protocolKey = platform.platformProtocol.toLowerCase();

    for (const funding of (platform.fundingProtocols || [])) {
      for (const market of (funding.markets || [])) {
        // Get protocol-level TVL and volume as fallback
        const protocolTVL = tvlData.tvlData?.[protocolKey] || null;
        const protocolVolume = tvlData.dexVolumeData?.[protocolKey] || null;

        pools.push({
          protocol: platform.platformProtocol,
          fundingProtocol: funding.fundingProtocol,
          pool: market.marketName,
          incentivesMON: market.totalMON || 0,
          externalIncentiveUSD: market.externalIncentiveUSD || 0,
          tvl: market.tvl || protocolTVL || null,
          volume: protocolVolume?.volumeInRange || protocolVolume?.volume7d || null,
          apr: market.apr || null,
        });
      }
    }
  }

  // Add protocols without Merkl campaigns (like LFJ)
  const protocolsInResults = new Set(pools.map(p => p.protocol.toLowerCase()));
  const protocolsToAddManually = ['lfj'];

  for (const protocol of protocolsToAddManually) {
    if (!protocolsInResults.has(protocol)) {
      const tvl = tvlData.tvlData?.[protocol] || null;
      const volume = tvlData.dexVolumeData?.[protocol];
      const volumeValue = volume?.volumeInRange || volume?.volume7d || null;

      if (tvl || volumeValue) {
        pools.push({
          protocol: protocol,
          fundingProtocol: 'none',
          pool: '-',
          incentivesMON: 0,
          externalIncentiveUSD: 0,
          tvl: tvl,
          volume: volumeValue,
          apr: null,
        });
      }
    }
  }

  return {
    pools: pools,
    monPrice: monPrice,
    startDate: startDate,
    endDate: endDate,
    periodDays: daysBetween(startDate, endDate) + 1,
    protocolTVL: tvlData.tvlData || {},
    protocolVolume: tvlData.dexVolumeData || {},
  };
}

/**
 * Update the spreadsheet with fetched data
 */
function updateSpreadsheet(data, startDate, endDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    throw new Error(`Sheet "${CONFIG.SHEET_NAME}" not found. Check CONFIG.SHEET_NAME`);
  }

  // Ask user which columns to update
  const ui = SpreadsheetApp.getUi();
  const colResponse = ui.prompt(
    'Select Columns to Update',
    'Enter the column letters for this epoch\'s data:\n\n' +
    'Format: MF_ACTUAL,EXTERNAL,TVL,VOLUME\n' +
    'Example: I,K,N,O\n\n' +
    '(These are the columns for MF Incentives actual, External incentives, TVL, Volume)',
    ui.ButtonSet.OK_CANCEL
  );

  if (colResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const colLetters = colResponse.getResponseText().split(',').map(c => c.trim().toUpperCase());
  if (colLetters.length !== 4) {
    throw new Error('Please enter exactly 4 column letters separated by commas');
  }

  const [mfActualCol, externalCol, tvlCol, volumeCol] = colLetters.map(letterToColumn);

  // Build a lookup map: protocol+pool -> row number
  const lastRow = sheet.getLastRow();
  const protocolRange = sheet.getRange(CONFIG.DATA_START_ROW, CONFIG.PROTOCOL_COL, lastRow - CONFIG.DATA_START_ROW + 1, 1).getValues();
  const poolRange = sheet.getRange(CONFIG.DATA_START_ROW, CONFIG.POOL_COL, lastRow - CONFIG.DATA_START_ROW + 1, 1).getValues();

  const rowLookup = {};
  for (let i = 0; i < protocolRange.length; i++) {
    const protocol = String(protocolRange[i][0]).toLowerCase().trim();
    const pool = String(poolRange[i][0]).toLowerCase().trim();
    const row = CONFIG.DATA_START_ROW + i;

    if (protocol) {
      // Create lookup key
      const key = `${protocol}|${pool}`;
      rowLookup[key] = row;

      // Also create protocol-only key for "ALL POOLS" rows
      if (pool === 'all pools' || pool === '-' || pool === '') {
        rowLookup[`${protocol}|all`] = row;
      }
    }
  }

  // Aggregate data by protocol for "ALL POOLS" rows
  const protocolTotals = {};
  for (const pool of data.pools) {
    const protocolKey = pool.protocol.toLowerCase();
    if (!protocolTotals[protocolKey]) {
      protocolTotals[protocolKey] = {
        incentivesMON: 0,
        externalIncentiveUSD: 0,
        tvl: 0,
        volume: 0,
      };
    }
    protocolTotals[protocolKey].incentivesMON += pool.incentivesMON || 0;
    protocolTotals[protocolKey].externalIncentiveUSD += pool.externalIncentiveUSD || 0;
    // For TVL/Volume, use the protocol-level data or max of pools
    if (pool.tvl) {
      protocolTotals[protocolKey].tvl = Math.max(protocolTotals[protocolKey].tvl, pool.tvl);
    }
    if (pool.volume) {
      protocolTotals[protocolKey].volume = Math.max(protocolTotals[protocolKey].volume, pool.volume);
    }
  }

  // Use protocol-level TVL/Volume if available (more accurate)
  for (const [protocol, tvl] of Object.entries(data.protocolTVL)) {
    if (protocolTotals[protocol.toLowerCase()]) {
      protocolTotals[protocol.toLowerCase()].tvl = tvl;
    }
  }
  for (const [protocol, volData] of Object.entries(data.protocolVolume)) {
    if (protocolTotals[protocol.toLowerCase()] && volData) {
      const vol = volData.volumeInRange || volData.volume7d || volData.volume30d || 0;
      if (vol > 0) {
        protocolTotals[protocol.toLowerCase()].volume = vol;
      }
    }
  }

  // Update individual pool rows
  let updatedCount = 0;
  for (const pool of data.pools) {
    const protocolKey = normalizeProtocolName(pool.protocol);
    const poolKey = normalizePoolName(pool.pool);
    const lookupKey = `${protocolKey}|${poolKey}`;

    const row = rowLookup[lookupKey];
    if (row) {
      // Calculate incentive USD value
      const incentiveUSD = pool.incentivesMON * data.monPrice;

      // Update cells
      sheet.getRange(row, mfActualCol).setValue(incentiveUSD);
      sheet.getRange(row, externalCol).setValue(pool.externalIncentiveUSD || 0);
      if (pool.tvl) sheet.getRange(row, tvlCol).setValue(pool.tvl);
      if (pool.volume) sheet.getRange(row, volumeCol).setValue(pool.volume);

      updatedCount++;
    }
  }

  // Update "ALL POOLS" rows with protocol totals
  for (const [protocol, totals] of Object.entries(protocolTotals)) {
    const allPoolsKey = `${protocol}|all`;
    const row = rowLookup[allPoolsKey];
    if (row) {
      const incentiveUSD = totals.incentivesMON * data.monPrice;
      sheet.getRange(row, mfActualCol).setValue(incentiveUSD);
      sheet.getRange(row, externalCol).setValue(totals.externalIncentiveUSD);
      if (totals.tvl) sheet.getRange(row, tvlCol).setValue(totals.tvl);
      if (totals.volume) sheet.getRange(row, volumeCol).setValue(totals.volume);
      updatedCount++;
    }
  }

  console.log(`Updated ${updatedCount} rows`);
}

/**
 * Check API status
 */
function checkAPIStatus() {
  const ui = SpreadsheetApp.getUi();

  try {
    const response = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/api/mon-price`, {
      muteHttpExceptions: true
    });

    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      ui.alert('API Status', `API is online!\n\nMON Price: $${data.price}\nBase URL: ${CONFIG.BASE_URL}`, ui.ButtonSet.OK);
    } else {
      ui.alert('API Status', `API returned error: ${response.getResponseCode()}\n${response.getContentText()}`, ui.ButtonSet.OK);
    }
  } catch (error) {
    ui.alert('API Status', `Failed to connect: ${error.message}`, ui.ButtonSet.OK);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatDate(date) {
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function daysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.floor((end - start) / (1000 * 60 * 60 * 24));
}

function letterToColumn(letter) {
  let column = 0;
  for (let i = 0; i < letter.length; i++) {
    column = column * 26 + (letter.charCodeAt(i) - 64);
  }
  return column;
}

function normalizeProtocolName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .replace(/[-_\s]+/g, '')
    .replace('pancakeswap', 'pancakeswap')
    .replace('pancake-swap', 'pancakeswap')
    .trim();
}

function normalizePoolName(name) {
  if (!name) return '';
  const normalized = name.toLowerCase().trim();

  // Handle "ALL POOLS" variations
  if (normalized.includes('all pool') || normalized === '-') {
    return 'all pools';
  }

  // Extract token pair from pool name (e.g., "MON/AUSD" from "Provide liquidity to MON/AUSD pool")
  const tokenPairMatch = normalized.match(/([a-z0-9]+)[\/\-]([a-z0-9]+)/i);
  if (tokenPairMatch) {
    return `${tokenPairMatch[1]}/${tokenPairMatch[2]}`.toLowerCase();
  }

  return normalized;
}

// ============================================================================
// PROTOCOL NAME MAPPING
// ============================================================================
// Maps various protocol name formats to the canonical name used in your spreadsheet

const PROTOCOL_ALIASES = {
  'pancake-swap': 'pancakeswap',
  'pancakeswap': 'pancakeswap',
  'uniswap': 'uniswap',
  'curve': 'curve',
  'curve-dex': 'curve',
  'morpho': 'morpho',
  'euler': 'euler',
  'clober': 'clober',
  'kuru': 'kuru',
  'lfj': 'lfj',
  'gearbox': 'gearbox',
  'curvance': 'curvance',
  'accountable': 'accountable',
  'monday-trade': 'monday trade',
  'mondaytrade': 'monday trade',
  'townsquare': 'townsquare',
  'renzo': 'renzo',
  'wlfi': 'wlfi',
  'beefy': 'beefy',
};
