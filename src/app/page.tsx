'use client';

/**
 * ============================================================================
 *  src/app/page.tsx — 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 Dashboard
 * ----------------------------------------------------------------------------
 *  Shows status panels for both micro-services:
 *    - News Bot Status   (existing — calls /api/health)
 *    - Ticket Bot Status (new     — calls /api/ticket-health)
 *
 *  Also includes a "Ticket Panel Setup" form that posts to /api/ticket-setup,
 *  which proxies to the ticket bot's /setup-panel endpoint.
 *
 *  NOTE: This is a minimal dashboard intended to demonstrate the ticket bot
 *  integration. If you already have a dashboard at src/app/page.tsx, merge
 *  the TicketBotPanel component into it rather than replacing the whole page.
 * ============================================================================
 */

import { useCallback, useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TicketBotHealth {
  ok: boolean;
  service: string;
  mode: 'demo' | 'live';
  ready: boolean;
  uptime: number;
  bot: { tag: string; id: string } | null;
  guild: { id: string; name: string } | null;
  configured: {
    discordToken: boolean;
    guildId: boolean;
    panelChannel: boolean;
    logChannel: boolean;
    ticketCategory: boolean;
    adminRole: boolean;
    staffRoles: number;
    webhookSecret: boolean;
  };
  stats: {
    totalTickets: number;
    openTickets: number;
    closedTickets: number;
    nextTicketId: number;
    categories: number;
  };
  panel: { messageId: string; channelId: string } | null;
}

interface CategoryInput {
  id: string;
  emoji: string;
  label: string;
  description: string;
  color: string; // hex string, converted to number before sending
}

const DEFAULT_FORM_CATEGORIES: CategoryInput[] = [
  { id: 'general',    emoji: '🟥', label: 'General Support',          description: 'General questions, account help.',           color: '#4B4B4B' },
  { id: 'bug',        emoji: '🟧', label: 'Bug Report',               description: 'Report a bug or unexpected behaviour.',      color: '#E67E22' },
  { id: 'billing',    emoji: '🟨', label: 'Billing / Nitro',          description: 'Payment, subscription, Nitro, or boosts.',   color: '#C5A017' },
  { id: 'partnership',emoji: '🟩', label: 'Partnership / Affiliation',description: 'Server partnerships, cross-promotion.',      color: '#2ECC71' },
  { id: 'staff',      emoji: '🟦', label: 'Staff Application',        description: 'Apply to join the staff team.',              color: '#4B4B4B' },
  { id: 'appeal',     emoji: '🟪', label: 'Appeal a Ban',             description: 'Appeal a ban or moderation action.',         color: '#9B59B6' },
];

// ---------------------------------------------------------------------------
// Component: Ticket Bot Status panel
// ---------------------------------------------------------------------------
function TicketBotPanel() {
  const [health, setHealth] = useState<TicketBotHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ticket-health', { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setHealth(await res.json());
    } catch (err: any) {
      setError(err?.message || String(err));
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const live = health?.mode === 'live' && health?.ready;
  const demo = health?.mode === 'demo';

  return (
    <section
      style={{
        border: '1px solid #2b2b2b',
        background: '#1a1a1a',
        color: '#e8e8e8',
        borderRadius: 10,
        padding: 20,
        margin: '12px 0',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'Georgia, serif' }}>
          𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — Status
        </h2>
        <span
          style={{
            padding: '2px 10px',
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            background: live ? '#2ECC71' : demo ? '#C5A017' : '#E74C3C',
            color: '#1a1a1a',
          }}
        >
          {loading ? '…' : live ? 'LIVE' : demo ? 'DEMO' : 'OFFLINE'}
        </span>
        <button
          onClick={refresh}
          style={{
            marginLeft: 'auto',
            background: '#2b2b2b',
            color: '#e8e8e8',
            border: '1px solid #444',
            borderRadius: 6,
            padding: '4px 10px',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </header>

      {error && (
        <div style={{ background: '#3a1a1a', border: '1px solid #E74C3C', padding: 10, borderRadius: 6, marginBottom: 12 }}>
          ⚠️ {error}
        </div>
      )}

      {health && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Stat label="Mode"        value={health.mode} />
            <Stat label="Ready"       value={health.ready ? '✅ yes' : '❌ no'} />
            <Stat label="Bot"         value={health.bot?.tag || '—'} />
            <Stat label="Guild"       value={health.guild?.name || '—'} />
            <Stat label="Uptime"      value={`${Math.floor((health.uptime || 0) / 60)} min`} />
            <Stat label="Open / Total" value={`${health.stats.openTickets} / ${health.stats.totalTickets}`} />
            <Stat label="Closed"      value={String(health.stats.closedTickets)} />
            <Stat label="Next #"      value={String(health.stats.nextTicketId)} />
          </div>

          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: '#aaa' }}>Configuration checks</summary>
            <ul style={{ marginTop: 8, fontSize: 13, color: '#bbb' }}>
              <li>DISCORD_BOT_TOKEN: {health.configured.discordToken ? '✅' : '❌'}</li>
              <li>GUILD_ID: {health.configured.guildId ? '✅' : '❌'}</li>
              <li>PANEL_CHANNEL: {health.configured.panelChannel ? '✅' : '❌'}</li>
              <li>LOG_CHANNEL: {health.configured.logChannel ? '✅' : '❌'}</li>
              <li>TICKET_CATEGORY: {health.configured.ticketCategory ? '✅' : '❌'}</li>
              <li>ADMIN_ROLE: {health.configured.adminRole ? '✅' : '❌'}</li>
              <li>STAFF_ROLES: {health.configured.staffRoles} configured</li>
              <li>WEBHOOK_SECRET: {health.configured.webhookSecret ? '✅' : '❌'}</li>
            </ul>
          </details>

          {health.panel && (
            <div style={{ marginTop: 10, fontSize: 13, color: '#aaa' }}>
              📌 Panel message posted: <code>{health.panel.messageId}</code> in <code>{health.panel.channelId}</code>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#222', padding: 10, borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component: Ticket Panel Setup form
// ---------------------------------------------------------------------------
function TicketPanelSetupForm() {
  const [title, setTitle] = useState('𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — Support Desk');
  const [description, setDescription] = useState(
    'Select a category below to open a private support ticket with the 𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 staff team.',
  );
  const [categories, setCategories] = useState<CategoryInput[]>(DEFAULT_FORM_CATEGORIES);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const updateCat = (i: number, patch: Partial<CategoryInput>) => {
    setCategories((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/ticket-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          categories: categories.map((c) => ({
            id: c.id,
            emoji: c.emoji,
            label: c.label,
            description: c.description,
            color: parseInt(c.color.replace('#', ''), 16),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setResult({ ok: true, message: `✅ Panel posted. Message ID: ${data.messageId}` });
      } else {
        setResult({ ok: false, message: `❌ ${data.error || 'Failed to post panel.'}` });
      }
    } catch (err: any) {
      setResult({ ok: false, message: `❌ ${err?.message || String(err)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      style={{
        border: '1px solid #2b2b2b',
        background: '#1a1a1a',
        color: '#e8e8e8',
        borderRadius: 10,
        padding: 20,
        margin: '12px 0',
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 18, fontFamily: 'Georgia, serif' }}>
        𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑐𝑘𝑒𝑡 𝐵𝑜𝑡 — Panel Setup
      </h2>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#aaa' }}>Panel title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, color: '#aaa' }}>Panel description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </label>

        <div>
          <div style={{ fontSize: 13, color: '#aaa', marginBottom: 6 }}>Categories</div>
          {categories.map((c, i) => (
            <div
              key={c.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '40px 100px 1fr 2fr 80px',
                gap: 8,
                marginBottom: 6,
                alignItems: 'center',
              }}
            >
              <input value={c.emoji} onChange={(e) => updateCat(i, { emoji: e.target.value })} style={inputStyle} />
              <input value={c.label} onChange={(e) => updateCat(i, { label: e.target.value })} style={inputStyle} />
              <input
                value={c.description}
                onChange={(e) => updateCat(i, { description: e.target.value })}
                style={inputStyle}
              />
              <input value={c.id} onChange={(e) => updateCat(i, { id: e.target.value })} style={inputStyle} />
              <input
                type="color"
                value={c.color}
                onChange={(e) => updateCat(i, { color: e.target.value })}
                style={{ width: '100%', height: 34, background: '#222', border: '1px solid #444', borderRadius: 6 }}
              />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="submit"
            disabled={busy}
            style={{
              background: '#2ECC71',
              color: '#1a1a1a',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? 'Posting…' : 'Post / Update Panel'}
          </button>
          {result && (
            <span style={{ color: result.ok ? '#2ECC71' : '#E74C3C', fontSize: 13 }}>{result.message}</span>
          )}
        </div>
      </form>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#222',
  border: '1px solid #444',
  borderRadius: 6,
  padding: '8px 10px',
  color: '#e8e8e8',
  fontSize: 14,
  fontFamily: 'inherit',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#0e0e0e',
        color: '#e8e8e8',
        padding: 24,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontFamily: 'Georgia, serif' }}>
          𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 — Dashboard
        </h1>
        <p style={{ margin: '4px 0 0', color: '#888', fontSize: 14 }}>
          Status and management for the news bot and the ticket bot.
        </p>
      </header>

      {/* Existing news-bot status panel — keep your own implementation if you have one.
          This is a stub so the page renders. */}
      <section
        style={{
          border: '1px solid #2b2b2b',
          background: '#1a1a1a',
          color: '#e8e8e8',
          borderRadius: 10,
          padding: 20,
          margin: '12px 0',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 18, fontFamily: 'Georgia, serif' }}>
          𝑇ℎ𝑒 𝐼𝐶𝐵𝑆 𝑇𝑖𝑚𝑒𝑠 — News Bot Status
        </h2>
        <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
          (Status for the news bot lives here. If you already have this panel
          in <code>src/app/page.tsx</code>, keep your existing version and only
          add the two ticket-bot sections below.)
        </p>
      </section>

      <TicketBotPanel />
      <TicketPanelSetupForm />
    </main>
  );
}
