import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Mic, Paperclip, Send, Smile, Trash2, X } from 'lucide-react';
import { messageApi, type Chat, type MessageType } from '../../services/api';
import { mergeOrAppend, type ChatMessageView } from '../../utils/chatMessages';
import { promoteChatWithSnippet } from '../../utils/chatList';
import { messagesQueryKey, useChatMessagesActions } from '../../hooks/useChatMessages';
import { useRole } from '../../hooks/useRole';
import { useToast } from '../../hooks/useToast';
import type { ScrollDirection } from '../../utils/scrollDecision';
import { pickRecordingMimeType, recordingFileExtension, formatRecordingTime } from '../../utils/audioRecording';

// Map an attachment MIME type to the neutral MessageType for the optimistic outgoing bubble, so the
// placeholder matches what the backend will persist (e.g. a PDF is `document`, not `application`).
const messageTypeFromMime = (mimetype: string): MessageType => {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
};

/** A picked-but-unsent file, staged until send, removal, or a move to another chat. */
export interface StagedAttachment {
  file: File;
  base64: string;
  mimetype: string;
  filename: string;
  /**
   * Set when this attachment came from the mic recorder, so the preview banner labels it as a voice
   * message regardless of how it ends up being sent (see `ptt`).
   */
  recordedAudio?: boolean;
  /**
   * Set only when the recorder actually produced an Ogg/Opus container, so send-audio delivers it as
   * a WhatsApp voice note (PTT — mic bubble + waveform). Chromium/Edge only offer WebM for
   * MediaRecorder, and sending THAT container with `ptt: true` makes the engine's voice-note
   * processing (duration/waveform read from a container it does not expect) throw — surfacing to the
   * dashboard as a bare 500. Rather than guess at a server-side fix blind, a WebM recording is sent
   * as a plain audio attachment instead: still playable, just not the mic-bubble UI. Only a browser
   * that actually recorded Ogg/Opus (Firefox) gets the real voice note.
   */
  ptt?: boolean;
}

interface ChatComposerProps {
  selectedSessionId: string;
  activeChat: Chat;
  replyingTo: ChatMessageView | null;
  setReplyingTo: Dispatch<SetStateAction<ChatMessageView | null>>;
  onMessageAppended: (direction: ScrollDirection) => void;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  messageInput: string;
  setMessageInput: Dispatch<SetStateAction<string>>;
  attachment: StagedAttachment | null;
  setAttachment: Dispatch<SetStateAction<StagedAttachment | null>>;
  previewUrl: string | null;
  setPreviewUrl: Dispatch<SetStateAction<string | null>>;
}

// The composer half of the chat room: attachment preview, emoji panel, reply banner, and the input
// bar with the whole optimistic-send flow. `replyingTo` is shared with the thread (its reply action
// sets it), and `messageInput` plus the staged attachment live in the page so a draft survives
// closing the room; everything else is local.
function ChatComposer({
  selectedSessionId,
  activeChat,
  replyingTo,
  setReplyingTo,
  onMessageAppended,
  setChats,
  messageInput,
  setMessageInput,
  attachment,
  setAttachment,
  previewUrl,
  setPreviewUrl,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const { canWrite } = useRole();
  const { error: showErrorToast } = useToast();
  const { appendMessage, updateMessage } = useChatMessagesActions();
  const queryClient = useQueryClient();

  const [sending, setSending] = useState<boolean>(false);

  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);
  // Monotonic token invalidating an in-flight attachment FileReader: picking a second file (or
  // removing the attachment) before `onload` fires must win over the late-arriving bytes —
  // otherwise the slower read overwrites the newer pick. Same pattern as composeImageReadSeq.
  const attachmentReadSeq = useRef(0);

  // Leaving this conversation — switching to another chat, or unmounting when the room closes —
  // invalidates an in-flight read, so its late `onload` drops the bytes instead of staging them
  // against whichever chat is open by then. The attachment state itself lives in the page.
  useEffect(() => {
    return () => {
      attachmentReadSeq.current += 1;
    };
  }, [activeChat.id]);

  // References
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Mic recording state. The MediaRecorder/stream/timer live in refs (not state) since they are
  // imperative handles the effect below and the start/stop/cancel handlers mutate directly.
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set right before calling .stop() on a cancel, so the onstop handler discards the chunks
  // instead of staging them — .stop() always fires onstop, cancel just needs to skip its work.
  const discardRecordingRef = useRef(false);

  // Switching chats or closing the room must not leave the microphone hot in the background —
  // stop any in-flight recording and release the stream/timer, discarding whatever was captured
  // (mirrors the page dropping a staged attachment on the same transition).
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
  }, [activeChat.id]);

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
        // See the `ptt` doc comment on StagedAttachment — only an actual Ogg/Opus recording is sent
        // as a voice note; a WebM recording still uploads fine as a plain audio attachment.
        const isOgg = blobType.toLowerCase().startsWith('audio/ogg');

        const reader = new FileReader();
        reader.onload = event => {
          const dataUrl = event.target?.result as string;
          const base64Data = dataUrl.split(',')[1];
          setAttachment({ file, base64: base64Data, mimetype: blobType, filename, recordedAudio: true, ptt: isOgg });
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

  // Popular emojis
  const popularEmojis = [
    '😀',
    '😂',
    '👍',
    '❤️',
    '🔥',
    '👏',
    '🙏',
    '🎉',
    '💡',
    '🤔',
    '😅',
    '😍',
    '😊',
    '😭',
    '😎',
    '😜',
    '🚀',
    '✨',
  ];

  // 5. Handle file selection & base64 conversion
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('image/') || file.type.startsWith('audio/')) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }

    const myRead = ++attachmentReadSeq.current;
    const reader = new FileReader();
    reader.onload = event => {
      // A newer pick, a removal, or an unmount since the read started supersedes these bytes.
      if (attachmentReadSeq.current !== myRead) return;
      const dataUrl = event.target?.result as string;
      const base64Data = dataUrl.split(',')[1];
      setAttachment({ file, base64: base64Data, mimetype: file.type, filename: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAttachment = () => {
    attachmentReadSeq.current += 1; // an in-flight read must not resurrect the removed attachment
    setAttachment(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleEmojiClick = (emoji: string) => {
    setMessageInput(prev => prev + emoji);
    setShowEmojiPicker(false);
  };

  // 7. Handle sending a message / media
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedSessionId || !activeChat || sending) return;

    const textToSend = messageInput.trim();
    if (!textToSend && !attachment) return;

    setMessageInput('');
    setSending(true);

    const tempId = `temp_${Date.now()}`;
    const tempMessage: ChatMessageView = {
      id: tempId,
      chatId: activeChat.id,
      from: 'me',
      to: activeChat.id,
      body: attachment
        ? attachment.mimetype.startsWith('image/') ||
          attachment.mimetype.startsWith('video/') ||
          attachment.mimetype.startsWith('audio/')
          ? textToSend
          : attachment.filename
        : textToSend,
      type: attachment ? messageTypeFromMime(attachment.mimetype) : 'text',
      direction: 'outgoing',
      status: 'pending',
      createdAt: new Date().toISOString(),
      metadata: attachment
        ? {
            media: {
              mimetype: attachment.mimetype,
              filename: attachment.filename,
              data: attachment.base64,
            },
          }
        : replyingTo
          ? {
              quotedMessage: {
                id: replyingTo.waMessageId || replyingTo.id,
                body: replyingTo.type !== 'text' ? `[${replyingTo.type}]` : replyingTo.body,
              },
            }
          : undefined,
    };

    appendMessage(selectedSessionId, activeChat.id, tempMessage);
    onMessageAppended('outgoing');

    const currentAttachment = attachment;
    const currentReplyingTo = replyingTo;
    handleRemoveAttachment();
    setReplyingTo(null);

    try {
      let result;

      if (currentAttachment) {
        let mediaType: 'image' | 'video' | 'audio' | 'document' = 'document';
        const mime = currentAttachment.mimetype;
        if (mime.startsWith('image/')) mediaType = 'image';
        else if (mime.startsWith('video/')) mediaType = 'video';
        else if (mime.startsWith('audio/')) mediaType = 'audio';

        result = await messageApi.sendMedia(selectedSessionId, activeChat.id, mediaType, {
          base64: currentAttachment.base64,
          mimetype: currentAttachment.mimetype,
          filename: currentAttachment.filename,
          caption: mediaType !== 'audio' ? textToSend : undefined,
          ptt: mediaType === 'audio' ? currentAttachment.ptt : undefined,
        });
      } else if (currentReplyingTo) {
        result = await messageApi.reply(selectedSessionId, {
          chatId: activeChat.id,
          quotedMessageId: currentReplyingTo.waMessageId || currentReplyingTo.id,
          text: textToSend,
        });
      } else {
        result = await messageApi.sendText(selectedSessionId, activeChat.id, textToSend);
      }

      setTimeout(() => {
        const messageText = document.getElementById('message-text-input') as HTMLTextAreaElement;        
        messageText.focus();
      }, 100)   

      // Race guard: the realtime `message.sent` echo can arrive before this response and already
      // append the message by its real WA id (the dedup at receive time misses because the
      // optimistic placeholder still carries the temp id). If so, fold the placeholder INTO the
      // echo's row via mergeOrAppend instead of just dropping it — the echo carries no media
      // payload (engine parity marker), so dropping the placeholder would erase the attachment's
      // base64 and leave a bare "📎 Media" bubble until the next refetch.
      const sendKey = messagesQueryKey(selectedSessionId, activeChat.id);
      queryClient.setQueryData<ChatMessageView[]>(sendKey, (prev = []) => {
        const reconciled: ChatMessageView = {
          ...tempMessage,
          id: result.messageId,
          waMessageId: result.messageId,
          status: 'sent',
        };
        const echoAlreadyAdded = prev.some(m => m.id === result.messageId || m.waMessageId === result.messageId);
        if (echoAlreadyAdded) {
          return mergeOrAppend(
            prev.filter(m => m.id !== tempId),
            reconciled,
          );
        }
        return prev.map(m => (m.id === tempId ? reconciled : m));
      });

      // Update sidebar chat list (move active chat to the top with the new snippet)
      const snippet = currentAttachment ? `[${currentAttachment.mimetype.split('/')[0]}]` : textToSend;
      const sentAt = Math.floor(Date.now() / 1000);
      setChats(prevChats => promoteChatWithSnippet(prevChats, activeChat.id, snippet, sentAt));
    } catch (err) {
      showErrorToast(t('chats.errors.send'), err instanceof Error ? err.message : undefined);
      updateMessage(selectedSessionId, activeChat.id, tempId, { status: 'failed' });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Attachment preview banner */}
      {attachment && (
        <div className="attachment-preview-banner">
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
          <button className="btn-remove-attachment" onClick={handleRemoveAttachment}>
            <X size={18} />
          </button>
        </div>
      )}

      {/* Popular emojis panel */}
      {showEmojiPicker && (
        <div className="chats-emoji-picker">
          <div className="emoji-grid">
            {popularEmojis.map(emoji => (
              <button key={emoji} type="button" className="emoji-btn" onClick={() => handleEmojiClick(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Replying preview banner */}
      {replyingTo && (
        <div className="replying-preview-banner">
          <div className="replying-preview-content">
            <div className="replying-to-title">
              {t('chats.replyingTo', {
                name:
                  replyingTo.direction === 'outgoing' ? t('chats.you') : activeChat.name || activeChat.id.split('@')[0],
              })}
            </div>
            <div className="replying-to-body">
              {replyingTo.type !== 'text' ? `[${replyingTo.type}]` : replyingTo.body}
            </div>
          </div>
          <button className="btn-close-reply" onClick={() => setReplyingTo(null)}>
            <X size={18} />
          </button>
        </div>
      )}

      {/* Message input bar */}
      <footer className="room-input-footer">
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
              className="btn-send-message"
              aria-label={t('chats.stopRecording')}
              title={t('chats.stopRecording')}
            >
              <Check size={24} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <form onSubmit={handleSend} className="input-form">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />

            <button
              type="button"
              onClick={triggerFileSelect}
              disabled={!canWrite || sending}
              className="btn-input-accessory"
              title={t('chats.attachTitle')}
            >
              <Paperclip size={20} />
            </button>

            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              disabled={!canWrite || sending}
              className={`btn-input-accessory ${showEmojiPicker ? 'active' : ''}`}
              title={t('chats.emojiTitle')}
            >
              <Smile size={20} />
            </button>
            <textarea
              id="message-text-input"
              placeholder={
                canWrite
                  ? attachment
                    ? t('chats.captionPlaceholder')
                    : t('chats.messagePlaceholder')
                  : t('chats.noPermission')
              }
              value={messageInput}
              onChange={e => setMessageInput(e.target.value)}
              disabled={!canWrite || sending}
              className="message-text-input"
              rows={1}
              onKeyDown={(e) => {

                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
                // Shift+Enter insere quebra de linha normalmente
              }}
            />
            {!messageInput.trim() && !attachment && (
              <button
                type="button"
                onClick={startRecording}
                disabled={!canWrite || sending}
                className="btn-input-accessory btn-mic"
                title={t('chats.recordTitle')}
              >
                <Mic size={20} />
              </button>
            )}
            <button
              type="submit"
              disabled={!canWrite || (!messageInput.trim() && !attachment) || sending}
              className="btn-send-message"
              aria-label={t('chats.send')}
            >
              {sending ? <Loader2 className="animate-spin" size={24} /> : <Send size={28} strokeWidth={2.5} />}
            </button>
          </form>
        )}
      </footer>
    </>
  );
}

export default ChatComposer;
