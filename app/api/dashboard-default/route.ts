import { NextResponse } from 'next/server';
import { getCache, isCacheValid, updateAIAnalysis } from '@/app/lib/dashboardCache';

function getYesterdayUTC(): string {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

export async function GET() {
  try {
    const yesterday = getYesterdayUTC();
    const cache = await getCache();

    // Check if cache exists and is valid
    if (cache && await isCacheValid(yesterday)) {
      console.log('[Dashboard Default] Serving cached data for', yesterday);
      return NextResponse.json({
        success: true,
        cached: true,
        data: cache,
      });
    }

    // Cache miss or invalid - return empty state and trigger manual refresh
    console.log('[Dashboard Default] Cache miss for', yesterday);
    return NextResponse.json({
      success: false,
      cached: false,
      message: 'No cached data available. Please wait for the next cron run or trigger a manual refresh.',
      expectedDate: yesterday,
    }, { status: 404 });
  } catch (error: any) {
    console.error('[Dashboard Default] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve dashboard data' },
      { status: 500 }
    );
  }
}

/**
 * PUT endpoint to update AI analysis in cache
 * Called by client-side auto-trigger to save AI analysis for all users
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { aiAnalysis } = body;

    if (!aiAnalysis) {
      return NextResponse.json(
        { error: 'aiAnalysis is required' },
        { status: 400 }
      );
    }

    // Update AI analysis in cache
    await updateAIAnalysis(aiAnalysis);

    console.log('[Dashboard Default] AI analysis updated in cache via client');
    return NextResponse.json({
      success: true,
      message: 'AI analysis updated in cache',
    });
  } catch (error: any) {
    console.error('[Dashboard Default] Error updating AI analysis:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update AI analysis' },
      { status: 500 }
    );
  }
}
