import { AIProviderError } from './provider-catalog';

/**
 * Microphone capture for dictation.
 *
 * `MediaRecorder` is used rather than an audio worklet because every supported platform can
 * encode Opus into a container the transcription endpoint accepts, and the browser does the
 * encoding off the UI thread. One recorder per recording keeps the state machine here small:
 * callers only ever hold a `Recording` and either stop it (yielding audio) or cancel it.
 */

export type Recording = {
  /** Container/mime type of the blob returned by `stop()`. */
  mimeType: string;
  /** Ends the recording and resolves with everything captured so far. */
  stop(): Promise<Blob>;
  /** Ends the recording and throws the audio away. */
  cancel(): void;
};

const CANDIDATE_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

/** The first container this build and platform can produce, or '' to let the browser choose. */
export function preferredMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const supported = CANDIDATE_TYPES.find(
    (type) =>
      typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(type)
  );
  return supported || '';
}

/**
 * Turns a `getUserMedia` failure into something a person can act on. The raw DOMException names
 * ("NotAllowedError") mean nothing in a tooltip.
 */
export function explainMicrophoneError(error: unknown): string {
  const name = error && (error as { name?: string }).name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow the microphone for Nuncio in your system privacy settings, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone matched the device chosen in Preferences → AI. Pick another input device there.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is being used by another app. Close it and try again.';
    default:
      return 'The microphone could not be started. Check the input device in Preferences → AI.';
  }
}

/**
 * Starts capturing from `deviceId` (empty means the system default). Resolves once the stream is
 * live, so the caller can show a recording state without waiting for the first audio chunk.
 */
export async function startRecording(deviceId = ''): Promise<Recording> {
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    throw new AIProviderError('This window cannot record audio.');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new AIProviderError('This build has no audio recorder.');
  }

  let stream: MediaStream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    });
  } catch (error) {
    throw new AIProviderError(explainMicrophoneError(error));
  }

  const mimeType = preferredMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.start();

  const releaseStream = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        const finish = () => {
          releaseStream();
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
        };
        recorder.onerror = () => {
          releaseStream();
          reject(new AIProviderError('The recording stopped unexpectedly.'));
        };
        recorder.onstop = finish;
        if (recorder.state === 'inactive') {
          finish();
        } else {
          recorder.stop();
        }
      }),
    cancel: () => {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch (error) {
        // Stopping an already-stopped recorder throws; the stream still needs releasing.
      }
      releaseStream();
    },
  };
}

/**
 * Chooses a filename whose extension matches the container, because the transcription endpoint
 * sniffs the format from it.
 */
export function filenameForMimeType(mimeType: string): string {
  if (/ogg/.test(mimeType)) return 'dictation.ogg';
  if (/mp4|m4a|aac/.test(mimeType)) return 'dictation.m4a';
  if (/wav/.test(mimeType)) return 'dictation.wav';
  return 'dictation.webm';
}
