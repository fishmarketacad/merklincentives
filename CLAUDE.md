# Merkl Dashboard - Project Reference

## Overview
A full-stack **Next.js 16** analytics dashboard for tracking DeFi incentive efficiency on the **Monad blockchain**. Tracks MON token spending across protocols via the Merkl API.

**Production URL:** https://merklincentives.vercel.app/

## Project Structure
```
merkl/
├── merkl-dashboard/           # Main Next.js application
│   ├── app/
│   │   ├── page.tsx           # Main dashboard UI (large, feature-rich)
│   │   ├── spreadsheet/       # Alternative spreadsheet view
│   │   ├── api/               # 14 API routes (see below)
│   │   └── lib/               # Cache utilities, MON price fetcher
│   ├── lib/
│   │   └── epochs.ts          # Epoch definitions (incentive cycles)
│   ├── scripts/               # Utility scripts
│   │   └── backfill-daily-index.js  # Backfill historical data
│   ├── google-apps-script/    # Google Sheets integration
│   └── public/                # Static assets
└── [Root scripts]             # Standalone CLI utilities
```

## Tech Stack
- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **Backend:** Next.js API Routes (App Router)
- **Caching:** Upstash Redis (daily indexed snapshots)
- **Deployment:** Vercel + GitHub Actions (daily cron at midnight UTC)

## Daily Index System (NEW)
Pre-computed daily snapshots for fast retrieval. Data indexed from **Nov 24, 2025** (Monad mainnet launch).

### Redis Schema
```
daily:{YYYY-MM-DD}:pools       → DailyPoolData[] (pool-level TVL, volume, incentives)
daily:{YYYY-MM-DD}:protocols   → { name: {tvl, volume, monSpent, ...} }
daily:{YYYY-MM-DD}:funders     → { name: {tvl, monSpent, poolCount, ...} }
daily:{YYYY-MM-DD}:markets     → { "protocol-market": {volume, volumeSource} }
daily:{YYYY-MM-DD}:meta        → { monPrice, monPriceSource, fetchedAt }
daily:{YYYY-MM-DD}:indexed     → boolean (quick check)
```

### Key Files
| File | Purpose |
|------|---------|
| `app/lib/cache.ts` | Daily index cache functions + types |
| `app/lib/monPrice.ts` | MON price fetcher (CoinGecko historical, DeFiLlama current) |
| `app/api/daily-index/route.ts` | API for indexing/retrieving daily data |
| `scripts/backfill-daily-index.js` | Backfill historical data script |

### Backfill Usage
```bash
cd merkl-dashboard

# Backfill all dates (Nov 24, 2025 to yesterday) - PRODUCTION
node scripts/backfill-daily-index.js --url=https://merklincentives.vercel.app

# Backfill all dates - LOCAL
node scripts/backfill-daily-index.js --url=http://localhost:3000

# Backfill specific range
node scripts/backfill-daily-index.js --from=2025-12-01 --to=2025-12-31 --url=https://merklincentives.vercel.app

# Force re-index
node scripts/backfill-daily-index.js --force --url=https://merklincentives.vercel.app

# Dry run (show what would be indexed)
node scripts/backfill-daily-index.js --dry-run
```

## API Routes (`/app/api/`)
| Route | Purpose |
|-------|---------|
| `daily-index/` | **NEW** - Index/retrieve daily snapshots |
| `epoch-data/` | Main data aggregation endpoint |
| `epoch-data-progressive/` | Progressive loading for large datasets |
| `cron/refresh-dashboard/` | Automated daily refresh trigger |
| `dashboard-default/` | Default dashboard data |
| `ai-analysis/` | AI-powered incentive analysis |
| `bulk-protocol-analysis/` | Batch protocol analysis |
| `funder-totals/` | Aggregated by funding protocol |
| `mon-price/` | MON token price data |
| `protocol-tvl/` | Protocol TVL queries |
| `uniswap-tvl/` | Uniswap-specific TVL |
| `enhanced-csv/` | CSV export functionality |
| `clear-cache/` | Cache management |
| `query-mon-spent/` | MON spending queries |

## External APIs
| API | Purpose |
|-----|---------|
| **Merkl API** (api.merkl.xyz) | Incentives, campaigns, opportunities |
| **DeFiLlama API** | Protocol TVL (Monad chain filtered) |
| **CoinGecko API** | Historical MON prices |
| **Dune Analytics** | Per-market volumes (Uniswap, Kuru, Curve, PancakeSwap) |
| **Uniswap GraphQL** | Pool-level TVL |

## Dune Query IDs
| Protocol | Query ID | Granularity |
|----------|----------|-------------|
| Uniswap V4 | 6436010 | Per token pair |
| PancakeSwap | 6436185 | Aggregated only |
| Curve | 6530575 | Per pool name |
| Kuru | 6436201 | Per token pair |

## Supported Protocols
Clober, Kuru, Curve, Morpho, Euler, Uniswap, Pancake, Renzo, Upshift, Townsquare, Beefy, Accountable, LFJ, WLFI, Neverland, Curvance, Gearbox, Monday Trade

## Adding New Protocols
1. Add to `PROTOCOL_SLUG_MAP` in `app/api/protocol-tvl/route.ts`
2. Add to `TVL_PROTOCOLS` in `app/api/epoch-data/route.ts`
3. (Optional) Add Dune query ID if DEX with per-market volume
4. Run backfill: `node scripts/backfill-daily-index.js --force`

## Data Flow
1. **Daily cron** indexes today's data via `/api/daily-index`
2. Frontend checks `daily:{date}:*` for pre-computed data
3. Falls back to live API aggregation if not indexed
4. MON prices cached from CoinGecko (historical) / DeFiLlama (current)

## Commands
```bash
cd merkl-dashboard
npm run dev      # Start dev server
npm run build    # Production build
npm run lint     # Run ESLint
```

## Environment Variables
| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Authentication for cron endpoint |
| `UPSTASH_REDIS_REST_URL` | Redis connection |
| `UPSTASH_REDIS_REST_TOKEN` | Redis auth token |
| `DUNE_API_KEY` | Dune Analytics API key |
| `THEGRAPH_API_KEY` | (Optional) Uniswap subgraph |
