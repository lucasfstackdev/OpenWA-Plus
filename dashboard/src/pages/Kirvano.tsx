import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, Pencil, QrCode, ShoppingCart } from 'lucide-react';
import type { KirvanoEventConfig, KirvanoEventType, MessageTemplate } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import {
  useKirvanoEventsQuery,
  useSessionsQuery,
  useTemplatesQuery,
  useUpdateKirvanoEventMutation,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './Kirvano.css';

interface KirvanoVariable {
  token: string;
  description: string;
}

const EVENT_ICONS: Record<KirvanoEventType, typeof ShoppingCart> = {
  ON_ABANDONED_CART: ShoppingCart,
  ON_PIX_EXPIRED: Clock,
  ON_PIX_GENERATED: QrCode,
  ON_SALE_APPROVED: CheckCircle2,
};

function EventCard({
  config,
  templates,
  canWrite,
  sessionId,
  onChangeTemplate,
  onToggleEnabled,
}: {
  config: KirvanoEventConfig;
  templates: MessageTemplate[];
  canWrite: boolean;
  sessionId: string;
  onChangeTemplate: (templateId: string) => void;
  onToggleEnabled: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const Icon = EVENT_ICONS[config.eventType];
  const selectedTemplate = templates.find(tpl => tpl.id === config.templateId);

  return (
    <div className="kirvano-card">
      <div className="kirvano-card-header">
        <div className="kirvano-card-info">
          <div className="kirvano-card-icon">
            <Icon size={20} />
          </div>
          <h3>{t(`kirvano.events.${config.eventType}`)}</h3>
        </div>
        <div className="kirvano-card-toggle">
          <span>{t('kirvano.enabledLabel')}</span>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={!canWrite}
              onChange={e => onToggleEnabled(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      <div className="kirvano-card-body">
        {selectedTemplate && <p className="kirvano-card-preview">{selectedTemplate.body}</p>}

        <div className="form-group">
          <label>{t('kirvano.templateLabel')}</label>
          <select value={config.templateId} disabled={!canWrite} onChange={e => onChangeTemplate(e.target.value)}>
            {templates.map(tpl => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </div>

        <Link
          className="btn-secondary kirvano-edit-btn"
          to={`/templates?session=${encodeURIComponent(sessionId)}&template=${encodeURIComponent(config.templateId)}`}
        >
          <Pencil size={14} />
          {t('kirvano.editMessage')}
        </Link>
      </div>
    </div>
  );
}

export function Kirvano() {
  const { t } = useTranslation();
  useDocumentTitle(t('kirvano.title'));
  const toast = useToast();
  const { canWrite } = useRole();
  const { data: sessions = [], isLoading: loadingSessions } = useSessionsQuery();
  const [selectedSessionId, setSelectedSessionId] = useState('');

  const { data: events = [], isLoading: loadingEvents } = useKirvanoEventsQuery(
    selectedSessionId,
    !!selectedSessionId,
  );
  const { data: templates = [] } = useTemplatesQuery(selectedSessionId, !!selectedSessionId);
  const updateMutation = useUpdateKirvanoEventMutation();

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

  const variables = t('kirvano.variables', { returnObjects: true }) as unknown as KirvanoVariable[];

  const handleUpdate = async (eventType: KirvanoEventType, data: { templateId?: string; enabled?: boolean }) => {
    try {
      await updateMutation.mutateAsync({ sessionId: selectedSessionId, eventType, data });
      toast.success(t('kirvano.toasts.updated'));
    } catch (err) {
      toast.error(
        t('kirvano.toasts.updateFailed', { message: err instanceof Error ? err.message : t('common.unknownError') }),
      );
    }
  };

  if (loadingSessions) {
    return (
      <div className="kirvano-page kirvano-loading">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="kirvano-page">
      <PageHeader
        title={t('kirvano.title')}
        subtitle={t('kirvano.subtitle')}
        actions={
          sessions.length > 0 ? (
            <select
              className="kirvano-session-select"
              value={selectedSessionId}
              onChange={event => setSelectedSessionId(event.target.value)}
            >
              {sessions.map(session => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
          ) : undefined
        }
      />

      {sessions.length === 0 ? (
        <div className="kirvano-empty-page">
          <ShoppingCart size={48} strokeWidth={1} />
          <p>{t('kirvano.noSessions')}</p>
        </div>
      ) : loadingEvents ? (
        <div className="kirvano-loading-inline">
          <Loader2 className="animate-spin" size={28} />
        </div>
      ) : (
        <>
          <div className="kirvano-grid">
            {events.map(config => (
              <EventCard
                key={config.id}
                config={config}
                templates={templates}
                canWrite={canWrite}
                sessionId={selectedSessionId}
                onChangeTemplate={templateId => void handleUpdate(config.eventType, { templateId })}
                onToggleEnabled={enabled => void handleUpdate(config.eventType, { enabled })}
              />
            ))}
          </div>

          <section className="kirvano-variables">
            <h2>{t('kirvano.variablesTitle')}</h2>
            <p>{t('kirvano.variablesDescription')}</p>
            <div className="kirvano-variables-list">
              {variables.map(variable => (
                <div key={variable.token} className="kirvano-variable-row">
                  <code>{`{{${variable.token}}}`}</code>
                  <span>{variable.description}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
