/**
 * Google Apps Script - Merkl Incentives Dashboard Epoch Importer
 *
 * This script fetches epoch data from your deployed merkl-dashboard API
 * and populates the spreadsheet with a new epoch column.
 *
 * SETUP:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Paste this entire script
 * 4. Update DASHBOARD_API_URL to your deployed dashboard URL
 * 5. Run addNewEpochColumn() or use the custom menu
 */

// ============ CONFIGURATION ============
// Update this to your deployed dashboard URL (e.g., https://your-dashboard.vercel.app)
const DASHBOARD_API_URL = 'https://merklincentives.vercel.app';

// Sheet name where epoch data is stored
const SHEET_NAME = 'Incentives Efficiency';

// Row where pool data starts (1-indexed, after headers)
const DATA_START_ROW = 3;

// Column where the first epoch data starts (after pool identifiers)
const EPOCH_START_COL = 10; // Column J

// Number of columns per epoch
const COLS_PER_EPOCH = 14;

// ============ MAIN FUNCTIONS ============

/**
 * Creates a custom menu when the spreadsheet is opened
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Merkl Dashboard')
    .addItem('Add New Epoch Column', 'addNewEpochColumn')
    .addItem('Refresh Current Epoch', 'refreshCurrentEpoch')
    .addItem('List Available Epochs', 'listAvailableEpochs')
    .addSeparator()
    .addItem('Fetch Uniswap Pool TVL', 'fetchUniswapTVL')
    .addToUi();
}

/**
 * Main function to add a new epoch column to the spreadsheet
 */
function addNewEpochColumn() {
  const ui = SpreadsheetApp.getUi();

  // Prompt for epoch dates
  const response = ui.prompt(
    'Add New Epoch',
    'Enter epoch dates (format: YYYY-MM-DD to YYYY-MM-DD)\nExample: 2026-03-09 to 2026-03-16',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const dateInput = response.getResponseText();
  const dateMatch = dateInput.match(/(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/);

  if (!dateMatch) {
    ui.alert('Invalid date format. Please use: YYYY-MM-DD to YYYY-MM-DD');
    return;
  }

  const startDate = dateMatch[1];
  const endDate = dateMatch[2];

  // Prompt for MON TWAP
  const twapResponse = ui.prompt(
    'MON TWAP',
    'Enter the MON 7-day TWAP price (e.g., 0.02236):',
    ui.ButtonSet.OK_CANCEL
  );

  if (twapResponse.getSelectedButton() !== ui.Button.OK) {
    return;
  }

  const monTwap = parseFloat(twapResponse.getResponseText()) || 0;

  try {
    ui.alert('Fetching data... This may take a moment.');

    const epochData = fetchEpochData(startDate, endDate);
    const uniswapTvl = fetchUniswapPoolTVL(endDate);

    insertEpochColumn(epochData, uniswapTvl, startDate, endDate, monTwap);

    ui.alert('Success! New epoch column has been added.');
  } catch (error) {
    ui.alert('Error: ' + error.message);
    Logger.log('Error adding epoch: ' + error);
  }
}

/**
 * Fetches epoch data from the dashboard API
 */
function fetchEpochData(startDate, endDate) {
  const url = `${DASHBOARD_API_URL}/api/query-mon-spent`;

  const payload = {
    protocols: ['all'],
    startDate: startDate,
    endDate: endDate,
    token: 'MON'
  };

  const options = {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();

  if (responseCode !== 200) {
    throw new Error(`API returned ${responseCode}: ${response.getContentText()}`);
  }

  return JSON.parse(response.getContentText());
}

/**
 * Fetches Uniswap pool TVL from The Graph via dashboard API
 */
function fetchUniswapPoolTVL(date) {
  const url = `${DASHBOARD_API_URL}/api/uniswap-tvl?date=${date}`;

  const options = {
    method: 'GET',
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      return data.pools || {};
    }
  } catch (e) {
    Logger.log('Failed to fetch Uniswap TVL: ' + e);
  }

  return {};
}

/**
 * Fetches protocol-level TVL and volume
 */
function fetchProtocolTVL(startDate, endDate) {
  const url = `${DASHBOARD_API_URL}/api/protocol-tvl`;

  const protocols = [
    'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
    'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
    'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi', 'neverland'
  ];

  const payload = {
    protocols: protocols,
    startDate: startDate,
    endDate: endDate
  };

  const options = {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      return JSON.parse(response.getContentText());
    }
  } catch (e) {
    Logger.log('Failed to fetch protocol TVL: ' + e);
  }

  return { tvlData: {}, dexVolumeData: {} };
}

/**
 * Fetches per-market volumes from Dune via dashboard API
 */
function fetchMarketVolumes(markets, startDate, endDate) {
  const url = `${DASHBOARD_API_URL}/api/protocol-tvl`;

  const payload = {
    markets: markets,
    startDate: startDate,
    endDate: endDate
  };

  const options = {
    method: 'PUT',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      return data.marketVolumes || {};
    }
  } catch (e) {
    Logger.log('Failed to fetch market volumes: ' + e);
  }

  return {};
}

/**
 * Inserts a new epoch column into the spreadsheet
 */
function insertEpochColumn(epochData, uniswapTvl, startDate, endDate, monTwap) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found`);
  }

  // Find the first empty epoch column (or insert at the beginning)
  const insertCol = EPOCH_START_COL;

  // Insert 14 new columns for the epoch
  sheet.insertColumns(insertCol, COLS_PER_EPOCH);

  // Set epoch header
  const epochName = formatEpochName(startDate, endDate, monTwap);
  sheet.getRange(1, insertCol, 1, COLS_PER_EPOCH).merge();
  sheet.getRange(1, insertCol).setValue(epochName);

  // Set column sub-headers
  const subHeaders = [
    'MF Incentives (allocated)',
    'MF Incentives (actual)',
    'Adjusted actual incentive',
    'External incentives',
    'Adjusted + External',
    'TVL',
    'Volume',
    'TVL Cost (Incentives / TVL)',
    'Adjusted TVL Cost',
    'Adjusted + External TVL Cost',
    'Adjusted TVL Cost WoW Change',
    'Volume Efficiency',
    'Action needed',
    'Notes'
  ];

  for (let i = 0; i < subHeaders.length; i++) {
    sheet.getRange(2, insertCol + i).setValue(subHeaders[i]);
  }

  // Process and insert pool data
  const poolDataMap = processEpochData(epochData, uniswapTvl, monTwap);

  // Get existing pool identifiers from column D (Pool column)
  const lastRow = sheet.getLastRow();
  const poolIdentifiers = sheet.getRange(DATA_START_ROW, 4, lastRow - DATA_START_ROW + 1, 1).getValues();

  // Insert data for each pool
  for (let row = 0; row < poolIdentifiers.length; row++) {
    const poolId = poolIdentifiers[row][0];
    if (!poolId) continue;

    const poolData = poolDataMap[normalizePoolId(poolId)];
    if (poolData) {
      const rowData = [
        poolData.allocatedIncentives || '',
        poolData.actualIncentives || '',
        poolData.adjustedIncentives || '',
        poolData.externalIncentives || '',
        poolData.adjustedPlusExternal || '',
        poolData.tvl || '',
        poolData.volume || '',
        poolData.tvlCost || '',
        poolData.adjustedTvlCost || '',
        poolData.adjustedExternalTvlCost || '',
        '', // WoW Change - calculate separately
        poolData.volumeEfficiency || '',
        '', // Action needed
        ''  // Notes
      ];

      sheet.getRange(DATA_START_ROW + row, insertCol, 1, COLS_PER_EPOCH).setValues([rowData]);
    }
  }

  // Format columns
  formatEpochColumns(sheet, insertCol);
}

/**
 * Process epoch data into a map keyed by pool identifier
 */
function processEpochData(epochData, uniswapTvl, monTwap) {
  const poolDataMap = {};

  if (!epochData.results) return poolDataMap;

  for (const platform of epochData.results) {
    const protocolName = platform.platformProtocol;

    for (const funding of (platform.fundingProtocols || [])) {
      for (const market of (funding.markets || [])) {
        const monQty = market.totalMON || 0;
        const extUSD = market.externalIncentiveUSD || 0;
        const monValueUSD = monQty * monTwap;
        const adjustedTotal = monValueUSD + extUSD;

        // Get TVL from Uniswap pools if applicable
        let tvl = market.tvl || null;
        if (protocolName.toLowerCase().includes('uniswap')) {
          const tokenPair = extractTokenPair(market.marketName);
          if (tokenPair && uniswapTvl[tokenPair]) {
            tvl = uniswapTvl[tokenPair].tvlUSD;
          }
        }

        // Calculate metrics
        const tvlCost = tvl && tvl > 0 ? (monValueUSD / tvl * 100) : null;
        const adjustedTvlCost = tvl && tvl > 0 ? (adjustedTotal / tvl * 100) : null;

        // Create pool identifier matching spreadsheet format
        const poolId = `${protocolName} | ${market.marketName}`;

        poolDataMap[normalizePoolId(poolId)] = {
          allocatedIncentives: '', // Would need budget data
          actualIncentives: formatCurrency(monValueUSD),
          adjustedIncentives: formatCurrency(monValueUSD), // Adjusted by TWAP
          externalIncentives: extUSD > 0 ? formatCurrency(extUSD) : '',
          adjustedPlusExternal: formatCurrency(adjustedTotal),
          tvl: tvl ? formatCurrency(tvl) : '',
          volume: market.volume ? formatCurrency(market.volume) : '',
          tvlCost: tvlCost ? formatPercent(tvlCost) : '',
          adjustedTvlCost: adjustedTvlCost ? formatPercent(adjustedTvlCost) : '',
          adjustedExternalTvlCost: adjustedTvlCost ? formatPercent(adjustedTvlCost) : '',
          volumeEfficiency: ''
        };
      }
    }
  }

  return poolDataMap;
}

/**
 * Extract token pair from market name
 */
function extractTokenPair(marketName) {
  const match = marketName.match(/([A-Za-z0-9]+)-([A-Za-z0-9]+)/);
  if (match) {
    return `${match[1]}-${match[2]}`;
  }
  return null;
}

/**
 * Normalize pool identifier for matching
 */
function normalizePoolId(poolId) {
  return poolId.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Format epoch name for header
 */
function formatEpochName(startDate, endDate, monTwap) {
  const start = formatDisplayDate(startDate);
  const end = formatDisplayDate(endDate);
  const twapStr = monTwap > 0 ? `$${monTwap.toFixed(5)}` : 'TBD';
  return `Epoch - ${start}-${end} - MON TWAP ${twapStr}`;
}

/**
 * Format date for display (MM/DD)
 */
function formatDisplayDate(dateStr) {
  const parts = dateStr.split('-');
  return `${parts[1]}/${parts[2]}`;
}

/**
 * Format number as currency
 */
function formatCurrency(value) {
  if (value === null || value === undefined) return '';
  return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Format number as percentage
 */
function formatPercent(value) {
  if (value === null || value === undefined) return '';
  return value.toFixed(2) + '%';
}

/**
 * Format epoch columns with proper styling
 */
function formatEpochColumns(sheet, startCol) {
  // Currency columns
  const currencyCols = [0, 1, 2, 3, 4, 5, 6]; // Columns A-G of epoch
  for (const offset of currencyCols) {
    sheet.getRange(DATA_START_ROW, startCol + offset, sheet.getLastRow() - DATA_START_ROW + 1, 1)
      .setNumberFormat('$#,##0');
  }

  // Percentage columns
  const percentCols = [7, 8, 9, 10, 11]; // Columns H-L of epoch
  for (const offset of percentCols) {
    sheet.getRange(DATA_START_ROW, startCol + offset, sheet.getLastRow() - DATA_START_ROW + 1, 1)
      .setNumberFormat('0.00%');
  }
}

// ============ UTILITY FUNCTIONS ============

/**
 * List all available epochs from the API
 */
function listAvailableEpochs() {
  const ui = SpreadsheetApp.getUi();

  try {
    const url = `${DASHBOARD_API_URL}/api/epoch-data`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      const epochs = data.epochs || [];

      let message = 'Available Epochs:\n\n';
      for (const epoch of epochs.slice(0, 10)) {
        message += `${epoch.name}: ${epoch.startDate} to ${epoch.endDate}\n`;
      }

      ui.alert(message);
    } else {
      ui.alert('Failed to fetch epochs: ' + response.getContentText());
    }
  } catch (e) {
    ui.alert('Error: ' + e.message);
  }
}

/**
 * Refresh data for the current/latest epoch
 */
function refreshCurrentEpoch() {
  const ui = SpreadsheetApp.getUi();
  ui.alert('This will refresh the most recent epoch column with fresh data.\n\nFeature coming soon!');
}

/**
 * Test function to fetch Uniswap TVL
 */
function fetchUniswapTVL() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    'Fetch Uniswap Pool TVL',
    'Enter date (YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const date = response.getResponseText();
  const tvlData = fetchUniswapPoolTVL(date);

  let message = `Uniswap Pool TVL for ${date}:\n\n`;
  for (const [pool, data] of Object.entries(tvlData)) {
    const tvl = data.tvlUSD ? '$' + Math.round(data.tvlUSD).toLocaleString() : 'N/A';
    message += `${pool}: ${tvl}\n`;
  }

  ui.alert(message);
}

// ============ POOL MAPPING ============
// Maps spreadsheet pool names to API identifiers

const POOL_NAME_MAP = {
  // Uniswap V4
  'uniswap v4 | mon/ausd': 'uniswap-Provide liquidity to UniswapV4 MON-AUSD',
  'uniswap v4 | wbtc/mon': 'uniswap-Provide liquidity to UniswapV4 WBTC-MON',
  'uniswap v4 | weth/mon': 'uniswap-Provide liquidity to UniswapV4 WETH-MON',
  'uniswap v4 | wsteth/weth': 'uniswap-Provide liquidity to UniswapV4 wstETH-WETH',
  'uniswap v4 | weeth/weth': 'uniswap-Provide liquidity to UniswapV4 weETH-WETH',
  'uniswap v4 | weth/usdc': 'uniswap-Provide liquidity to UniswapV4 WETH-USDC',
  'uniswap v4 | mon/usdc': 'uniswap-Provide liquidity to UniswapV4 MON-USDC',
  'uniswap v4 | ausd/usdc': 'uniswap-Provide liquidity to UniswapV4 AUSD-USDC',
  'uniswap v4 | ausd/usdt0': 'uniswap-Provide liquidity to UniswapV4 AUSD-USDT0',
  'uniswap v4 | usdt0/xaut0': 'uniswap-Provide liquidity to UniswapV4 USDT0-XAUt0',
  'uniswap v4 | xaut0/ausd': 'uniswap-Provide liquidity to UniswapV4 AUSD-XAUt0',
  'uniswap v4 | wbtc/usdc': 'uniswap-Provide liquidity to UniswapV4 WBTC-USDC',
  'uniswap v4 | wbtc/ausd': 'uniswap-Provide liquidity to UniswapV4 WBTC-AUSD',
  'uniswap v4 | wsteth/mon': 'uniswap-Provide liquidity to UniswapV4 wstETH-MON',
  'uniswap v4 | cbbtc/usdc': 'uniswap-Provide liquidity to UniswapV4 cbBTC-USDC',
  'uniswap v4 | cbbtc/mon': 'uniswap-Provide liquidity to UniswapV4 cbBTC-MON',

  // Curve
  'curve | ausd/usdc/usdt0': 'curve-Provide liquidity to the Curve AUSD-USDC-USDT0 pool',
  'curve | wbtc/lbtc/btc.b': 'curve-Provide liquidity to the Curve WBTC-LBTC-BTC.b pool',
  'curve | wbtc/lbtc/cbbtc': 'curve-Provide liquidity to the Curve WBTC-LBTC-cbBTC pool',
  'curve | wmon/shmon/smon/gmon': 'curve-Provide liquidity to Curve WMON-shMON-sMON-gMON',

  // Add more mappings as needed...
};
