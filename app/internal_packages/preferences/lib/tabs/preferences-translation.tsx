import React from 'react';
import { localized } from 'mailspring-exports';
import { AIProviderError } from '../../../../src/ai/provider-catalog';
import {
  TRANSLATION_PROVIDERS,
  TRANSLATION_CONFIG_KEYS,
  TranslationConfig,
  TranslationProviderId,
  readChatConfig,
  isChatConfigured,
} from '../../../../src/ai/config';
import { testTranslation } from '../../../../src/ai/translation';
import { readSecret, storeSecret } from '../../../../src/ai/secrets';
import { ConfigLike } from '../types';

type PreferencesTranslationState = {
  provider: TranslationProviderId;
  baseUrl: string;
  apiKey: string;
  chatConfigured: boolean;
  testing: boolean;
  error: string | null;
  status: string | null;
  revealKey: boolean;
};

/**
 * Translation settings. Translation is a separate provider row for the same reason TTS and STT
 * have one: the chat model may be slow or priced per character, while DeepL is cheap and
 * self-hosted LibreTranslate needs no key at all. Every option is BYOK and runs client side;
 * there is no Nuncio server in the middle.
 */
class PreferencesTranslation extends React.Component<
  { config: ConfigLike },
  PreferencesTranslationState
> {
  static displayName = 'PreferencesTranslation';

  private _testController: AbortController | null = null;

  constructor(props: { config: ConfigLike }) {
    super(props);
    this.state = {
      ...readTranslationConfigFrom(props.config),
      chatConfigured: isChatConfigured(readChatConfig()),
      testing: false,
      error: null,
      status: null,
      revealKey: false,
    };
  }

  componentWillUnmount() {
    this._testController?.abort();
  }

  _config(): TranslationConfig {
    return {
      provider: this.state.provider,
      baseUrl: this.state.baseUrl,
      apiKey: this.state.apiKey,
    };
  }

  _setConfig(key: string, value: string) {
    this.props.config.set(key, value);
  }

  _onProviderChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = event.target.value as TranslationProviderId;
    this._setConfig(TRANSLATION_CONFIG_KEYS.provider, provider);
    this.setState({ provider, error: null, status: null });
  };

  _onBaseUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this._setConfig(TRANSLATION_CONFIG_KEYS.baseUrl, event.target.value);
    this.setState({ baseUrl: event.target.value, error: null, status: null });
  };

  _onApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    void storeSecret('translation', event.target.value);
    this.setState({ apiKey: event.target.value, error: null, status: null });
  };

  async _test() {
    if (this.state.testing) return;
    this._testController?.abort();
    const controller = new AbortController();
    this._testController = controller;
    this.setState({ testing: true, error: null, status: null });

    try {
      const result = await testTranslation(this._config(), controller.signal);
      if (controller.signal.aborted) return;
      this.setState({
        testing: false,
        status: localized('Reply to the test sentence: “%@”.', result),
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setState({
        testing: false,
        error:
          error instanceof AIProviderError
            ? error.message
            : localized('Something went wrong while testing translation.'),
      });
    }
  }

  render() {
    const isDeepL = this.state.provider === 'deepl';
    const isLibre = this.state.provider === 'libre';
    const isChat = this.state.provider === 'chat';
    const canTest =
      (isDeepL && Boolean(this.state.apiKey.trim())) ||
      (isLibre && Boolean(this.state.baseUrl.trim())) ||
      (isChat && this.state.chatConfigured);

    return (
      <section>
        <h6>{localized('Translation')}</h6>
        <p>
          {localized(
            'Used by Translate in the composer and on messages. Everything runs on your own provider; Nuncio has no translation server.'
          )}
        </p>

        <div className="item ai-field">
          <label htmlFor="translation-provider">{localized('Provider')}</label>
          <select
            id="translation-provider"
            value={this.state.provider}
            onChange={this._onProviderChange}
          >
            {TRANSLATION_PROVIDERS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          {isChat ? (
            <div className="ai-hint">
              {this.state.chatConfigured
                ? localized('Uses the AI provider and model configured at the top of this screen.')
                : localized(
                    'No AI provider is configured yet. Set one at the top of this screen, or pick DeepL or LibreTranslate.'
                  )}
            </div>
          ) : null}
        </div>

        {isLibre ? (
          <div className="item ai-field">
            <label htmlFor="translation-base-url">{localized('Server URL')}</label>
            <input
              id="translation-base-url"
              type="text"
              spellCheck={false}
              value={this.state.baseUrl}
              placeholder="https://libretranslate.example.com"
              onChange={this._onBaseUrlChange}
            />
            <div className="ai-hint">
              {localized('The root of your LibreTranslate instance, without /translate.')}
            </div>
          </div>
        ) : null}

        {isDeepL || isLibre ? (
          <div className="item ai-field">
            <label htmlFor="translation-api-key">
              {isDeepL
                ? localized('DeepL API key')
                : localized('LibreTranslate API key (optional)')}
            </label>
            <div className="ai-key-row">
              <input
                id="translation-api-key"
                type={this.state.revealKey ? 'text' : 'password'}
                spellCheck={false}
                autoComplete="off"
                value={this.state.apiKey}
                placeholder={
                  isDeepL
                    ? localized('Paste your DeepL key')
                    : localized('Empty works for open instances')
                }
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
            {isDeepL ? (
              <div className="ai-hint">
                {localized(
                  'A free key ending in “:fx” automatically uses the free DeepL endpoint.'
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="item ai-fetch-row">
          <button
            type="button"
            className="btn"
            disabled={this.state.testing || !canTest}
            onClick={() => this._test()}
          >
            {this.state.testing ? localized('Testing…') : localized('Test translation')}
          </button>
          <span className="ai-fetch-status">
            {this.state.status ||
              localized('Translates one test sentence into Dutch, the way messages will be.')}
          </span>
        </div>

        {this.state.error ? <div className="ai-error">{this.state.error}</div> : null}
      </section>
    );
  }
}

function readTranslationConfigFrom(config: ConfigLike): {
  provider: TranslationProviderId;
  baseUrl: string;
  apiKey: string;
} {
  const read = (key: string) => {
    const value = config.get(key);
    return typeof value === 'string' ? value : '';
  };
  const provider = read(TRANSLATION_CONFIG_KEYS.provider);
  return {
    provider: (TRANSLATION_PROVIDERS.some((item) => item.id === provider)
      ? provider
      : 'chat') as TranslationProviderId,
    baseUrl: read(TRANSLATION_CONFIG_KEYS.baseUrl),
    apiKey: readSecret('translation', config),
  };
}

export default PreferencesTranslation;
