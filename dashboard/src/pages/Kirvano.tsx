import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Loader2,
  Pencil,
  QrCode,
  RefreshCw,
  Send,
  ShoppingCart,
  Timer,
} from 'lucide-react';
import {
  API_BASE_URL,
  contactApi,
  messageApi,
  type KirvanoEventConfig,
  type KirvanoEventType,
  type KirvanoEventUpdatePayload,
  type MessageTemplate,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import {
  useKirvanoEventsQuery,
  useKirvanoTokenQuery,
  useRegenerateKirvanoTokenMutation,
  useSessionsQuery,
  useTemplatesQuery,
  useUpdateKirvanoEventMutation,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { copyToClipboard } from '../utils/clipboard';
import { extractPlaceholders, renderPreview } from '../utils/templateVariables';
import { KirvanoEventLog } from './KirvanoEventLog';
import './Kirvano.css';

interface KirvanoVariable {
  token: string;
  description: string;
}

type VariableFieldType = 'text' | 'url' | 'email' | 'date' | 'numeric';

// Type doesn't vary by language, so this lives in code rather than in the i18n `kirvano.variables`
// array. Anything not listed here (including a variable the user added by hand-editing a template)
// defaults to 'text': required, no format check beyond non-empty.
const KIRVANO_VARIABLE_TYPES: Record<string, VariableFieldType> = {
  'payment.qrcode_image': 'url',
  checkout_url: 'url',
  'payment.expires_at': 'date',
};

const NUMERIC_PATTERN = /^[0-9]+([.,][0-9]+)?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** `YYYY-MM-DDTHH:mm` (native `datetime-local` value) -> `DD/MM/YYYY HH:mm`, matching the format
 *  the backend renders `payment.expires_at` into (see kirvano-payload.util.ts formatLocalDateTime). */
function datetimeLocalToDisplay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function isFieldValid(type: VariableFieldType, rawValue: string): boolean {
  if (!rawValue.trim()) return false;
  switch (type) {
    case 'url':
      return isValidUrl(rawValue);
    case 'email':
      return EMAIL_PATTERN.test(rawValue);
    case 'numeric':
      return NUMERIC_PATTERN.test(rawValue.trim());
    case 'date':
    case 'text':
    default:
      return true;
  }
}

/** Formats raw digits into "55 (18) 99160 4584" (country code + area code + number) as the user
 *  types. Caps at 13 digits: 2 (country) + 2 (area) + 9 (BR mobile number with the 9th digit). */
function formatBrazilianPhone(digits: string): string {
  const d = digits.slice(0, 13);
  if (d.length <= 2) return d;
  let result = d.slice(0, 2);
  const rest = d.slice(2);
  result += ` (${rest.slice(0, 2)}`;
  if (rest.length <= 2) return result;
  result += ')';
  const number = rest.slice(2);
  if (number.length === 0) return result;
  result += ` ${number.slice(0, 5)}`;
  if (number.length > 5) result += ` ${number.slice(5, 9)}`;
  return result;
}

/** Absolute URL: API_BASE_URL is relative ('/api') for same-origin deploys, absolute for split-origin
 *  ones (VITE_API_URL) — only the relative case needs window.location.origin prefixed. */
function buildReceiverUrl(sessionId: string): string {
  const base = API_BASE_URL.startsWith('http') ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`;
  return `${base}/sessions/${encodeURIComponent(sessionId)}/kirvano/receiver`;
}

function ConnectionCard({ sessionId, canWrite }: { sessionId: string; canWrite: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: tokenView, isLoading: loadingToken } = useKirvanoTokenQuery(sessionId, !!sessionId);
  const regenerateMutation = useRegenerateKirvanoTokenMutation();
  const [copied, setCopied] = useState<'url' | 'token' | null>(null);

  const receiverUrl = buildReceiverUrl(sessionId);

  const handleCopy = async (text: string, which: 'url' | 'token') => {
    if (await copyToClipboard(text)) {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const handleRegenerate = async () => {
    if (!window.confirm(t('kirvano.regenerateConfirm'))) return;
    try {
      await regenerateMutation.mutateAsync(sessionId);
      toast.success(t('kirvano.toasts.tokenRegenerated'));
    } catch (err) {
      toast.error(
        t('kirvano.toasts.regenerateFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      );
    }
  };

  return (
    <section className="kirvano-connection">
      <h2>{t('kirvano.connectionTitle')}</h2>
      <p>{t('kirvano.connectionDescription')}</p>

      <div className="form-group">
        <label>{t('kirvano.urlLabel')}</label>
        <div className="kirvano-copy-row">
          <code>{receiverUrl}</code>
          <button
            type="button"
            className="icon-btn"
            title={t('kirvano.copy')}
            onClick={() => void handleCopy(receiverUrl, 'url')}
          >
            {copied === 'url' ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>{t('kirvano.tokenLabel')}</label>
        <div className="kirvano-copy-row">
          {loadingToken || !tokenView ? (
            <span className="kirvano-token-loading">
              <Loader2 size={16} className="animate-spin" />
            </span>
          ) : (
            <code>{tokenView.token}</code>
          )}
          <button
            type="button"
            className="icon-btn"
            title={t('kirvano.copy')}
            disabled={!tokenView}
            onClick={() => tokenView && void handleCopy(tokenView.token, 'token')}
          >
            {copied === 'token' ? <Check size={16} /> : <Copy size={16} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t('kirvano.regenerateToken')}
            disabled={!canWrite || regenerateMutation.isPending}
            onClick={() => void handleRegenerate()}
          >
            {regenerateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          </button>
        </div>
      </div>
    </section>
  );
}

function fieldErrorKey(type: VariableFieldType): string {
  switch (type) {
    case 'url':
      return 'kirvano.testMessage.errors.invalidUrl';
    case 'email':
      return 'kirvano.testMessage.errors.invalidEmail';
    case 'numeric':
      return 'kirvano.testMessage.errors.invalidNumber';
    default:
      return 'kirvano.testMessage.errors.required';
  }
}

function TestMessageModal({
  open,
  onClose,
  sessionId,
  template,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  template: MessageTemplate | undefined;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const variables = t('kirvano.variables', { returnObjects: true }) as unknown as KirvanoVariable[];
  const descriptionFor = (key: string) => variables.find(v => v.token === key)?.description ?? key;

  const placeholders = useMemo(() => (template ? extractPlaceholders(template) : []), [template]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [phoneDigits, setPhoneDigits] = useState('55');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [sending, setSending] = useState(false);

  // Fresh form every time the modal opens (or a different card's template is targeted).
  useEffect(() => {
    if (!open) return;
    setValues({});
    setTouched({});
    setPhoneDigits('55');
    setPhoneTouched(false);
    setSending(false);
  }, [open, template?.id]);

  if (!template) return null;

  const displayValues: Record<string, string> = {};
  for (const key of placeholders) {
    const type = KIRVANO_VARIABLE_TYPES[key] ?? 'text';
    const raw = values[key] ?? '';
    displayValues[key] = type === 'date' && raw ? datetimeLocalToDisplay(raw) : raw;
  }
  const preview = renderPreview(template, displayValues);

  const allFieldsValid = placeholders.every(key =>
    isFieldValid(KIRVANO_VARIABLE_TYPES[key] ?? 'text', values[key] ?? ''),
  );
  const phoneValid = phoneDigits.length === 13;
  const canSubmit = allFieldsValid && phoneValid && !sending;

  const handleSubmit = async () => {
    setTouched(Object.fromEntries(placeholders.map(key => [key, true])));
    setPhoneTouched(true);
    if (!allFieldsValid || !phoneValid) return;

    setSending(true);
    try {
      const resolved = await contactApi.checkNumber(sessionId, phoneDigits);
      if (!resolved.exists || !resolved.whatsappId) {
        toast.error(t('kirvano.testMessage.toasts.numberNotFound'));
        return;
      }
      await messageApi.sendText(sessionId, resolved.whatsappId, preview);
      toast.success(t('kirvano.testMessage.toasts.sent'));
      onClose();
    } catch (err) {
      toast.error(
        t('kirvano.testMessage.toasts.sendFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('kirvano.testMessage.title')}
      closeLabel={t('common.close')}
      className="kirvano-test-modal"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={sending}>
            {t('kirvano.testMessage.cancel')}
          </button>
          <button className="btn-primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {t('kirvano.testMessage.submit')}
          </button>
        </>
      }
    >
      <p className="kirvano-test-subtitle">{t('kirvano.testMessage.subtitle')}</p>

      <div className="form-group">
        <label>{t('kirvano.testMessage.phoneLabel')}</label>
        <input
          type="tel"
          value={formatBrazilianPhone(phoneDigits)}
          placeholder={t('kirvano.testMessage.phonePlaceholder')}
          onChange={e => setPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, 13))}
          onBlur={() => setPhoneTouched(true)}
        />
        {phoneTouched && !phoneValid ? (
          <span className="kirvano-test-field-error">{t('kirvano.testMessage.errors.invalidNumber')}</span>
        ) : (
          <span className="kirvano-test-phone-hint">{t('kirvano.testMessage.phoneHint')}</span>
        )}
      </div>

      {placeholders.length > 0 && (
        <div className="kirvano-test-form">
          <h3>{t('kirvano.testMessage.variablesTitle')}</h3>
          {placeholders.map(key => {
            const type = KIRVANO_VARIABLE_TYPES[key] ?? 'text';
            const value = values[key] ?? '';
            const invalid = touched[key] && !isFieldValid(type, value);
            const inputType =
              type === 'date' ? 'datetime-local' : type === 'email' ? 'email' : type === 'url' ? 'url' : 'text';
            return (
              <div className="form-group" key={key}>
                <label>{descriptionFor(key)}</label>
                <input
                  type={inputType}
                  inputMode={type === 'numeric' ? 'decimal' : undefined}
                  value={value}
                  onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
                  onBlur={() => setTouched(v => ({ ...v, [key]: true }))}
                />
                {invalid && <span className="kirvano-test-field-error">{t(fieldErrorKey(type))}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div className="form-group">
        <label>{t('kirvano.testMessage.previewTitle')}</label>
        <pre className="kirvano-test-preview">{preview || t('kirvano.testMessage.previewEmpty')}</pre>
      </div>
    </Modal>
  );
}

const EVENT_ICONS: Record<KirvanoEventType, typeof ShoppingCart> = {
  ON_ABANDONED_CART: ShoppingCart,
  ON_PIX_EXPIRED: Clock,
  ON_PIX_GENERATED: QrCode,
  ON_SALE_APPROVED: CheckCircle2,
};

function DelayConfigModal({
  open,
  onClose,
  config,
  canWrite,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  config: KirvanoEventConfig | null;
  canWrite: boolean;
  onSave: (delayMinutes: number) => void;
}) {
  const { t } = useTranslation();
  const [minutes, setMinutes] = useState(config?.delayMinutes ?? 1);

  useEffect(() => {
    if (open) setMinutes(config?.delayMinutes ?? 1);
  }, [open, config?.id, config?.delayMinutes]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('kirvano.delay.title')}
      closeLabel={t('common.close')}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            disabled={!canWrite}
            onClick={() => {
              onSave(minutes);
              onClose();
            }}
          >
            {t('common.save')}
          </button>
        </>
      }
    >
      <p className="kirvano-delay-description">{t('kirvano.delay.description')}</p>
      <div className="form-group">
        <label>{t('kirvano.delay.minutesLabel')}</label>
        <input
          type="number"
          min={0}
          max={1440}
          value={minutes}
          disabled={!canWrite}
          onChange={e => setMinutes(Math.min(1440, Math.max(0, Number(e.target.value) || 0)))}
        />
      </div>
    </Modal>
  );
}

function EventCard({
  config,
  templates,
  canWrite,
  sessionId,
  onChangeTemplate,
  onToggleEnabled,
  onTest,
  onConfigureDelay,
}: {
  config: KirvanoEventConfig;
  templates: MessageTemplate[];
  canWrite: boolean;
  sessionId: string;
  onChangeTemplate: (templateId: string) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onTest: () => void;
  onConfigureDelay: () => void;
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
        <div className="kirvano-card-header-actions">
          
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
          <button type="button" className="icon-btn" title={t('kirvano.delay.button')} onClick={onConfigureDelay}>
            <Timer size={16} />
          </button>
        </div>
      </div>

      <div className="kirvano-card-body">
        <p className="kirvano-card-delay">{t('kirvano.delay.summary', { count: config.delayMinutes })}</p>

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

        <div className="kirvano-card-actions">
          <Link
            className="btn-secondary kirvano-edit-btn"
            to={`/templates?session=${encodeURIComponent(sessionId)}&template=${encodeURIComponent(config.templateId)}`}
          >
            <Pencil size={14} />
            {t('kirvano.editMessage')}
          </Link>
          <button type="button" className="btn-secondary" disabled={!canWrite} onClick={onTest}>
            <Send size={14} />
            {t('kirvano.testMessage.button')}
          </button>
        </div>
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

  const { data: events = [], isLoading: loadingEvents } = useKirvanoEventsQuery(selectedSessionId, !!selectedSessionId);
  const { data: templates = [] } = useTemplatesQuery(selectedSessionId, !!selectedSessionId);
  const updateMutation = useUpdateKirvanoEventMutation();
  const [testingConfig, setTestingConfig] = useState<KirvanoEventConfig | null>(null);
  const [configuringDelayFor, setConfiguringDelayFor] = useState<KirvanoEventConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'log'>('config');

  useEffect(() => {
    if (!selectedSessionId && sessions.length > 0) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [selectedSessionId, sessions]);

  const variables = t('kirvano.variables', { returnObjects: true }) as unknown as KirvanoVariable[];

  const handleUpdate = async (eventType: KirvanoEventType, data: KirvanoEventUpdatePayload) => {
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
      ) : (
        <>
          <div className="kirvano-tabs">
            <button
              type="button"
              className={`kirvano-tab${activeTab === 'config' ? ' active' : ''}`}
              onClick={() => setActiveTab('config')}
            >
              {t('kirvano.tabs.config')}
            </button>
            <button
              type="button"
              className={`kirvano-tab${activeTab === 'log' ? ' active' : ''}`}
              onClick={() => setActiveTab('log')}
            >
              {t('kirvano.tabs.log')}
            </button>
          </div>

          {activeTab === 'log' ? (
            <KirvanoEventLog sessionId={selectedSessionId} />
          ) : loadingEvents ? (
            <div className="kirvano-loading-inline">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : (
            <>
              <ConnectionCard sessionId={selectedSessionId} canWrite={canWrite} />

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
                    onTest={() => setTestingConfig(config)}
                    onConfigureDelay={() => setConfiguringDelayFor(config)}
                  />
                ))}
              </div>

              <section className="kirvano-variables">
                <h2>{t('kirvano.variablesTitle')}</h2>
                <p>{t('kirvano.variablesDescription')}</p>
                <div className="kirvano-variables-table-wrap">
                  <table className="kirvano-variables-table">
                    <thead>
                      <tr>
                        <th>{t('kirvano.variablesTable.variable')}</th>
                        <th>{t('kirvano.variablesTable.description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variables.map(variable => (
                        <tr key={variable.token}>
                          <td>
                            <code>{`{{${variable.token}}}`}</code>
                          </td>
                          <td>{variable.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          <TestMessageModal
            open={!!testingConfig}
            onClose={() => setTestingConfig(null)}
            sessionId={selectedSessionId}
            template={templates.find(tpl => tpl.id === testingConfig?.templateId)}
          />

          <DelayConfigModal
            open={!!configuringDelayFor}
            onClose={() => setConfiguringDelayFor(null)}
            config={configuringDelayFor}
            canWrite={canWrite}
            onSave={delayMinutes => {
              if (configuringDelayFor) void handleUpdate(configuringDelayFor.eventType, { delayMinutes });
            }}
          />
        </>
      )}
    </div>
  );
}
