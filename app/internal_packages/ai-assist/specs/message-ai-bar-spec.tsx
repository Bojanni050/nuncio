import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';

import MessageAIBar from '../lib/message-ai-bar';

// The spec runner replaces setTimeout/setInterval with a manual clock, so a real wait would
// hang. Drain the fetch/json/setState chain on the microtask queue instead.
async function settle() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
  advanceClock(1);
}

const CHAT = {
  'core.ai.provider': 'deepinfra',
  'core.ai.baseUrl': 'https://api.deepinfra.com/v1/openai',
  'core.ai.apiKey': 'sk-chat',
  'core.ai.model': 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
};

const TTS = {
  'core.tts.provider': 'mistral',
  'core.tts.baseUrl': 'https://api.mistral.ai/v1',
  'core.tts.apiKey': 'sk-tts',
  'core.tts.model': 'voxtral-mini-tts-2603',
  'core.tts.voice': '',
};

function message(overrides: any = {}) {
  return {
    subject: 'Budget review',
    body: '<p>Can you send the budget by Friday?</p>',
    plaintext: false,
    snippet: 'Can you send the budget by Friday?',
    fromContact: { name: 'Ada' },
    ...overrides,
  } as any;
}

function stubConfig(values: { [key: string]: string }) {
  spyOn(AppEnv.config, 'get').andCallFake((key: string) => values[key]);
}

describe('MessageAIBar', function () {
  const originalFetch = window.fetch;
  const originalAudio = (window as any).Audio;
  const originalCreateObjectURL = (URL as any).createObjectURL;

  beforeEach(() => {
    (URL as any).createObjectURL = () => 'blob:nuncio-test';
    (URL as any).revokeObjectURL = () => {};
    (window as any).Audio = class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play() {
        return Promise.resolve();
      }
      pause() {}
    };
  });

  afterEach(() => {
    cleanup();
    (window as any).fetch = originalFetch;
    (window as any).Audio = originalAudio;
    (URL as any).createObjectURL = originalCreateObjectURL;
  });

  it('renders nothing when no provider is configured', function () {
    stubConfig({});
    const { container } = render(<MessageAIBar message={message()} />);
    expect(container.querySelector('.ai-assist-bar')).toBe(null);
  });

  it('offers only Summarize when only a chat provider is configured', function () {
    stubConfig(CHAT);
    const { container } = render(<MessageAIBar message={message()} />);

    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Summarize']);
  });

  it('offers only Read aloud when only a speech provider is configured', function () {
    stubConfig(TTS);
    const { container } = render(<MessageAIBar message={message()} />);

    const labels = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['Read aloud']);
  });

  it('summarizes the message with the configured provider', async function () {
    stubConfig(CHAT);
    const calls: any[] = [];
    (window as any).fetch = (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ choices: [{ message: { content: 'Ada needs the budget.' } }] }),
      });
    };

    const { getByText, container } = render(<MessageAIBar message={message()} />);
    fireEvent.click(getByText('Summarize'));
    await settle();

    expect(container.querySelector('.ai-assist-summary').textContent).toBe('Ada needs the budget.');
    expect(calls[0].url).toBe('https://api.deepinfra.com/v1/openai/chat/completions');
    expect(JSON.parse(String(calls[0].init.body)).messages[1].content).toContain(
      'Can you send the budget by Friday?'
    );
  });

  it('hides the summary again on a second click', async function () {
    stubConfig(CHAT);
    (window as any).fetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: { content: 'Short.' } }] }),
      });

    const { getByText, container } = render(<MessageAIBar message={message()} />);
    fireEvent.click(getByText('Summarize'));
    await settle();
    fireEvent.click(getByText('Hide summary'));

    expect(container.querySelector('.ai-assist-summary')).toBe(null);
  });

  it('shows the provider error instead of a summary', async function () {
    stubConfig(CHAT);
    (window as any).fetch = () =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });

    const { getByText, container } = render(<MessageAIBar message={message()} />);
    fireEvent.click(getByText('Summarize'));
    await settle();

    expect(container.querySelector('.ai-assist-error').textContent).toContain(
      'rejected the API key'
    );
  });

  it('sends the message text to the speech provider', async function () {
    stubConfig(TTS);
    const calls: any[] = [];
    (window as any).fetch = (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ audio_data: btoa('mp3') }),
      });
    };

    const { getByText } = render(<MessageAIBar message={message()} />);
    fireEvent.click(getByText('Read aloud'));
    await settle();

    expect(calls[0].url).toBe('https://api.mistral.ai/v1/audio/speech');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.input).toContain('Can you send the budget by Friday?');
    expect(body.voice_id).toBeUndefined();
    expect(getByText('Stop')).toBeTruthy();
  });
});
