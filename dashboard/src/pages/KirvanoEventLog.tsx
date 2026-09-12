import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, History, Loader2, Search } from 'lucide-react';
import type { KirvanoEventLogEntry, KirvanoEventType } from '../services/api';
import { useKirvanoEventLogQuery } from '../hooks/queries';
import { CustomSelect } from '../components/CustomSelect';
import { pageWindow } from '../utils/pageWindow';

const EVENT_TYPES: KirvanoEventType[] = ['ON_ABANDONED_CART', 'ON_PIX_EXPIRED', 'ON_PIX_GENERATED', 'ON_SALE_APPROVED'];
const LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 300;

export function KirvanoEventLog({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  // Debounced so a server-side query isn't fired on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, eventType, from, to]);

  const params = {
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
    eventType: eventType !== 'all' ? (eventType as KirvanoEventType) : undefined,
    search: search || undefined,
    limit: LIMIT,
    offset: (page - 1) * LIMIT,
  };

  const { data, isLoading, isError } = useKirvanoEventLogQuery(sessionId, params, !!sessionId);
  const rows: KirvanoEventLogEntry[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

  const formatTimestamp = (value: string) => new Date(value).toLocaleString();

  return (
    <div className="kirvano-log">
      <p className="kirvano-log-subtitle">{t('kirvano.log.subtitle')}</p>

      {isError && (
        <div className="error-banner" role="alert">
          <AlertCircle size={20} />
          <span className="error-banner-text">{t('dashboard.loadError')}</span>
        </div>
      )}

      <div className="filters-bar">
        <div className="search-input">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('kirvano.log.searchPlaceholder')}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <CustomSelect
            value={eventType}
            onChange={setEventType}
            ariaLabel={t('kirvano.log.filters.eventType')}
            options={[
              { value: 'all', label: t('kirvano.log.filters.allEvents') },
              ...EVENT_TYPES.map(type => ({ value: type, label: t(`kirvano.events.${type}`) })),
            ]}
          />
        </div>

        <div className="form-group kirvano-log-date-filter">
          <label>{t('kirvano.log.filters.from')}</label>
          <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
        </div>

        <div className="form-group kirvano-log-date-filter">
          <label>{t('kirvano.log.filters.to')}</label>
          <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
        </div>
      </div>

      <div className="logs-table-container">
        <div className="logs-table">
          <div className="table-row header">
            <span>{t('kirvano.log.columns.receivedAt')}</span>
            <span>{t('kirvano.log.columns.eventType')}</span>
            <span>{t('kirvano.log.columns.status')}</span>
            <span>{t('kirvano.log.columns.queueEstimate')}</span>
            <span>{t('kirvano.log.columns.customerName')}</span>
            <span>{t('kirvano.log.columns.customerPhone')}</span>
          </div>

          {isLoading ? (
            <div className="kirvano-log-loading">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-table-state">
              <History size={48} strokeWidth={1} />
              <h3>{t('kirvano.log.empty.title')}</h3>
              <p>{t('kirvano.log.empty.description')}</p>
            </div>
          ) : (
            rows.map(row => (
              <div key={row.id} className="table-row">
                <span className="timestamp">{formatTimestamp(row.receivedAt)}</span>
                <span>{t(`kirvano.events.${row.eventType}`)}</span>
                <span>
                  <span className={`kirvano-log-status-badge ${row.status}`}>
                    {t(`kirvano.log.status.${row.status}`)}
                  </span>
                  {row.dispatchAttempts > 0 && (
                    <span className="kirvano-log-attempts" title={row.lastError ?? undefined}>
                      {t('kirvano.log.attemptLabel', { count: row.dispatchAttempts })}
                    </span>
                  )}
                </span>
                <span className="timestamp">{formatTimestamp(row.dispatchAt)}</span>
                <span>{row.customerName || '—'}</span>
                <span>{row.customerPhone || '—'}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            {t('common.previous')}
          </button>
          <span className="page-numbers">
            {pageWindow(page, totalPages).map(p => (
              <button key={p} className={p === page ? 'active' : ''} onClick={() => setPage(p)}>
                {p}
              </button>
            ))}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            {t('common.next')}
          </button>
        </div>
      )}
    </div>
  );
}
