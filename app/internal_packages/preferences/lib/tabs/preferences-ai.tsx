import React from 'react';
import { localized } from 'mailspring-exports';
import {
  AI_PROVIDER_PRESETS,
  AIModelInfo,
  AIProviderError,
  describePricing,
  fetchProviderModels,
  formatContextLength,
  normalizeBaseUrl,
  presetFor,
} from '../../../../src/ai/provider-catalog';
import { AI_CONFIG_KEYS, ChatConfig } from '../../../../src/ai/config';
import { readSecret, storeSecret } from '../../../../src/ai/secrets';
import { testChatProvider } from '../../../../src/ai/completion';
import { ConfigLike } from '../types';
import ModelPicker from './model-picker';
import PreferencesTTS from './preferences-tts';
import PreferencesSTT from './preferences-stt';
import PreferencesTranslation from './preferences-translation';

const PROVIDER_KEY = AI_CONFIG_KEYS.provider;
const BASE_URL_KEY = AI_CONFIG_KEYS.baseUrl;
const MODEL_KEY = AI_CONFIG_KEYS.model;

const CUSTOM_PROVIDER = 'custom';

type PreferencesAIState = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: AIModelInfo[] | null;
  loading: boolean;
  error: string | null;
  revealKey: boolean;
  showAllModels: boolean;
  testing: boolean;
  testStatus: string | null;
  testError: string | null;
};

/**
 * Settings for the hosted AI provider Nuncio uses for its AI features.
 *
 * The provider is configured as an OpenAI-compatible endpoint (base URL + key) so DeepInfra,
 * Mistral and any other compatible service work the same way. Model metadata is fetched on
 * demand: the catalogue is what tells the user which models exist, what they cost, and what
 * they can do, and none of that can be hardcoded without going stale.
 */
class PreferencesAI extends React.Component<{ config: ConfigLike }, PreferencesAIState> {
  static displayName = 'PreferencesAI';

  private _fetchController: AbortController | null = null;
  private _testController: AbortController | null = null;

  constructor(props: { config: ConfigLike }) {
    super(props);
    const savedBaseUrl = props.config.get(BASE_URL_KEY) || '';
    const savedProvider = props.config.get(PROVIDER_KEY) || '';
    const fallbackPreset =
      presetFor(savedBaseUrl) || AI_PROVIDER_PRESETS.find((preset) => preset.id === savedProvider);

    this.state = {
      provider: savedProvider || fallbackPreset?.id || AI_PROVIDER_PRESETS[0].id,
      baseUrl: savedBaseUrl || fallbackPreset?.baseUrl || AI_PROVIDER_PRESETS[0].baseUrl,
      apiKey: readSecret('ai', props.config) || '',
      model: props.config.get(MODEL_KEY) || '',
      models: null,
      loading: false,
      error: null,
      revealKey: false,
      showAllModels: false,
      testing: false,
      testStatus: null,
      testError: null,
    };
  }

  componentDidMount() {
    // A saved key means the user has already configured this provider; load the catalogue so
    // the selected model and its price are visible without another click.
    if (this.state.baseUrl && this.state.apiKey) {
      this._fetchModels();
    }
  }

  componentWillUnmount() {
    this._fetchController?.abort();
    this._testController?.abort();
  }

  _setConfig(key: string, value: string) {
    this.props.config.set(key, value);
  }

  _onProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = event.target.value;
    const preset = AI_PROVIDER_PRESETS.find((item) => item.id === provider);
    this._setConfig(PROVIDER_KEY, provider);
    this.setState({
      provider,
      baseUrl: preset ? preset.baseUrl : this.state.baseUrl,
      models: null,
      error: null,
    });
    if (preset) this._setConfig(BASE_URL_KEY, preset.baseUrl);
  };

  _onBaseUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const baseUrl = event.target.value;
    const preset = presetFor(baseUrl);
    this._setConfig(BASE_URL_KEY, baseUrl);
    this.setState({
      baseUrl,
      provider: preset ? preset.id : CUSTOM_PROVIDER,
      models: null,
      error: null,
    });
  };

  _onApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    void storeSecret('ai', event.target.value);
    this.setState({ apiKey: event.target.value, error: null });
  };

  _onModelChange = (modelId: string) => {
    this._setConfig(MODEL_KEY, modelId);
    this.setState({ model: modelId, testStatus: null, testError: null });
  };

  _config(): ChatConfig {
    return {
      provider: this.state.provider,
      baseUrl: this.state.baseUrl,
      apiKey: this.state.apiKey,
      model: this.state.model,
    };
  }

  _onTestProvider = () => {
    this._testProvider();
  };

  async _testProvider() {
    if (this.state.testing) return;
    this._testController?.abort();
    const controller = new AbortController();
    this._testController = controller;
    this.setState({ testing: true, testStatus: null, testError: null });

    try {
      const result = await testChatProvider(this._config(), controller.signal);
      if (controller.signal.aborted) return;
      this.setState({
        testing: false,
        testStatus: localized(
          'The model replied “%@” in %@ ms.',
          result.reply.slice(0, 40),
          String(result.elapsedMs)
        ),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setState({
        testing: false,
        testError:
          error instanceof AIProviderError
            ? error.message
            : localized('Something went wrong while testing the provider.'),
      });
    }
  }

  _onFetchModels = () => {
    this._fetchModels();
  };

  async _fetchModels() {
    if (this.state.loading) return;
    this._fetchController?.abort();
    const controller = new AbortController();
    this._fetchController = controller;
    this.setState({ loading: true, error: null });

    try {
      const models = await fetchProviderModels({
        baseUrl: this.state.baseUrl,
        apiKey: this.state.apiKey,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      this.setState({ models, loading: false });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message =
        error instanceof AIProviderError
          ? error.message
          : localized('Something went wrong while fetching the model list.');
      this.setState({ loading: false, error: message });
    }
  }

  _visibleModels(): AIModelInfo[] {
    const models = this.state.models || [];
    if (this.state.showAllModels) return models;
    const chatModels = models.filter((model) => model.chatCapable);
    return chatModels.length > 0 ? chatModels : models;
  }

  _renderProviderSection() {
    const preset = AI_PROVIDER_PRESETS.find((item) => item.id === this.state.provider);
    return (
      <section>
        <h6>{localized('AI provider')}</h6>
        <p>
          {localized(
            'Nuncio talks to any OpenAI-compatible AI service. Pick a preset or enter another base URL.'
          )}
        </p>

        <div className="item ai-field">
          <label htmlFor="ai-provider">{localized('Provider')}</label>
          <select id="ai-provider" value={this.state.provider} onChange={this._onProviderChange}>
            {AI_PROVIDER_PRESETS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
            <option value={CUSTOM_PROVIDER}>{localized('Custom (OpenAI-compatible)')}</option>
          </select>
        </div>

        <div className="item ai-field">
          <label htmlFor="ai-base-url">{localized('Base URL')}</label>
          <input
            id="ai-base-url"
            type="text"
            spellCheck={false}
            value={this.state.baseUrl}
            placeholder="https://api.deepinfra.com/v1/openai"
            onChange={this._onBaseUrlChange}
          />
          <div className="ai-hint">
            {localized(
              'The API root, without /models or /chat/completions. Nuncio appends those itself.'
            )}
          </div>
        </div>

        <div className="item ai-field">
          <label htmlFor="ai-api-key">{localized('API key')}</label>
          <div className="ai-key-row">
            <input
              id="ai-api-key"
              type={this.state.revealKey ? 'text' : 'password'}
              spellCheck={false}
              autoComplete="off"
              value={this.state.apiKey}
              placeholder={localized('Paste the key from your provider dashboard')}
              onChange={this._onApiKeyChange}
            />
            <button
              type="button"
              className="btn btn-small"
              onClick={() => this.setState({ revealKey: !this.state.revealKey })}
            >
              {this.state.revealKey ? localized('Hide') : localized('Show')}
            </button>
          </div>
          <div className="ai-hint">
            {localized(
              'Stored in your local Nuncio settings file. It never leaves this machine except in requests to the provider.'
            )}
          </div>
          {preset && !preset.publishesPricing ? (
            <div className="ai-hint">
              {localized(
                '%@ does not publish per-token prices, so costs stay blank.',
                preset.label
              )}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  _renderModelSection() {
    const models = this.state.models;
    const chatCount = models ? models.filter((model) => model.chatCapable).length : 0;
    const visible = this._visibleModels();
    const selected = models?.find((model) => model.id === this.state.model);
    const pricing = selected ? describePricing(selected) : null;
    const context = selected ? formatContextLength(selected.contextLength) : null;

    return (
      <section>
        <h6>{localized('Model')}</h6>
        <div className="item ai-fetch-row">
          <button
            type="button"
            className="btn"
            disabled={this.state.loading || !normalizeBaseUrl(this.state.baseUrl)}
            onClick={this._onFetchModels}
          >
            {this.state.loading ? localized('Fetching models…') : localized('Fetch models')}
          </button>
          <span className="ai-fetch-status">
            {models
              ? localized(
                  '%@ models available, %@ of them chat models',
                  String(models.length),
                  String(chatCount)
                )
              : localized('Ask the provider which models this key can use.')}
          </span>
        </div>

        {this.state.error ? <div className="ai-error">{this.state.error}</div> : null}

        <div className="item ai-field">
          <label htmlFor="ai-model">{localized('Model')}</label>
          <ModelPicker
            models={visible}
            value={this.state.model}
            onChange={this._onModelChange}
            disabled={!models || visible.length === 0}
          />
          {models && models.length > chatCount ? (
            <label className="ai-toggle">
              <input
                type="checkbox"
                checked={this.state.showAllModels}
                onChange={(e) => this.setState({ showAllModels: e.target.checked })}
              />
              {localized(
                'Show models that are not chat models (%@ more)',
                String(models.length - chatCount)
              )}
            </label>
          ) : null}
          {models && this.state.model && !selected ? (
            <div className="ai-hint">
              {localized(
                'The saved model is not in the fetched list. Fetch again, or pick another model.'
              )}
            </div>
          ) : null}
        </div>

        {selected ? (
          <div className="ai-selected-model">
            <div className="ai-selected-model-head">
              <span className="ai-selected-model-name">{selected.name}</span>
              {pricing ? <span className="ai-model-price">{pricing}</span> : null}
            </div>
            {selected.description ? <p>{selected.description}</p> : null}
            <div className="ai-model-row-meta">
              {selected.capabilities.map((capability) => (
                <span key={capability} className="ai-model-chip">
                  {capability}
                </span>
              ))}
              {context ? <span className="ai-model-context">{context}</span> : null}
              {selected.maxOutputTokens ? (
                <span className="ai-model-context">
                  {localized('up to %@ output tokens', String(selected.maxOutputTokens))}
                </span>
              ) : null}
            </div>
            {!pricing ? (
              <div className="ai-hint">
                {localized('This provider does not publish a per-token price for this model.')}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="item ai-fetch-row">
          <button
            type="button"
            className="btn"
            disabled={
              this.state.testing || !this.state.baseUrl || !this.state.apiKey || !this.state.model
            }
            onClick={this._onTestProvider}
          >
            {this.state.testing ? localized('Testing…') : localized('Test provider')}
          </button>
          <span className="ai-fetch-status">
            {this.state.testStatus || this.state.testError
              ? this.state.testStatus || this.state.testError
              : localized('Sends one tiny prompt so you know the key and model work.')}
          </span>
        </div>
        {this.state.testError && this.state.testStatus ? (
          <div className="ai-error">{this.state.testError}</div>
        ) : null}
      </section>
    );
  }

  render() {
    return (
      <div className="preferences-ai">
        <div className="ai-chat-section">
          {this._renderProviderSection()}
          {this._renderModelSection()}
        </div>
        <PreferencesTTS config={this.props.config} />
        <PreferencesSTT config={this.props.config} />
        <PreferencesTranslation config={this.props.config} />
      </div>
    );
  }
}

export default PreferencesAI;
