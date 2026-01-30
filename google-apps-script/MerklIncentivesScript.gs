/**
 * Merkl Incentives Dashboard - Google Apps Script
 * Fetches data from deployed Merkl dashboard and populates the spreadsheet.
 *
 * SETUP:
 * 1. Open Google Sheet > Extensions > Apps Script
 * 2. Paste this script and update CONFIG below
 * 3. Save and refresh sheet - you'll see "Merkl Dashboard" menu
 *
 * COLUMNS UPDATED BY SCRIPT:
 * - Column J: MON token quantity (raw amount)
 * - Column L: External incentives (USD)
 * - Column O: TVL
 * - Column P: Volume
 *
 * COLUMNS LEFT FOR YOUR FORMULAS:
 * - Column K: MF actual incentive (J × MON 7-day SMA price)
 * - Column M: Adjusted + External (K + L)
 * - Columns Q, R, S: TVL Cost calculations
 */

const CONFIG = {
  BASE_URL: 'https://merklincentives.vercel.app',
  SHEET_NAME: 'Incentives Efficiency',
  PROTOCOL_COL: 4,  // Column D
  POOL_COL: 5,      // Column E
  DATA_START_ROW: 4,

  // Fixed column assignments (change these if your sheet layout differs)
  MON_QTY_COL: 10,      // Column J - MON token quantity
  EXTERNAL_COL: 12,     // Column L - External incentives USD
  TVL_COL: 15,          // Column O - TVL
  VOLUME_COL: 16,       // Column P - Volume
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Merkl Dashboard')
    .addItem('Fetch Current Week Data', 'fetchAndUpdateSheet')
    .addItem('Check API Status', 'checkAPIStatus')
    .addToUi();
}

function fetchAndUpdateSheet() {
  const ui = SpreadsheetApp.getUi();

  // Default: last 7 days ending yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(yesterday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const endDate = formatDate(yesterday);
  const startDate = formatDate(sevenDaysAgo);

  // Get date range
  const dateResp = ui.prompt('Date Range',
    `Default: ${startDate} to ${endDate}\n\nEnter dates (YYYY-MM-DD,YYYY-MM-DD) or OK for default:`,
    ui.ButtonSet.OK_CANCEL);
  if (dateResp.getSelectedButton() !== ui.Button.OK) return;

  let [finalStart, finalEnd] = [startDate, endDate];
  if (dateResp.getResponseText().trim()) {
    [finalStart, finalEnd] = dateResp.getResponseText().split(',').map(s => s.trim());
  }

  ui.alert('Fetching...', `Fetching data for ${finalStart} to ${finalEnd}...\n\nThis will update:\n- Column J: MON quantity\n- Column L: External incentives\n- Column O: TVL\n- Column P: Volume`, ui.ButtonSet.OK);

  try {
    const data = fetchMerklData(finalStart, finalEnd);
    const updated = updateSpreadsheet(data);
    ui.alert('Success!', `Updated ${updated} rows\nMON Price (for reference): $${data.monPrice.toFixed(4)}`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
    console.error(e);
  }
}

function fetchMerklData(startDate, endDate) {
  const protocols = [
    'clober', 'curvance', 'gearbox', 'kuru', 'morpho', 'euler',
    'pancake-swap', 'uniswap', 'monday-trade', 'renzo', 'upshift',
    'townsquare', 'Beefy', 'accountable', 'curve', 'lfj', 'wlfi'
  ];

  // Fetch MON price (for reference only, not used in calculations)
  let monPrice = 0;
  try {
    const resp = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/api/mon-price`);
    monPrice = JSON.parse(resp.getContentText()).price || 0;
  } catch (e) { monPrice = 0; }

  // Fetch incentives from Merkl API
  const monResp = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/api/query-mon-spent`, {
    method: 'POST', contentType: 'application/json',
    payload: JSON.stringify({ protocols, startDate, endDate, token: 'MON' }),
    muteHttpExceptions: true
  });
  if (monResp.getResponseCode() !== 200) throw new Error(`API error: ${monResp.getContentText()}`);
  const monData = JSON.parse(monResp.getContentText());

  // Fetch TVL/Volume from DeFiLlama/Dune
  const tvlResp = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/api/protocol-tvl`, {
    method: 'POST', contentType: 'application/json',
    payload: JSON.stringify({ protocols, startDate, endDate }),
    muteHttpExceptions: true
  });
  const tvlData = tvlResp.getResponseCode() === 200 ? JSON.parse(tvlResp.getContentText()) : { tvlData: {}, dexVolumeData: {} };

  // Fetch per-market volumes (PUT endpoint)
  let marketVolumes = {};
  try {
    const markets = [];
    for (const platform of (monData.results || [])) {
      for (const funding of (platform.fundingProtocols || [])) {
        for (const market of (funding.markets || [])) {
          markets.push({
            protocol: platform.platformProtocol,
            marketName: market.marketName
          });
        }
      }
    }

    if (markets.length > 0) {
      const volResp = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/api/protocol-tvl`, {
        method: 'PUT', contentType: 'application/json',
        payload: JSON.stringify({ markets, startDate, endDate }),
        muteHttpExceptions: true
      });
      if (volResp.getResponseCode() === 200) {
        marketVolumes = JSON.parse(volResp.getContentText()).marketVolumes || {};
      }
    }
  } catch (e) {
    console.log('Per-market volume fetch failed:', e);
  }

  // Process pools
  const pools = [];
  for (const platform of (monData.results || [])) {
    const pKey = platform.platformProtocol.toLowerCase();
    for (const funding of (platform.fundingProtocols || [])) {
      for (const market of (funding.markets || [])) {
        // Try to get per-market volume
        const marketKey = `${platform.platformProtocol.toLowerCase()}_${market.marketName}`;
        const perMarketVol = marketVolumes[marketKey];

        pools.push({
          protocol: platform.platformProtocol,
          fundingProtocol: funding.fundingProtocol,
          pool: market.marketName,
          incentivesMON: market.totalMON || 0,  // Raw MON quantity
          externalIncentiveUSD: market.externalIncentiveUSD || 0,
          tvl: market.tvl || null,
          volume: perMarketVol?.volumeInRange || perMarketVol?.volume7d || null,
        });
      }
    }
  }

  // Add LFJ (no Merkl campaigns but has TVL/volume)
  if (!pools.some(p => p.protocol.toLowerCase() === 'lfj')) {
    const tvl = tvlData.tvlData?.['lfj'];
    const vol = tvlData.dexVolumeData?.['lfj'];
    if (tvl || vol) {
      pools.push({
        protocol: 'lfj', fundingProtocol: 'none', pool: '-',
        incentivesMON: 0, externalIncentiveUSD: 0,
        tvl: tvl || null,
        volume: vol?.volumeInRange || vol?.volume7d || null,
      });
    }
  }

  return { pools, monPrice, protocolTVL: tvlData.tvlData || {}, protocolVolume: tvlData.dexVolumeData || {} };
}

function updateSpreadsheet(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${CONFIG.SHEET_NAME}" not found`);

  const lastRow = sheet.getLastRow();
  const protocolVals = sheet.getRange(CONFIG.DATA_START_ROW, CONFIG.PROTOCOL_COL, lastRow - CONFIG.DATA_START_ROW + 1, 1).getValues();
  const poolVals = sheet.getRange(CONFIG.DATA_START_ROW, CONFIG.POOL_COL, lastRow - CONFIG.DATA_START_ROW + 1, 1).getValues();

  // Build row lookup
  const rowLookup = {};
  for (let i = 0; i < protocolVals.length; i++) {
    const protocol = normalizeProtocol(protocolVals[i][0]);
    const pool = normalizePool(poolVals[i][0]);
    const row = CONFIG.DATA_START_ROW + i;
    if (protocol) {
      rowLookup[`${protocol}|${pool}`] = row;
      if (pool === 'all pools' || pool === '-' || !pool) rowLookup[`${protocol}|all`] = row;
    }
  }

  // Aggregate protocol totals for "ALL POOLS" rows
  const totals = {};
  for (const p of data.pools) {
    const key = normalizeProtocol(p.protocol);
    if (!totals[key]) totals[key] = { mon: 0, ext: 0, tvl: 0, vol: 0 };
    totals[key].mon += p.incentivesMON || 0;
    totals[key].ext += p.externalIncentiveUSD || 0;
    if (p.tvl) totals[key].tvl = Math.max(totals[key].tvl, p.tvl);
    if (p.volume) totals[key].vol = Math.max(totals[key].vol, p.volume);
  }

  // Use protocol-level TVL/Volume data
  for (const [p, tvl] of Object.entries(data.protocolTVL)) {
    const key = normalizeProtocol(p);
    if (!totals[key]) totals[key] = { mon: 0, ext: 0, tvl: 0, vol: 0 };
    totals[key].tvl = tvl;
  }
  for (const [p, v] of Object.entries(data.protocolVolume)) {
    const key = normalizeProtocol(p);
    if (totals[key] && v) {
      const vol = v.volumeInRange || v.volume7d || 0;
      if (vol > 0) totals[key].vol = vol;
    }
  }

  let updated = 0;

  // Update individual pool rows
  for (const p of data.pools) {
    const key = `${normalizeProtocol(p.protocol)}|${normalizePool(p.pool)}`;
    const row = rowLookup[key];
    if (row) {
      // Column J: MON quantity (raw token amount)
      sheet.getRange(row, CONFIG.MON_QTY_COL).setValue(p.incentivesMON);

      // Column L: External incentives USD
      sheet.getRange(row, CONFIG.EXTERNAL_COL).setValue(p.externalIncentiveUSD || 0);

      // Column O: TVL
      if (p.tvl) sheet.getRange(row, CONFIG.TVL_COL).setValue(p.tvl);

      // Column P: Volume
      if (p.volume) sheet.getRange(row, CONFIG.VOLUME_COL).setValue(p.volume);

      updated++;
    }
  }

  // Update "ALL POOLS" rows with aggregated totals
  for (const [protocol, t] of Object.entries(totals)) {
    const row = rowLookup[`${protocol}|all`];
    if (row) {
      // Column J: Total MON quantity
      sheet.getRange(row, CONFIG.MON_QTY_COL).setValue(t.mon);

      // Column L: Total External incentives
      sheet.getRange(row, CONFIG.EXTERNAL_COL).setValue(t.ext);

      // Column O: Protocol TVL
      if (t.tvl) sheet.getRange(row, CONFIG.TVL_COL).setValue(t.tvl);

      // Column P: Protocol Volume
      if (t.vol) sheet.getRange(row, CONFIG.VOLUME_COL).setValue(t.vol);

      updated++;
    }
  }

  return updated;
}

function checkAPIStatus() {
  const ui = SpreadsheetApp.getUi();
  try {
    const resp = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/api/mon-price`, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      const data = JSON.parse(resp.getContentText());
      ui.alert('API Online', `MON Price: $${data.price}\nURL: ${CONFIG.BASE_URL}`, ui.ButtonSet.OK);
    } else {
      ui.alert('API Error', `Code: ${resp.getResponseCode()}`, ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('Connection Failed', e.message, ui.ButtonSet.OK);
  }
}

// Helpers
function formatDate(d) { return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd'); }

function normalizeProtocol(n) {
  if (!n) return '';
  return n.toLowerCase()
    .replace(/[-_\s]+/g, '')
    .replace('pancake-swap', 'pancakeswap')
    .replace('pancakeswap', 'pancakeswap');
}

function normalizePool(n) {
  if (!n) return '';
  const s = n.toLowerCase().trim();
  if (s.includes('all pool') || s === '-') return 'all pools';
  // Match common pool name patterns like "WBTC/MON", "WETH-USDC", etc.
  const m = s.match(/([a-z0-9]+)[\/\-]([a-z0-9]+)/i);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : s;
}
