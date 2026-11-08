/**
 * Catalogue of hosted, OpenAI-compatible AI providers.
 *
 * Nuncio talks to providers through the OpenAI `/models` shape, so one normaliser covers
 * DeepInfra, Mistral and any other compatible endpoint. Providers publish very different
 * metadata, though: DeepInfra ships descriptions and per-token prices in `metadata`, Mistral
 * ships capability flags but no prices at all. Everything a provider omits stays `undefined`
 * so the settings UI can hide it instead of showing a zero.
 */

export type AIModelInfo = {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  /** US dollars per 1M input tokens, as published by the provider. */
  inputCostPerMillion?: number;
  /** US dollars per 1M output tokens, as published by the provider. */
  outputCostPerMillion?: number;
  capabilities: string[];
  deprecated: boolean;
  chatCapable: boolean;
};

export type AIProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  /** Whether the provider publishes per-token prices in its model list. */
  publishesPricing: boolean;
};

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: 'deepinfra',
    label: 'DeepInfra',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    publishesPricing: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    publishesPricing: false,
  },
];

export class AIProviderError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AIProviderError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trim, add a scheme when the user typed a bare host, and drop trailing slashes. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

export function presetFor(baseUrl: string): AIProviderPreset | undefined {
  const normalized = normalizeBaseUrl(baseUrl).toLowerCase();
  if (!normalized) return undefined;
  return AI_PROVIDER_PRESETS.find((preset) => preset.baseUrl.toLowerCase() === normalized);
}

export function modelsEndpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) {
    throw new AIProviderError('Enter a base URL first.');
  }
  return `${base}/models`;
}

/** `$0.02`, `$0.005`, `free` — or null when the provider published no price. */
export function formatCostPerMillion(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value === 0) return 'free';
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  // Below a cent, two decimals would print $0.00, so keep enough digits to show the price
  // and strip the padding those digits add.
  const decimals = Math.min(8, -Math.floor(Math.log10(value)) + 1);
  return `$${value.toFixed(decimals).replace(/0+$/, '')}`;
}

/** One line about money, or null when there is nothing honest to say. */
export function describePricing(model: AIModelInfo): string | null {
  const input = formatCostPerMillion(model.inputCostPerMillion);
  const output = formatCostPerMillion(model.outputCostPerMillion);
  if (!input && !output) return null;
  if (input && output) return `${input} in · ${output} out per 1M tokens`;
  return `${input || output} ${input ? 'in' : 'out'} per 1M tokens`;
}

export function formatContextLength(tokens: number | undefined): string | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number(millions.toFixed(1))}M context`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K context`;
  return `${tokens} context`;
}

// DeepInfra and friends tag models with things like `chat`, `vision`, `reasoning_effort`.
// Only the tags that change what a user can do with the model get surfaced.
const TAG_LABELS: { [tag: string]: string } = {
  chat: 'Chat',
  vision: 'Vision',
  vlm: 'Vision',
  image_input: 'Vision',
  reasoning: 'Reasoning',
  reasoning_effort: 'Reasoning',
  function_calling: 'Tool calling',
  tools: 'Tool calling',
  tool_use: 'Tool calling',
  json: 'JSON mode',
  json_mode: 'JSON mode',
  structured_outputs: 'JSON mode',
  prompt_cache: 'Prompt caching',
  code: 'Code',
  coder: 'Code',
  embedding: 'Embeddings',
  embeddings: 'Embeddings',
  tts: 'Text to speech',
  'text-to-speech': 'Text to speech',
  ocr: 'OCR',
  classification: 'Classification',
  'text-to-image': 'Image generation',
  'image-generation': 'Image generation',
  'text-to-video': 'Video generation',
  'video-generation': 'Video generation',
  audio: 'Audio',
};

const MISTRAL_CAPABILITY_LABELS: { [capability: string]: string } = {
  completion_chat: 'Chat',
  completion_fim: 'Code completion',
  function_calling: 'Tool calling',
  vision: 'Vision',
  classification: 'Classification',
  fine_tuning: 'Fine-tuning',
  ocr: 'OCR',
  audio: 'Audio',
};

function labelsFromTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const labels: string[] = [];
  for (const tag of tags) {
    const label = typeof tag === 'string' ? TAG_LABELS[tag.toLowerCase()] : undefined;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function labelsFromCapabilities(capabilities: unknown): string[] {
  if (!isRecord(capabilities)) return [];
  const labels: string[] = [];
  for (const [capability, enabled] of Object.entries(capabilities)) {
    const label = MISTRAL_CAPABILITY_LABELS[capability];
    if (enabled === true && label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Providers disagree on where metadata lives; parse a JSON string when we get one. */
function metadataOf(item: Record<string, any>): Record<string, any> | undefined {
  if (isRecord(item.metadata)) return item.metadata;
  if (typeof item.metadata === 'string') {
    try {
      const parsed = JSON.parse(item.metadata);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function pricingOf(metadata: Record<string, any> | undefined) {
  const pricing = metadata && isRecord(metadata.pricing) ? metadata.pricing : undefined;
  if (!pricing) return {};
  // DeepInfra reports USD per 1M tokens as `input_tokens` / `output_tokens`. Character- and
  // image-priced models report other keys; those are not token prices and stay undefined.
  return {
    input: numberOrUndefined(pricing.input_tokens ?? pricing.cents_per_input_token),
    output: numberOrUndefined(pricing.output_tokens ?? pricing.cents_per_output_token),
  };
}

export function normalizeModel(item: unknown): AIModelInfo | null {
  if (!isRecord(item)) return null;
  const id = typeof item.id === 'string' ? item.id : '';
  if (!id) return null;

  const metadata = metadataOf(item);
  const capabilities = item.capabilities;
  const pricing = pricingOf(metadata);
  const tags = metadata && metadata.tags;

  const fromTags = labelsFromTags(tags);
  const fromCapabilities = labelsFromCapabilities(capabilities);
  const capabilitiesList = fromCapabilities.concat(
    fromTags.filter((label) => !fromCapabilities.includes(label))
  );

  let chatCapable = true;
  if (Array.isArray(tags) && tags.length > 0) {
    chatCapable = fromTags.includes('Chat');
  } else if (isRecord(capabilities)) {
    chatCapable = capabilities.completion_chat === true;
  }
  if (chatCapable && !capabilitiesList.includes('Chat')) capabilitiesList.unshift('Chat');

  const contextLength =
    numberOrUndefined(metadata && metadata.context_length) ??
    numberOrUndefined(item.max_context_length) ??
    numberOrUndefined(item.context_length);

  const maxOutputTokens = numberOrUndefined(metadata && metadata.max_tokens);

  return {
    id,
    name: typeof item.name === 'string' && item.name ? item.name : id,
    description:
      (typeof item.description === 'string' && item.description) ||
      (metadata && typeof metadata.description === 'string' ? metadata.description : undefined) ||
      undefined,
    contextLength,
    maxOutputTokens,
    // Only trust prices that came with a token count; a character-priced model would
    // otherwise look absurdly cheap.
    inputCostPerMillion: pricing.input !== undefined ? pricing.input : undefined,
    outputCostPerMillion: pricing.output !== undefined ? pricing.output : undefined,
    capabilities: capabilitiesList,
    deprecated: item.deprecated === true || (metadata ? metadata.deprecated === true : false),
    chatCapable,
  };
}

/** Accepts `{data: [...]}`, `{models: [...]}` or a bare array. */
export function normalizeModelList(payload: unknown): AIModelInfo[] {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : [];

  return sortModels(
    rows.map(normalizeModel).filter((model): model is AIModelInfo => model !== null)
  );
}

/** Chat models first, then alphabetical — a 177-model catalogue is unusable unsorted. */
export function sortModels(models: AIModelInfo[]): AIModelInfo[] {
  return models.slice().sort((a, b) => {
    if (a.chatCapable !== b.chatCapable) return a.chatCapable ? -1 : 1;
    if (a.deprecated !== b.deprecated) return a.deprecated ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

function explainStatus(status: number, endpoint: string): string {
  if (status === 401 || status === 403) {
    return 'The provider rejected the API key. Check the key and that it has access to this endpoint.';
  }
  if (status === 404) {
    return `No model list at ${endpoint}. Check that the base URL ends at the API root, for example https://api.deepinfra.com/v1/openai.`;
  }
  if (status === 429) {
    return 'The provider is rate limiting this key. Try again in a moment.';
  }
  if (status >= 500) {
    return `The provider returned a server error (HTTP ${status}). Try again later.`;
  }
  return `The provider returned HTTP ${status}.`;
}

export async function fetchProviderModels(options: {
  baseUrl: string;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<AIModelInfo[]> {
  const endpoint = modelsEndpoint(options.baseUrl);
  const apiKey = (options.apiKey || '').trim();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new AIProviderError(
      `Could not reach ${endpoint}. Check the base URL and your network connection.`
    );
  }

  if (!response.ok)
    throw new AIProviderError(explainStatus(response.status, endpoint), response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AIProviderError('The provider returned a response that is not JSON.');
  }

  const models = normalizeModelList(payload);
  if (models.length === 0) {
    throw new AIProviderError('The provider returned no models for this key.');
  }
  return models;
}
