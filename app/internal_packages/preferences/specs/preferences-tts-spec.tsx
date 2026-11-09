import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';

import PreferencesTTS from '../lib/tabs/preferences-tts';

async function settle() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
  advanceClock(1);
}

function buildConfig(initial: { [key: string]: string } = {}) {
  const values: { [key: string]: string } = { ...initial };
  return {
    values,
    get: (key: string) => values[key],
    set: jasmine.createSpy('config.set').andCallFake((key: string, value: string) => {
      values[key] = value;
    }),
    toggle: jasmine.createSpy('config.toggle'),
  };
}

const TTS_MODELS = {
  data: [
    { id: 'voxtral-mini-tts-2603', name: 'Voxtral Mini TTS', capabilities: {} },
    { id: 'mistral-large-latest', name: 'Mistral Large', capabilities: { completion_chat: true } },
  ],
};

const VOICES = { data: [{ id: 'voice_478', name: 'Sarah' }] };

/** The tab fetches models and voices on mount whenever a key is saved. */
function stubAPI(calls: any[] = []) {
  (window as any).fetch = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () =>
        Promise.resolve(
          url.includes('/audio/voices')
            ? VOICES
            : url.endsWith('/audio/speech')
              ? { audio_data: btoa('mp3') }
              : TTS_MODELS
        ),
      text: () => Promise.resolve('{}'),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
  };
  return calls;
}

const fetchModelsButton = (container: HTMLElement) =>
  container.querySelector('.ai-fetch-row button') as HTMLButtonElement;

const fetchVoicesButton = (container: HTMLElement) =>
  container.querySelector('.ai-key-row button') as HTMLButtonElement;

describe('PreferencesTTS', function () {
  const originalFetch = window.fetch;
  const originalAudio = (window as any).Audio;

  beforeEach(() => {
    (window as any).Audio = class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play() {
        return Promise.resolve();
      }
      pause() {}
    };
    (URL as any).createObjectURL = () => 'blob:nuncio-test';
    (URL as any).revokeObjectURL = () => {};
  });

  afterEach(() => {
    cleanup();
    (window as any).fetch = originalFetch;
    (window as any).Audio = originalAudio;
  });

  it('defaults to Mistral and shows it as the only provider', function () {
    const config = buildConfig();
    const { container, getByLabelText } = render(<PreferencesTTS config={config as any} />);

    const provider = getByLabelText('Provider') as HTMLSelectElement;
    expect(provider.disabled).toBe(true);
    expect(provider.value).toBe('mistral');
    expect((getByLabelText('Base URL') as HTMLInputElement).value).toBe(
      'https://api.mistral.ai/v1'
    );
    expect(container.textContent).toContain('Mistral is currently the only speech provider.');
  });

  it('offers only speech models after fetching', async function () {
    const config = buildConfig({ 'core.tts.apiKey': 'sk-tts' });
    const calls = stubAPI();

    const { container } = render(<PreferencesTTS config={config as any} />);
    await settle();
    fireEvent.click(fetchModelsButton(container));
    await settle();

    expect(calls.some((call) => call.url === 'https://api.mistral.ai/v1/models')).toBe(true);
    expect(container.textContent).toContain('1 speech models available');

    fireEvent.click(container.querySelector('.ai-model-picker-button') as Element);
    expect(container.textContent).toContain('Voxtral Mini TTS');
    expect(container.textContent).not.toContain('Mistral Large');
  });

  it('persists the chosen voice', async function () {
    const config = buildConfig({ 'core.tts.apiKey': 'sk-tts' });
    stubAPI();

    const { container, getByLabelText } = render(<PreferencesTTS config={config as any} />);
    await settle();

    const voices = getByLabelText('Voice') as HTMLSelectElement;
    expect(voices.options.length).toBe(2);
    expect(voices.options[1].textContent).toBe('Sarah (voice_478)');

    fireEvent.change(voices, { target: { value: 'voice_478' } });
    expect(config.values['core.tts.voice']).toBe('voice_478');
  });

  it('tests the voice and reports that it played', async function () {
    const config = buildConfig({
      'core.tts.apiKey': 'sk-tts',
      'core.tts.model': 'voxtral-mini-tts-2603',
    });
    const calls = stubAPI();

    const { container } = render(<PreferencesTTS config={config as any} />);
    await settle();
    fireEvent.click(container.querySelectorAll('.ai-fetch-row button')[1] as Element);
    await settle();

    const speech = calls.find((call) => call.url.endsWith('/audio/speech'));
    expect(speech.url).toBe('https://api.mistral.ai/v1/audio/speech');
    expect(JSON.parse(String(speech.init.body)).input).toContain('This is Nuncio.');
    expect(container.textContent).toContain('Playing a test sentence through');
  });

  it('keeps the test button disabled until the key and model are set', function () {
    const config = buildConfig();
    const { container } = render(<PreferencesTTS config={config as any} />);

    const button = container.querySelectorAll('.ai-fetch-row button')[1] as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
