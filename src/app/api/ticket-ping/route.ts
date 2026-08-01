/**
 * ============================================================================
 *  src/app/api/ticket-ping/route.ts
 * ----------------------------------------------------------------------------
 *  PUBLIC GET → 200 if the 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 answered /health, else 503.
 *
 *  Mirrors src/app/api/ping/route.ts (the news bot's public keep-alive route).
 *  Point UptimeRobot at this URL — it keeps BOTH the Next.js web service and
 *  the spawned ticket bot child process warm.
 *
 *  No auth — must be callable by UptimeRobot from outside.
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { getTicketBotHealth } from '@/lib/ticket-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const health = await getTicketBotHealth();
  if (!health) {
    return NextResponse.json(
      { ok: false, service: 'icbs-ticket-bot', error: 'unreachable' },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      service: 'icbs-ticket-bot',
      mode: health.mode,
      ready: health.ready,
      openTickets: health.stats.openTickets,
      totalTickets: health.stats.totalTickets,
    },
    { status: 200 },
  );
}
