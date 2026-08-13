import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Mic, Trash2, X } from 'lucide-react';
import { contactApi, messageApi, type Chat } from '../../services/api';
import { useToast } from '../../hooks/useToast';
import { Modal } from '../Modal';
import { pickRecordingMimeType, recordingFileExtension, formatRecordingTime } from '../../utils/audioRecording';

/** A picked-or-recorded, unsent file, staged until send or removal. */
interface StagedFile {
  file: File;
  base64: string;
  mimetype: string;
  filename: string;
  /** Set when this attachment came from the mic recorder (labels the preview as a voice message). */
  recordedAudio?: boolean;
  /** Set only for an actual Ogg/Opus recording, so send-audio delivers it as a voice note (PTT). See
   * the identical doc comment on ChatComposer's StagedAttachment for why WebM recordings don't. */
  ptt?: boolean;
}

// Sanity check only (optional leading +, 8-15 digits) — the check-number call against the engine is
// the actual source of truth for whether the number is a real, reachable WhatsApp account.
const PHONE_FORMAT = /^\+?[1-9]\d{7,14}$/;

interface Props {
  sessionId: string;
  onClose: () => void;
  /** Fired once the message has been sent, with a Chat the caller can select immediately. */
  onChatCreated: (chat: Chat) => void;
}

function NewChatModal({ sessionId, onClose, onChatCreated }: Props) {
  const { t } = useTranslation();
  const { success: showSuccessToast, error: showErrorToast, warning: showWarningToast } = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<StagedFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Monotonic token invalidating an in-flight FileReader — a removal or form reset before `onload`
  // fires must win over the late-arriving file bytes (same pattern as StatusComposeModal/ChatComposer).
  const readSeq = useRef(0);

  // Mic recording state — same shape as ChatComposer's: MediaRecorder/stream/timer live in refs
  // since they're imperative handles the start/stop/cancel functions mutate directly.
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set right before calling .stop() on a cancel, so the onstop handler discards the chunks instead
  // of staging them — .stop() always fires onstop, cancel just needs to skip its work.
  const discardRecordingRef = useRef(false);

  // Revoke the object URL created for an audio/image preview once it's replaced or cleared — covers
  // every path (new file, new recording, removal, send, unmount) in one place.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Closing the modal mid-recording must not leave the microphone hot in the background.
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        discardRecordingRef.current = true;
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, []);

  const phoneDigits = phone.replace(/[^0-9]/g, '');
  const phoneValid = PHONE_FORMAT.test(phone.trim());

  const resetForm = useCallback(() => {
    readSeq.current += 1;
    setName('');
    setPhone('');
    setPhoneTouched(false);
    setText('');
    setAttachment(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const closeModal = useCallback(() => {
    onClose();
    resetForm();
  }, [onClose, resetForm]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type.startsWith('image/') || file.type.startsWith('audio/')) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
    const myRead = ++readSeq.current;
    const reader = new FileReader();
    reader.onload = event => {
      if (readSeq.current !== myRead) return;
      const dataUrl = event.target?.result as string;
      setAttachment({ file, base64: dataUrl.split(',')[1] ?? '', mimetype: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
  };

  const removeAttachment = () => {
    readSeq.current += 1;
    setAttachment(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startRecording = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      showErrorToast(t('chats.errors.micUnsupported'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordingChunksRef.current = [];
      discardRecordingRef.current = false;

      recorder.ondataavailable = event => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        if (discardRecordingRef.current || chunks.length === 0) return;

        const blobType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: blobType });
        const filename = `voice-${Date.now()}.${recordingFileExtension(blobType)}`;
        const file = new File([blob], filename, { type: blobType });
        const isOgg = blobType.toLowerCase().startsWith('audio/ogg');

        readSeq.current += 1; // supersedes any in-flight file-picker read
        const reader = new FileReader();
        reader.onload = event => {
          const dataUrl = event.target?.result as string;
          setAttachment({
            file,
            base64: dataUrl.split(',')[1] ?? '',
            mimetype: blobType,
            filename,
            recordedAudio: true,
            ptt: isOgg,
          });
          setPreviewUrl(URL.createObjectURL(blob));
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(seconds => seconds + 1);
      }, 1000);
      setIsRecording(true);
    } catch (err) {
      showErrorToast(t('chats.errors.micPermission'), err instanceof Error ? err.message : undefined);
    }
  };

  const finishRecording = (discard: boolean) => {
    discardRecordingRef.current = discard;
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setIsRecording(false);
  };

  const stopRecording = () => finishRecording(false);
  const cancelRecording = () => finishRecording(true);

  const canSubmit =
    Boolean(sessionId) &&
    !submitting &&
    !isRecording &&
    phoneValid &&
    (text.trim().length > 0 || Boolean(attachment));

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Resolve the typed number to a real, addressable WhatsApp id before doing anything else — both
      // the contact save and the send need it, and neither should be attempted for a bad number.
      const resolved = await contactApi.checkNumber(sessionId, phoneDigits);
      if (!resolved.exists || !resolved.whatsappId) {
        showErrorToast(t('chats.newChat.numberNotFound'));
        return;
      }
      const chatId = resolved.whatsappId;
      const trimmedName = name.trim();

      if (trimmedName) {
        try {
          const [firstName, ...rest] = trimmedName.split(/\s+/);
          await contactApi.upsertContact(sessionId, chatId, firstName, rest.length ? rest.join(' ') : undefined);
        } catch (err) {
          // The message can still go out even if the addressbook save failed (e.g. an @lid id) — warn
          // and keep going rather than aborting the whole flow.
          showWarningToast(t('chats.newChat.contactSaveFailed'), err instanceof Error ? err.message : undefined);
        }
      }

      const textToSend = text.trim();
      let lastMessage = textToSend;
      if (attachment) {
        let mediaType: 'image' | 'video' | 'audio' | 'document' = 'document';
        if (attachment.mimetype.startsWith('image/')) mediaType = 'image';
        else if (attachment.mimetype.startsWith('video/')) mediaType = 'video';
        else if (attachment.mimetype.startsWith('audio/')) mediaType = 'audio';
        await messageApi.sendMedia(sessionId, chatId, mediaType, {
          base64: attachment.base64,
          mimetype: attachment.mimetype,
          filename: attachment.filename,
          caption: mediaType !== 'audio' ? textToSend || undefined : undefined,
          ptt: mediaType === 'audio' ? attachment.ptt : undefined,
        });
        lastMessage = textToSend || attachment.filename;
      } else {
        await messageApi.sendText(sessionId, chatId, textToSend);
      }

      showSuccessToast(t('chats.newChat.created'));
      const chat: Chat = {
        id: chatId,
        name: trimmedName || chatId.split('@')[0],
        isGroup: false,
        kind: 'individual',
        unreadCount: 0,
        timestamp: Math.floor(Date.now() / 1000),
        lastMessage,
      };
      closeModal();
      onChatCreated(chat);
    } catch (err) {
      showErrorToast(t('chats.newChat.createFailed'), err instanceof Error ? err.message : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open
      onClose={closeModal}
      title={t('chats.newChat.title')}
      closeLabel={t('common.close')}
      className="status-compose-modal new-chat-modal"
      footer={
        <>
          <button className="btn-secondary" onClick={closeModal} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="animate-spin" size={16} /> : t('chats.newChat.submit')}
          </button>
        </>
      }
    >
      <div className="compose-field">
        <label>{t('chats.newChat.nameLabel')}</label>
        <input
          type="text"
          placeholder={t('chats.newChat.namePlaceholder')}
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={100}
        />
      </div>

      <div className="compose-field">
        <label>{t('chats.newChat.phoneLabel')}</label>
        <input
          type="tel"
          placeholder={t('chats.newChat.phonePlaceholder')}
          value={phone}
          onChange={e => setPhone(e.target.value)}
          onBlur={() => setPhoneTouched(true)}
        />
        {phoneTouched && phone.trim().length > 0 && !phoneValid ? (
          <p className="input-hint new-chat-error">{t('chats.newChat.phoneInvalid')}</p>
        ) : (
          <p className="input-hint">{t('chats.newChat.phoneHint')}</p>
        )}
      </div>

      <div className="compose-field">
        <label>{t('chats.newChat.messageLabel')}</label>
        {isRecording ? (
          <div className="input-form recording-bar">
            <button
              type="button"
              onClick={cancelRecording}
              className="btn-input-accessory btn-cancel-recording"
              title={t('chats.cancelRecording')}
            >
              <Trash2 size={20} />
            </button>
            <div className="recording-indicator">
              <span className="recording-dot" />
              <span className="recording-time">{formatRecordingTime(recordingSeconds)}</span>
              <span className="recording-label">{t('chats.recording')}</span>
            </div>
            <button
              type="button"
              onClick={stopRecording}
              className="btn-send-message new-chat-stop-recording"
              aria-label={t('chats.stopRecording')}
              title={t('chats.stopRecording')}
            >
              <Check size={18} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <div className="new-chat-message-row">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={4096}
              placeholder={attachment ? t('chats.captionPlaceholder') : t('chats.messagePlaceholder')}
            />
            {!text.trim() && !attachment && (
              <button
                type="button"
                onClick={startRecording}
                className="btn-input-accessory btn-mic"
                title={t('chats.recordTitle')}
              >
                <Mic size={20} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="compose-field">
        <label>{t('chats.newChat.attachmentLabel')}</label>
        <input type="file" ref={fileInputRef} onChange={handleFileChange} disabled={isRecording} />
      </div>

      {attachment && (
        <div className="attachment-preview-banner new-chat-attachment-preview">
          {attachment.mimetype.startsWith('audio/') ? (
            previewUrl && <audio controls src={previewUrl} className="preview-audio-player" />
          ) : previewUrl ? (
            <img src={previewUrl} alt={attachment.filename} className="preview-thumbnail" />
          ) : (
            <div className="preview-file-icon">📎</div>
          )}
          <div className="preview-file-info">
            <span className="preview-filename">
              {attachment.recordedAudio ? t('chats.voiceMessage') : attachment.filename}
            </span>
            <span className="preview-filesize">({(attachment.file.size / 1024).toFixed(1)} KB)</span>
          </div>
          <button type="button" className="btn-remove-attachment" onClick={removeAttachment}>
            <X size={18} />
          </button>
        </div>
      )}
    </Modal>
  );
}

export default NewChatModal;
