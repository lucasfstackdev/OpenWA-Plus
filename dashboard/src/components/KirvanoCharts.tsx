import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Loader2 } from 'lucide-react';
import { useKirvanoStatsQuery } from '../hooks/queries';
import type { KirvanoEventStatsPoint } from '../services/api';
import { EVENT_COLORS, EVENT_ICONS, KIRVANO_EVENT_TYPES } from '../utils/kirvanoEvents';
import './KirvanoCharts.css';

type Preset = 'today' | '3d' | 'week' | 'month' | 'custom';
type Mode = 'grouped' | 'cumulative';

const PRESETS: Preset[] = ['today', '3d', 'week', 'month', 'custom'];
const MODES: Mode[] = ['grouped', 'cumulative'];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Monday 00:00 of the current calendar week (not a rolling 7 days).
function startOfWeek(): Date {
  const d = startOfToday();
  const day = d.getDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  return d;
}

// The 1st of the current calendar month at 00:00 (not a rolling 30 days).
function startOfMonth(): Date {
  const d = startOfToday();
  d.setDate(1);
  return d;
}

/** Resolves a preset (or the custom inputs) to a concrete [from, to] range. `null` while a custom
 *  range is incomplete/invalid, so the query stays disabled instead of firing with garbage bounds. */
function resolvePresetRange(preset: Preset, customFrom: string, customTo: string): { from: Date; to: Date } | null {
  const now = new Date();
  switch (preset) {
    case 'today':
      return { from: startOfToday(), to: now };
    case '3d':
      return { from: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), to: now };
    case 'week':
      return { from: startOfWeek(), to: now };
    case 'month':
      return { from: startOfMonth(), to: now };
    case 'custom': {
      if (!customFrom || !customTo) return null;
      const from = new Date(customFrom);
      const to = new Date(customTo);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return null;
      return { from, to };
    }
  }
}

// Hour buckets ('2026-01-01 14:00:00') are computed in UTC by the backend (see
// kirvano-event-log.service.ts's statsBucketSql) — parsed explicitly as UTC and formatted in the
// viewer's local timezone, the same conversion KirvanoEventLog.tsx applies to `receivedAt`
// (`new Date(iso).toLocaleString()`). Without this the chart showed the raw UTC hour (e.g. "20:00")
// while every other timestamp on the page shows local time (e.g. "17:00").
//
// Day buckets ('2026-01-01') are read literally instead: a calendar day has no clock time to convert,
// and parsing it as UTC midnight then reformatting in a negative-UTC-offset timezone (like Brazil's)
// would shift it to the PREVIOUS day. Making day buckets themselves timezone-correct would require
// the backend aggregation to group by the viewer's local calendar day, not UTC's — out of scope here.
function formatTick(ts: string): string {
  if (ts.includes(' ')) {
    const utcDate = new Date(`${ts.replace(' ', 'T')}Z`);
    return utcDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const [, month, day] = ts.split('-');
  return `${day}/${month}`;
}

/** Running sum per event type across the already-chronological series — the "Acumulado" view. Pure
 *  transform of the same response the "Agrupado por período" view uses, no extra request. */
function toCumulative(points: KirvanoEventStatsPoint[]): KirvanoEventStatsPoint[] {
  const running: Record<string, number> = Object.fromEntries(KIRVANO_EVENT_TYPES.map(type => [type, 0]));
  return points.map(point => {
    const next: Record<string, number | string> = { timestamp: point.timestamp };
    for (const type of KIRVANO_EVENT_TYPES) {
      running[type] += point[type];
      next[type] = running[type];
    }
    return next as unknown as KirvanoEventStatsPoint;
  });
}

export function KirvanoCharts({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<Preset>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [mode, setMode] = useState<Mode>('grouped');

  const range = useMemo(() => resolvePresetRange(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const fromIso = range?.from.toISOString() ?? '';
  const toIso = range?.to.toISOString() ?? '';

  const { data, isLoading, isError } = useKirvanoStatsQuery(sessionId, fromIso, toIso, !!range);

  const chartData = useMemo(() => {
    const points = data?.timeSeries ?? [];
    return mode === 'cumulative' ? toCumulative(points) : points;
  }, [data, mode]);

  const totals = data?.totals;
  const hasData = chartData.length > 0;

  return (
    <section className="kirvano-charts">
      <div className="kirvano-charts-header">
        <h2>{t('kirvano.stats.title')}</h2>
        <div className="kirvano-preset-toggle" role="group" aria-label={t('kirvano.stats.title')}>
          {PRESETS.map(p => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              className={`kirvano-preset-tab ${preset === p ? 'active' : ''}`}
              onClick={() => setPreset(p)}
            >
              {t(`kirvano.stats.presets.${p === '3d' ? 'threeDays' : p}`)}
            </button>
          ))}
        </div>
      </div>

      {preset === 'custom' && (
        <div className="kirvano-charts-custom-range">
          <div className="form-group">
            <label>{t('kirvano.log.filters.from')}</label>
            <input type="datetime-local" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>{t('kirvano.log.filters.to')}</label>
            <input type="datetime-local" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        </div>
      )}

      <div className="kirvano-kpi-grid">
        {KIRVANO_EVENT_TYPES.map(type => {
          const Icon = EVENT_ICONS[type];
          return (
            <div key={type} className="kirvano-kpi-card">
              <Icon className="kirvano-kpi-watermark" />
              <div className="kirvano-kpi-header">
                <span className="kirvano-kpi-label">{t(`kirvano.events.${type}`)}</span>
                <Icon size={18} className="kirvano-kpi-icon" />
              </div>
              <div className="kirvano-kpi-value">{(totals?.[type] ?? 0).toLocaleString()}</div>
            </div>
          );
        })}
      </div>

      <div className="kirvano-chart-card">
        <div className="kirvano-chart-card-header">
          <h3>{t('kirvano.stats.chartTitle')}</h3>
          <div className="kirvano-mode-toggle" role="group" aria-label={t('kirvano.stats.chartTitle')}>
            {MODES.map(m => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className={`kirvano-mode-tab ${mode === m ? 'active' : ''}`}
                onClick={() => setMode(m)}
              >
                {t(`kirvano.stats.mode.${m}`)}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="kirvano-charts-empty">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : isError || !hasData ? (
          <div className="kirvano-charts-empty">{t('kirvano.stats.empty')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTick}
                tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: 'var(--text-secondary)' }} />
              <Tooltip labelFormatter={label => formatTick(String(label))} />
              <Legend />
              {KIRVANO_EVENT_TYPES.map(type => (
                <Line
                  key={type}
                  type="monotone"
                  dataKey={type}
                  name={t(`kirvano.events.${type}`)}
                  stroke={EVENT_COLORS[type]}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
