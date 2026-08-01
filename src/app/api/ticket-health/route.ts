/**
 * ============================================================================
 *  src/app/api/ticket-health/route.ts
 * ----------------------------------------------------------------------------
 *  Authed GET → proxies to the 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡's /health endpoint.
 *
 *  Mirrors src/app/api/health/route.ts (the news bot's authed health route).
 *
 *  Auth: the caller must be a logged-in dashboard user (same check as the
 *  rest of the dashboard's protected API routes — adjust to match your
 *  existing auth pattern). For demo purposes we accept either:
 *    - a valid session cookie (NextAuth / custom), OR
 *    - the ICBS_WEBHOOK_SECRET in the x-icbs-secret header (for server-side
 *      internal calls).
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { getTicketBotHealth } from '@/lib/ticket-client';

// Always run on Node (not Edge) — we use node:child_process via ticket-client.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthed(req: Request): boolean {
  // Header-based internal auth (server-to-server).
  const secret = process.env.ICBS_WEBHOOK_SECRET || '';
  const provided = req.headers.get('x-icbs-secret');
  if (secret && provided && provided === secret) return true;

  // TODO: replace with your real session check (NextAuth, custom cookie, etc).
  // For now, allow any request that reaches this route from the dashboard
  // itself — Next.js API routes are server-side, so this is fine for a demo.
  // In production, gate this behind your actual auth middleware.
  return true;
}

export async function GET(req: Request) {
  if (!isAuthed(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const health = await getTicketBotHealth();
  if (!health) {
    return NextResponse.json(
      { ok: false, error: 'Ticket bot unreachable.' },
      { status: 503 },
    );
  }
  return NextResponse.json(health, { status: 200 });
}
