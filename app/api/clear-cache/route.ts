import { NextRequest, NextResponse } from 'next/server';
import { clearMerklCampaignCaches, clearAllCaches } from '@/app/lib/cache';

/**
 * Clear cache endpoint
 * POST /api/clear-cache
 *
 * Body options:
 * - { type: 'merkl' } - Clear only Merkl campaign caches (recommended)
 * - { type: 'all' } - Clear ALL caches (use with caution)
 *
 * Requires CRON_SECRET for authorization (same as cron job)
 */
export async function POST(request: NextRequest) {
  try {
    // Check authorization
    const authHeader = request.headers.get('authorization');
    const isAuthorized = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;

    // Also allow from localhost for development
    const host = request.headers.get('host') || '';
    const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');

    if (!isAuthorized && !isLocalhost) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const type = body.type || 'merkl';

    let result;
    if (type === 'all') {
      console.log('[ClearCache] Clearing ALL caches...');
      result = await clearAllCaches();
    } else {
      console.log('[ClearCache] Clearing Merkl campaign caches...');
      result = await clearMerklCampaignCaches();
    }

    if (result.error) {
      return NextResponse.json({
        success: false,
        error: result.error,
        cleared: result.cleared,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      type,
      cleared: result.cleared,
      message: `Cleared ${result.cleared} cache entries`,
    });
  } catch (error: any) {
    console.error('[ClearCache] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to clear cache',
    }, { status: 500 });
  }
}

/**
 * GET endpoint for easy browser access (localhost only)
 */
export async function GET(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1');

  if (!isLocalhost) {
    return NextResponse.json({ error: 'GET only allowed from localhost. Use POST with authorization for production.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'merkl';

  let result;
  if (type === 'all') {
    console.log('[ClearCache] Clearing ALL caches...');
    result = await clearAllCaches();
  } else {
    console.log('[ClearCache] Clearing Merkl campaign caches...');
    result = await clearMerklCampaignCaches();
  }

  return NextResponse.json({
    success: !result.error,
    type,
    cleared: result.cleared,
    error: result.error,
    message: result.error ? result.error : `Cleared ${result.cleared} cache entries`,
  });
}
