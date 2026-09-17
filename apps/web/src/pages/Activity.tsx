import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getApiHost } from '../apiHost';
import SeoHead from '../components/SeoHead';

type DayBucket = {
  day: string;
  stamped_receipts: number;
  unique_payers: number;
};

type DoorStats = {
  stamped_receipts_7d: number;
  stamped_receipts_24h: number;
  unique_payers_7d: number;
  series_30d?: DayBucket[];
  definition?: string;
};

type VolumeStats = {
  usdc_fees_7d: string | null;
};

function Sparkline({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div
      role="img"
      aria-label={label}
      style={styles.spark}
      title={label}
    >
      {values.map((v, i) => (
        <span
          key={i}
          style={{
            ...styles.sparkBar,
            height: `${Math.max(8, Math.round((v / max) * 100))}%`,
            opacity: v > 0 ? 1 : 0.25,
          }}
        />
      ))}
    </div>
  );
}

function formatUsdcFees(baseUnits: string | null): string | null {
  if (baseUnits == null) return null;
  const n = Number(baseUnits);
  if (!Number.isFinite(n)) return null;
  return (n / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export default function Activity() {
  const [door, setDoor] = useState<DoorStats | null>(null);
  const [volume, setVolume] = useState<VolumeStats>({ usdc_fees_7d: null });
  const [doorFailed, setDoorFailed] = useState(false);
  const [volumeFailed, setVolumeFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [doorRes, statsRes] = await Promise.all([
          fetch(`${getApiHost()}/stats/door`, { cache: 'no-store' }),
          fetch(`${getApiHost()}/stats?format=json`, { cache: 'no-store' }),
        ]);

        if (!cancelled) {
          if (doorRes.ok) {
            const body = await doorRes.json();
            if (
              typeof body?.stamped_receipts_7d === 'number' &&
              typeof body?.stamped_receipts_24h === 'number' &&
              typeof body?.unique_payers_7d === 'number'
            ) {
              setDoor(body);
            } else {
              setDoorFailed(true);
            }
          } else {
            setDoorFailed(true);
          }

          if (statsRes.ok) {
            const body = await statsRes.json();
            const fees = body?.north_star?.usdc_fees_7d;
            if (typeof fees === 'string' || typeof fees === 'number') {
              setVolume({ usdc_fees_7d: String(fees) });
            } else {
              setVolumeFailed(true);
            }
          } else {
            setVolumeFailed(true);
          }
        }
      } catch {
        if (!cancelled) {
          setDoorFailed(true);
          setVolumeFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stampedSeries = useMemo(
    () => (door?.series_30d ?? []).map((d) => d.stamped_receipts),
    [door],
  );
  const payerSeries = useMemo(
    () => (door?.series_30d ?? []).map((d) => d.unique_payers),
    [door],
  );

  const usdcLabel = formatUsdcFees(volume.usdc_fees_7d);

  return (
    <div className="page">
      <SeoHead
        title="Activity — door receipts | Chit402"
        description="Public door traffic: signed USDC x402 receipts, unique payers, and fees. Counts only — not a chain explorer."
      />
      <div className="container" style={{ maxWidth: 960 }}>
        <header className="page-header" style={{ maxWidth: '36rem' }}>
          <span className="docs-kicker">Activity</span>
          <h1>Door traffic</h1>
          <p>
            Signed USDC x402 receipts on the public chat doors. Counts only — no wallets,
            txs, or task ids. Same ground as <code>GET /stats/door</code>.
          </p>
        </header>

        {loading && (
          <p style={styles.muted} aria-live="polite">
            Loading…
          </p>
        )}

        {!loading && doorFailed && (
          <p style={styles.failSoft} aria-live="polite">
            Door stats unavailable right now. Try again in a moment.
          </p>
        )}

        <div className="grid grid-3" style={{ gap: '1.25rem', marginBottom: '2rem' }}>
          <div className="card" style={styles.metricCard}>
            <h3 style={styles.cardTitle}>Door receipts</h3>
            <p style={styles.bigNum}>
              {door ? door.stamped_receipts_7d.toLocaleString() : '—'}
            </p>
            <p style={styles.sub}>
              last 7d
              {door != null && (
                <>
                  {' · '}
                  {door.stamped_receipts_24h.toLocaleString()} in 24h
                </>
              )}
            </p>
            {stampedSeries.length > 0 && (
              <Sparkline values={stampedSeries} label="Daily stamped receipts, last 30 days" />
            )}
          </div>

          <div className="card" style={styles.metricCard}>
            <h3 style={styles.cardTitle}>Unique payers</h3>
            <p style={styles.bigNum}>
              {door ? door.unique_payers_7d.toLocaleString() : '—'}
            </p>
            <p style={styles.sub}>last 7d · distinct payers on stamped doors</p>
            {payerSeries.length > 0 && (
              <Sparkline values={payerSeries} label="Daily unique payers, last 30 days" />
            )}
          </div>

          <div className="card" style={styles.metricCard}>
            <h3 style={styles.cardTitle}>Volume (USDC fees)</h3>
            <p style={styles.bigNum}>
              {volumeFailed || usdcLabel == null ? '—' : `$${usdcLabel}`}
            </p>
            <p style={styles.sub}>
              protocol fees · last 7d
              {volumeFailed && ' · unavailable'}
            </p>
            <p style={{ ...styles.sub, marginTop: '0.75rem', fontSize: '0.8rem' }}>
              From public <code>GET /stats</code> north_star — not a vanity explorer.
            </p>
          </div>
        </div>

        {door?.definition && (
          <p style={{ ...styles.muted, fontSize: '0.85rem', maxWidth: 640 }}>
            {door.definition}. Window anchor: task createdAt (UTC day buckets for sparklines).
          </p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  metricCard: {
    padding: '1.35rem 1.4rem 1.2rem',
    minHeight: 180,
    display: 'flex',
    flexDirection: 'column',
  },
  cardTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: '#f0f0f5',
    marginBottom: '0.5rem',
  },
  bigNum: {
    fontSize: '2rem',
    fontWeight: 800,
    letterSpacing: '-0.02em',
    color: '#f0f0f5',
    lineHeight: 1.1,
    marginBottom: '0.35rem',
  },
  sub: {
    color: '#8a8a9a',
    fontSize: '0.88rem',
    marginBottom: '0.85rem',
  },
  muted: {
    color: '#8a8a9a',
    marginBottom: '1.5rem',
  },
  failSoft: {
    color: '#f59e0b',
    marginBottom: '1.25rem',
    fontSize: '0.95rem',
  },
  spark: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
    height: 44,
    marginTop: 'auto',
    paddingTop: '0.5rem',
  },
  sparkBar: {
    flex: 1,
    minWidth: 2,
    borderRadius: 2,
    background: 'linear-gradient(180deg, #00d4ff 0%, rgba(139, 92, 246, 0.85) 100%)',
  },
};
