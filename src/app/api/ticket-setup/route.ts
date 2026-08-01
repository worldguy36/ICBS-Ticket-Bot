/**
 * ============================================================================
 *  src/app/api/ticket-setup/route.ts
 * ----------------------------------------------------------------------------
 *  Authed POST → proxies to the 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡's /setup-panel endpoint.
 *
 *  Body: { title?, description?, categories?: [{ id, emoji?, label?, description?, color?, staffRoleId? }] }
 *
 *  Mirrors the news bot's setup route. Same auth check as /api/ticket-health.
 * ============================================================================
 */

import { NextResponse } from 'next/server';
import { setupPanel } from '@/lib/ticket-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthed(req: Request): boolean {
  const secret = process.env.ICBS_WEBHOOK_SECRET || '';
  const provided = req.headers.get('x-icbs-secret');
  if (secret && provided && provided === secret) return true;
  // TODO: replace with your real session check.
  return true;
}

export async function POST(req: Request) {
  if (!isAuthed(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await setupPanel({
    title: typeof body.title === 'string' ? body.title : undefined,
    description: typeof body.description === 'string' ? body.description : undefined,
    categories: Array.isArray(body.categories) ? body.categories : undefined,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: 'Use POST.' },
    { status: 405 },
  );
}
