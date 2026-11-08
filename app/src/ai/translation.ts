/**
 * Text-block translation against a provider the user configures, by key.
 *
 * Old Mailspring translated through id.getmailspring.com; Nuncio does it client side.
 * The contract every adapter serves is the one the composer already needs: an array of
 * text blocks in, an array of translations out, same order and same length. That lets
 * translation UIs translate exactly the blocks they picked and merge the answers back
 * positionally, without round-tripping HTML through the provider.
 */

import { AIProviderError } from './provider-catalog';
import { ChatConfig, readChatConfig, TranslationConfig } from './config';
import { completeChat } from './completion';

export type TranslateBlocksInput = {
  blocks: string[];
  /** BCP-47-ish code as the client uses it, e.g. "nl", "zh", "pt". */
  targetLang: string;
  config: TranslationConfig;
  chatConfig?: ChatConfig;
  signal?: AbortSignal;
};

export const DEEPL_PRO_BASE_URL = 'https://api.deepl.com';
export const DEEPL_FREE_BASE_URL = 'https://api-free.deepl.com';

/** Free keys end in ":fx" and must hit api-free.deepl.com; pro keys hit api.deepl.com. */
export function deeplBaseUrlFor(apiKey: string): string {
  return apiKey.trim().endsWith(':fx') ? DEEPL_FREE_BASE_URL : DEEPL_PRO_BASE_URL;
}

/** A few target languages need a region for DeepL; a bare code is deprecated but works. */
const DEEPL_TARGET_ALIASES: { [code: string]: string } = {
  en: 'EN-US',
  pt: 'PT-PT',
  zh: 'ZH',
};

async function explainFailure(
  response: Response,
  endpoint: string,
  provider: string
): Promise<AIProviderError> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 200);
  } catch {
    // the body may be empty; the status alone still says something useful
  }
  if (response.status === 401 || response.status === 403) {
    return new AIProviderError(
      `The ${provider} API key was rejected. Check the key in Preferences › AI › Translation.`
    );
  }
  if (response.status === 429 || response.status === 456) {
    return new AIProviderError(
      `The ${provider} key is out of quota or rate limited (HTTP ${response.status}).`
    );
  }
  if (response.status === 400 || response.status === 422) {
    return new AIProviderError(
      `${provider} rejected the request (HTTP ${response.status}): an unknown target language or a malformed request.`
    );
  }
  return new AIProviderError(
    `${provider} returned HTTP ${response.status} on ${endpoint}${detail ? `: ${detail}` : ''}`
  );
}

async function translateWithDeepL(
  blocks: string[],
  targetLang: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  const key = apiKey.trim();
  if (!key) {
    throw new AIProviderError(
      'Translation needs a DeepL API key. Add one in Preferences › AI › Translation.'
    );
  }
  const endpoint = `${deeplBaseUrlFor(key).replace(/\/+$/, '')}/v2/translate`;
  const target = DEEPL_TARGET_ALIASES[targetLang.toLowerCase()] || targetLang.toUpperCase();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `DeepL-Auth-Key ${key}`,
      },
      body: JSON.stringify({ text: blocks, target_lang: target }),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new AIProviderError(`Could not reach ${endpoint}. Check your network connection.`);
  }
  if (!response.ok) throw await explainFailure(response, endpoint, 'DeepL');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AIProviderError('DeepL returned a response that is not JSON.');
  }
  const translations = (payload as any)?.translations;
  if (!Array.isArray(translations)) {
    throw new AIProviderError('DeepL returned no translations.');
  }
  return translations.map((entry: any) => (typeof entry?.text === 'string' ? entry.text : ''));
}

async function translateWithLibre(
  blocks: string[],
  targetLang: string,
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (!baseUrl) {
    throw new AIProviderError(
      'Translation needs a LibreTranslate server URL. Add one in Preferences › AI › Translation.'
    );
  }
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/translate`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: blocks,
        source: 'auto',
        target: targetLang.toLowerCase(),
        format: 'text',
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      }),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new AIProviderError(
      `Could not reach ${endpoint}. Check the URL and your network connection.`
    );
  }
  if (!response.ok) throw await explainFailure(response, endpoint, 'LibreTranslate');

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AIProviderError('LibreTranslate returned a response that is not JSON.');
  }
  const translated = (payload as any)?.translatedText;
  if (Array.isArray(translated)) {
    return translated.map((text: unknown) => (typeof text === 'string' ? text : ''));
  }
  if (typeof translated === 'string' && blocks.length === 1) {
    return [translated];
  }
  throw new AIProviderError('LibreTranslate returned a different number of translations.');
}

async function translateWithChat(
  blocks: string[],
  targetLang: string,
  chatConfig: ChatConfig,
  signal?: AbortSignal
): Promise<string[]> {
  if (!chatConfig.baseUrl || !chatConfig.apiKey || !chatConfig.model) {
    throw new AIProviderError(
      'Translation runs on the AI model, but no AI provider is configured. Set one in Preferences › AI › AI provider.'
    );
  }

  const reply = await completeChat({
    config: chatConfig,
    signal,
    temperature: 0.1,
    maxTokens: 4000,
    messages: [
      {
        role: 'system',
        content:
          'You are a translation engine for email text. The user sends a JSON array of strings, ' +
          'each an independent text block from one email. Reply with ONLY a JSON array of the same ' +
          'length, each entry the translation of the entry at the same position. Keep the tone of ' +
          'the original, never translate URLs, email addresses, numbers or codes, keep every entry ' +
          'plain text without markup, and add no commentary. Target language: ' +
          `${targetLang}.`,
      },
      { role: 'user', content: JSON.stringify(blocks) },
    ],
  });

  const parsed = parseChatTranslationReply(reply);
  if (!parsed || parsed.length !== blocks.length) {
    throw new AIProviderError(
      'The AI model did not return one translation per block. Try another model, or configure DeepL or LibreTranslate.'
    );
  }
  return parsed;
}

/**
 * The model may wrap the array in code fences or prose. Accept any fenced or bare JSON array
 * of strings. A length mismatch is still a failure: merging positionally would misplace whole
 * paragraphs, so the caller rejects it instead.
 */
function parseChatTranslationReply(text: string): string[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
      return parsed;
    }
  } catch {
    // fall through: the model reformatted the array, degrade the reply cleanly
  }
  return null;
}

async function translateBlocksInternal(
  blocks: string[],
  targetLang: string,
  config: TranslationConfig,
  chatConfig: ChatConfig,
  signal?: AbortSignal
): Promise<string[]> {
  if (blocks.length === 0) return [];
  if (config.provider === 'deepl') {
    return translateWithDeepL(blocks, targetLang, config.apiKey, signal);
  }
  if (config.provider === 'libre') {
    return translateWithLibre(blocks, targetLang, config.baseUrl, config.apiKey, signal);
  }
  return translateWithChat(blocks, targetLang, chatConfig || readChatConfig(), signal);
}

export async function translateBlocks(input: TranslateBlocksInput): Promise<string[]> {
  return translateBlocksInternal(
    input.blocks,
    input.targetLang,
    input.config,
    input.chatConfig || readChatConfig(),
    input.signal
  );
}

/** Smallest possible round trip, so the settings tab can prove a provider works. */
export async function testTranslation(
  config: TranslationConfig,
  signal?: AbortSignal
): Promise<string> {
  const [out] = await translateBlocksInternal(
    ['This sentence proves translation works.'],
    'nl',
    config,
    readChatConfig(),
    signal
  );
  return out;
}
