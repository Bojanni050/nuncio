/**
 * Text-to-speech through Mistral's audio API.
 *
 * Mistral answers `POST /audio/speech` with JSON carrying base64 audio in `audio_data`, not with
 * an audio body, so the response has to be decoded before it can be played. Voices are listed
 * separately, and a voice is required on every request: either a preset slug, the id of a voice
 * saved in the workspace, or a one-off reference clip.
 */

import { TTSConfig } from './config';
import { AIProviderError, normalizeBaseUrl } from './provider-catalog';

export type TTSVoice = {
  id: string;
  name?: string;
  description?: string;
  languages: string[];
};

export function speechEndpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new AIProviderError('Enter a base URL first.');
  return `${base}/audio/speech`;
}

export function voicesEndpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new AIProviderError('Enter a base URL first.');
  return `${base}/audio/voices`;
}

/** Mistral explains refusals in the body; that sentence beats anything we can guess. */
async function responseDetail(response: Response): Promise<string | null> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  try {
    const payload = JSON.parse(trimmed);
    const message =
      payload?.message || payload?.detail || payload?.error?.message || payload?.error;
    if (typeof message === 'string' && message.trim()) return message.trim();
    // Parsed JSON without a message says nothing useful, so don't echo `{}` back at the user.
    return null;
  } catch {
    // Not JSON; fall through to the raw body.
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

function explainAudioStatus(status: number, endpoint: string, detail: string | null): string {
  if (status === 401 || status === 403) {
    return 'Mistral rejected the API key. Check the key in Preferences › AI.';
  }
  if (status === 404) {
    return `No audio endpoint at ${endpoint}. The base URL should be https://api.mistral.ai/v1.`;
  }
  if (status === 400 || status === 422) {
    return detail
      ? `Mistral rejected the request: ${detail}`
      : 'Mistral rejected the request. The selected model may not be a text-to-speech model.';
  }
  if (status === 429) {
    return 'Mistral is rate limiting this key. Try again in a moment.';
  }
  if (status >= 500) {
    return `Mistral returned a server error (HTTP ${status}). Try again later.`;
  }
  return detail ? `Mistral returned HTTP ${status}: ${detail}` : `Mistral returned HTTP ${status}.`;
}

function languageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry.language === 'string') return entry.language;
      if (entry && typeof entry.code === 'string') return entry.code;
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function normalizeVoice(item: unknown): TTSVoice | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, any>;
  // Presets are addressed by their slug (`gb_jane_neutral`, `voice_478`); voices saved in the
  // workspace have no slug and are addressed by id, so prefer the slug when there is one.
  const id = record.slug || record.id || record.voice_id || record.voiceId;
  if (typeof id !== 'string' || !id) return null;
  return {
    id,
    name: typeof record.name === 'string' ? record.name : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    languages: languageList(record.languages || record.language),
  };
}

export function normalizeVoiceList(payload: unknown): TTSVoice[] {
  const container = payload as any;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(container?.items)
      ? container.items
      : Array.isArray(container?.data)
        ? container.data
        : Array.isArray(container?.voices)
          ? container.voices
          : Array.isArray(container?.result?.data)
            ? container.result.data
            : [];
  const voices = rows
    .map(normalizeVoice)
    .filter((voice: TTSVoice | null): voice is TTSVoice => Boolean(voice));
  return voices.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
}

// The documented example uses limit=10 and offset=N, so that is a size the endpoint is known
// to accept. Walk the pages until `total` is reached.
const VOICE_PAGE_SIZE = 10;
const MAX_VOICE_PAGES = 50;

export async function fetchTTSVoices(options: {
  baseUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<TTSVoice[]> {
  if (!options.apiKey.trim()) {
    throw new AIProviderError('Add the Mistral API key first.');
  }
  const endpoint = voicesEndpoint(options.baseUrl);

  // The documented shape is `{ items, total, page, page_size, total_pages }`, so a single
  // request only returns the first page. Walk the offsets until everything is in.
  const collected: TTSVoice[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_VOICE_PAGES; page++) {
    const response = await requestVoicePage(endpoint, options, offset);

    if (!response.ok) {
      const detail = await responseDetail(response);
      throw new AIProviderError(
        explainAudioStatus(response.status, endpoint, detail),
        response.status
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AIProviderError('Mistral returned a voice list that is not JSON.');
    }

    const rows = voiceRows(payload);
    const voices = normalizeVoiceList(payload);
    collected.push(...voices);

    const total = typeof (payload as any)?.total === 'number' ? (payload as any).total : null;
    offset += rows.length;
    if (rows.length === 0 || (total !== null ? offset >= total : rows.length < VOICE_PAGE_SIZE)) {
      break;
    }
  }

  return normalizeVoiceList(collected);
}

function voiceRows(payload: unknown): unknown[] {
  const container = payload as any;
  if (Array.isArray(payload)) return payload;
  for (const rows of [
    container?.items,
    container?.data,
    container?.voices,
    container?.result?.data,
  ]) {
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

async function requestVoicePage(
  endpoint: string,
  options: { apiKey: string; signal?: AbortSignal },
  offset: number
): Promise<Response> {
  const url = `${endpoint}?limit=${VOICE_PAGE_SIZE}&offset=${offset}`;
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${options.apiKey.trim()}` },
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new AIProviderError(`Could not reach ${url}. Check your network connection.`);
  }
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export type SpeechClip = { blob: Blob; mimeType: string };

/**
 * Turn text into playable audio. Mistral requires a voice on every request, so an empty
 * `config.voice` is passed through and the provider's own refusal is surfaced to the user.
 */
export async function synthesizeSpeech(options: {
  config: TTSConfig;
  text: string;
  signal?: AbortSignal;
}): Promise<SpeechClip> {
  const { config } = options;
  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new AIProviderError(
      'No text-to-speech provider is configured. Add one in Preferences › AI.'
    );
  }
  const text = options.text.trim();
  if (!text) throw new AIProviderError('There is no text to read aloud.');
  const endpoint = speechEndpoint(config.baseUrl);

  const body: Record<string, unknown> = {
    model: config.model,
    input: text,
    response_format: 'mp3',
  };
  if (config.voice) body.voice_id = config.voice;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new AIProviderError(`Could not reach ${endpoint}. Check your network connection.`);
  }

  if (!response.ok) {
    const detail = await responseDetail(response);
    throw new AIProviderError(
      explainAudioStatus(response.status, endpoint, detail),
      response.status
    );
  }

  // Documented shape is JSON with base64 audio. Some gateways answer with the audio bytes
  // instead, so both are accepted rather than failing on a working provider.
  if ((response.headers.get('content-type') || '').includes('application/json')) {
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      throw new AIProviderError('Mistral returned audio metadata that is not JSON.');
    }
    const audio = payload?.audio_data || payload?.audio;
    if (typeof audio !== 'string' || !audio) {
      throw new AIProviderError('Mistral returned no audio for this request.');
    }
    return {
      blob: new Blob([decodeBase64(audio)], { type: 'audio/mpeg' }),
      mimeType: 'audio/mpeg',
    };
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new AIProviderError('Mistral returned empty audio for this request.');
  }
  const mimeType = response.headers.get('content-type') || 'audio/mpeg';
  return { blob: new Blob([buffer], { type: mimeType }), mimeType };
}
