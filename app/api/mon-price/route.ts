import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd',
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error('CoinGecko API error');
    }

    const data = await response.json();
    const price = data?.monad?.usd || 0.025;

    return NextResponse.json({ price });
  } catch (error) {
    // Silently fallback to default price on any error
    return NextResponse.json({ price: 0.025 });
  }
}
