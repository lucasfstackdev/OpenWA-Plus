/**
 * Shared MediaRecorder helpers for the mic-recording flow (ChatComposer's reply-in-room recorder
 * and NewChatModal's first-message recorder both need the exact same container negotiation).
 */

// Ogg/Opus first: it is the only container sent as a WhatsApp voice note (`ptt: true`). WebM is
// listed anyway so recording still works (as a plain audio attachment) on Chromium/Edge, which
// don't offer Ogg to MediaRecorder at all.
export const RECORDING_MIME_CANDIDATES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

export const pickRecordingMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined') return '';
  return RECORDING_MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported?.(type)) ?? '';
};

export const recordingFileExtension = (mimetype: string): string => {
  if (mimetype.includes('ogg')) return 'ogg';
  if (mimetype.includes('mp4')) return 'm4a';
  return 'webm';
};

export const formatRecordingTime = (totalSeconds: number): string => {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};
