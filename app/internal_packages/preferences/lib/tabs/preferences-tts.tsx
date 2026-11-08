import React from 'react';
import { localized } from 'mailspring-exports';
import {
  fetchProviderModels,
  AIProviderError,
  AIModelInfo,
} from '../../../../src/ai/provider-catalog';
import {
  TTS_PROVIDERS,
  TTS_CONFIG_KEYS,
  readTTSConfig,
  TTSConfig,
} from '../../../../src/ai/config';
import { fetchTTSVoices, synthesizeSpeech, TTSVoice } from '../../../../src/ai/speech';
import { readSecret, storeSecret } from '../../../../src/ai/secrets';
import { ConfigLike } from '../types';
import ModelPicker from './model-picker';

const TEST_SENTENCE =
  'This is Nuncio. New messages can be read aloud like this, using the provider you configured here.';

type PreferencesTTSState = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  models: AIModelInfo[] | null;
  voices: TTSVoice[] | null;
  loadingModels: boolean;
  loadingVoices: boolean;
  testing: boolean;
  error: string | null;
  status: string | null;
  revealKey: boolean;
};

/**
 * Read-aloud settings. Text-to-speech is a separate provider from chat on purpose: the chat
 * provider may be a service that cannot speak, and its model ids would only confuse this list.
 *
 * Mistral is the only provider for now, and it does not publish which of its models speak, so
 * the model list here is filtered by name. When nothing matches, the full list is shown rather
 * than an empty picker.
 */
class PreferencesTTS extends React.Component<{ config: ConfigLike }, PreferencesTTSState> {
  static displayName = 'PreferencesTTS';

  private _modelsController: AbortController | null = null;
  private _voicesController: AbortController | null = null;
  private _audio: HTMLAudioElement | null = null;
  private _audioUrl: string | null = null;

  constructor(props: { config: ConfigLike }) {
    super(props);
    const saved = readTTSConfigFrom(props.config);
    this.state = {
      ...saved,
      models: null,
      voices: null,
      loadingModels: false,
      loadingVoices: false,
      testing: false,
      error: null,
      status: null,
      revealKey: false,
    };
  }

  componentDidMount() {
    if (this.state.apiKey) {
      this._fetchModels();
      this._fetchVoices();
    }
  }

  componentWillUnmount() {
    this._modelsController?.abort();
    this._voicesController?.abort();
    this._stopAudio();
  }

  _stopAudio() {
    if (this._audio) {
      this._audio.pause();
      this._audio = null;
    }
    if (this._audioUrl) {
      URL.revokeObjectURL(this._audioUrl);
      this._audioUrl = null;
    }
  }

  _config(): TTSConfig {
    return {
      provider: this.state.provider,
      baseUrl: this.state.baseUrl,
      apiKey: this.state.apiKey,
      model: this.state.model,
      voice: this.state.voice,
    };
  }

  _setConfig(key: string, value: string) {
    this.props.config.set(key, value);
  }

  _onApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    void storeSecret('tts', event.target.value);
    this.setState({ apiKey: event.target.value, error: null, status: null });
  };

  _onBaseUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this._setConfig(TTS_CONFIG_KEYS.baseUrl, event.target.value);
    this.setState({ baseUrl: event.target.value, models: null, error: null, status: null });
  };

  _onModelChange = (model: string) => {
    this._setConfig(TTS_CONFIG_KEYS.model, model);
    this.setState({ model, error: null, status: null });
  };

  _onVoiceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this._setConfig(TTS_CONFIG_KEYS.voice, event.target.value);
    this.setState({ voice: event.target.value, status: null });
  };

  _visibleModels(): AIModelInfo[] {
    const models = this.state.models || [];
    const speech = models.filter((model) => /tts|voxtral|audio|speech/i.test(model.id));
    return speech.length > 0 ? speech : models;
  }

  async _fetchModels() {
    if (this.state.loadingModels) return;
    this._modelsController?.abort();
    const controller = new AbortController();
    this._modelsController = controller;
    this.setState({ loadingModels: true, error: null });

    try {
      const models = await fetchProviderModels({
        baseUrl: this.state.baseUrl,
        apiKey: this.state.apiKey,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      this.setState({ models, loadingModels: false });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setState({
        loadingModels: false,
        error:
          error instanceof AIProviderError
            ? error.message
            : localized('Something went wrong while fetching the speech models.'),
      });
    }
  }

  async _fetchVoices() {
    if (this.state.loadingVoices) return;
    this._voicesController?.abort();
    const controller = new AbortController();
    this._voicesController = controller;
    this.setState({ loadingVoices: true });

    try {
      const voices = await fetchTTSVoices({
        baseUrl: this.state.baseUrl,
        apiKey: this.state.apiKey,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      this.setState({ voices, loadingVoices: false });
    } catch (error) {
      if (controller.signal.aborted) return;
      // A missing voice list is not fatal: Mistral falls back to a default voice.
      this.setState({
        loadingVoices: false,
        status: error instanceof AIProviderError ? error.message : null,
      });
    }
  }

  _onTest = () => {
    this._test();
  };

  async _test() {
    if (this.state.testing) return;
    this._stopAudio();
    this.setState({ testing: true, error: null, status: null });

    try {
      const clip = await synthesizeSpeech({ config: this._config(), text: TEST_SENTENCE });
      this._audioUrl = URL.createObjectURL(clip.blob);
      this._audio = new Audio(this._audioUrl);
      this._audio.onended = () => this._stopAudio();
      this._audio.onerror = () =>
        this.setState({ status: null, error: localized('The browser could not play the audio.') });
      await this._audio.play();
      this.setState({
        testing: false,
        status: localized('Playing a test sentence through %@.', this.state.model),
      });
    } catch (error) {
      this.setState({
        testing: false,
        error:
          error instanceof AIProviderError
            ? error.message
            : localized('Something went wrong while generating speech.'),
      });
    }
  }

  render() {
    const models = this.state.models;
    const visible = this._visibleModels();
    const provider = TTS_PROVIDERS.find((item) => item.id === this.state.provider);
    const canTest = Boolean(this.state.baseUrl && this.state.apiKey && this.state.model);

    return (
      <section>
        <h6>{localized('Read aloud (text to speech)')}</h6>
        <p>
          {localized(
            'Used by “Read aloud” on a message. This is a separate provider from the chat provider above.'
          )}
        </p>

        <div className="item ai-field">
          <label htmlFor="tts-provider">{localized('Provider')}</label>
          <select id="tts-provider" value={this.state.provider} disabled>
            {TTS_PROVIDERS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <div className="ai-hint">
            {localized('Mistral is currently the only speech provider.')}
          </div>
        </div>

        <div className="item ai-field">
          <label htmlFor="tts-base-url">{localized('Base URL')}</label>
          <input
            id="tts-base-url"
            type="text"
            spellCheck={false}
            value={this.state.baseUrl}
            placeholder={provider?.baseUrl}
            onChange={this._onBaseUrlChange}
          />
        </div>

        <div className="item ai-field">
          <label htmlFor="tts-api-key">{localized('Mistral API key')}</label>
          <div className="ai-key-row">
            <input
              id="tts-api-key"
              type={this.state.revealKey ? 'text' : 'password'}
              spellCheck={false}
              autoComplete="off"
              value={this.state.apiKey}
              placeholder={localized('ms-…')}
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
              'Stored in your local Nuncio settings file. The chat key above is not reused here.'
            )}
          </div>
        </div>

        <div className="item ai-fetch-row">
          <button
            type="button"
            className="btn"
            disabled={this.state.loadingModels || !this.state.baseUrl}
            onClick={() => this._fetchModels()}
          >
            {this.state.loadingModels ? localized('Fetching models…') : localized('Fetch models')}
          </button>
          <span className="ai-fetch-status">
            {models
              ? localized('%@ speech models available', String(visible.length))
              : localized('Ask the provider which speech models this key can use.')}
          </span>
        </div>

        <div className="item ai-field">
          <label htmlFor="tts-model">{localized('Speech model')}</label>
          <ModelPicker
            models={visible}
            value={this.state.model}
            onChange={this._onModelChange}
            disabled={!models || visible.length === 0}
          />
          <div className="ai-hint">
            {localized('Look for a model whose name contains “tts”, for example a Voxtral model.')}
          </div>
        </div>

        <div className="item ai-field">
          <label htmlFor="tts-voice">{localized('Voice')}</label>
          <div className="ai-key-row">
            <select id="tts-voice" value={this.state.voice} onChange={this._onVoiceChange}>
              <option value="">{localized('Provider default')}</option>
              {(this.state.voices || []).map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name ? `${voice.name} (${voice.id})` : voice.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-small"
              disabled={this.state.loadingVoices || !this.state.apiKey}
              onClick={() => this._fetchVoices()}
            >
              {this.state.loadingVoices ? localized('Fetching…') : localized('Fetch voices')}
            </button>
          </div>
        </div>

        <div className="item ai-fetch-row">
          <button
            type="button"
            className="btn"
            disabled={this.state.testing || !canTest}
            onClick={this._onTest}
          >
            {this.state.testing ? localized('Generating…') : localized('Test voice')}
          </button>
          <span className="ai-fetch-status">
            {this.state.status ||
              localized('Plays one sentence so you can hear the selected voice.')}
          </span>
        </div>

        {this.state.error ? <div className="ai-error">{this.state.error}</div> : null}
      </section>
    );
  }
}

function readTTSConfigFrom(config: ConfigLike): {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
} {
  const read = (key: string) => {
    const value = config.get(key);
    return typeof value === 'string' ? value : '';
  };
  return {
    provider: read(TTS_CONFIG_KEYS.provider) || TTS_PROVIDERS[0].id,
    baseUrl: read(TTS_CONFIG_KEYS.baseUrl) || TTS_PROVIDERS[0].baseUrl,
    apiKey: readSecret('tts', config),
    model: read(TTS_CONFIG_KEYS.model),
    voice: read(TTS_CONFIG_KEYS.voice),
  };
}

export default PreferencesTTS;
