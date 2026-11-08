/**
 * Encrypted storage for the API keys of the AI features.
 *
 * The provider keys for chat, read-aloud and dictation used to sit in plain text inside
 * config.json next to settings like window size. This module moves them into the same
 * desktop keyring the account passwords use (`secureStorage` in key-manager), under its own
 * config blob so a keyring problem with passwords can never wipe an AI key and the other way
 * around.
 *
 * Reads stay synchronous on purpose: every feature builds its config the moment the user
 * acts (a click, a hotkey press), and making all of these call sites await a decryption
 * would restructure them for no benefit. The cache is filled once, early in startup, and
 * updated by every write. Until it loads, reads fall back to the plain config slot earlier
 * versions wrote, so no one is briefly told "not configured" while the app is still starting.
 */

import { secureStorage } from '../key-manager';

const SECRET_BLOB_KEY = 'credentials-ai';

export type SecretScope = 'ai' | 'tts' | 'stt' | 'translation';

/** Where each key lived before it moved into the encrypted blob. */
export const SECRET_LEGACY_KEYS: { [scope in SecretScope]: string } = {
  ai: 'core.ai.apiKey',
  tts: 'core.tts.apiKey',
  stt: 'core.stt.apiKey',
  translation: 'core.trans.apiKey',
};

const CACHE: { [scope in SecretScope]?: string } = {};

const readLegacy = (scope: SecretScope): string => {
  const value = AppEnv.config.get(SECRET_LEGACY_KEYS[scope]);
  return typeof value === 'string' ? value : '';
};

const readSecretFrom = (scope: SecretScope, reader?: { get: (key: string) => unknown }): string => {
  const value = (reader || AppEnv.config).get(SECRET_LEGACY_KEYS[scope]);
  return typeof value === 'string' ? value : '';
};

/**
 * Reads one key: the cached value if it has loaded yet, otherwise the plain-text slot the
 * first versions wrote. `reader` lets callers that keep a pure config object (the preference
 * tabs receive theirs as a prop) resolve the plain-text fallback against that object instead
 * of the global config; when it is omitted, the app config is used.
 */
export function readSecret(scope: SecretScope, reader?: { get: (key: string) => unknown }): string {
  if (scope in CACHE) return CACHE[scope] as string;
  return readSecretFrom(scope, reader);
}

type SecretMap = { [scope in SecretScope]?: string };

/**
 * Decodes the blob from config.json. A blob that cannot be decrypted (locked keyring, a
 * secret the desktop provider lost) must not translate into wiping anything: the caller
 * keeps its plain fallback and the next write simply replaces the blob.
 */
async function readStoredMap(): Promise<SecretMap> {
  const value = AppEnv.config.get(SECRET_BLOB_KEY);
  if (typeof value !== 'string' || !value) return {};
  try {
    const decrypted = await secureStorage.decrypt(Buffer.from(value, 'base64'));
    const parsed = JSON.parse(decrypted.result);
    return typeof parsed === 'object' && parsed !== null ? (parsed as SecretMap) : {};
  } catch (err) {
    console.warn('Nuncio could not read the encrypted AI keys from storage.', err);
    return {};
  }
}

/** Writes every non-empty scope as one encrypted blob; an empty map removes the blob entirely. */
async function writeStoredMap(next: SecretMap) {
  const entries: { [scope: string]: string } = {};
  (Object.keys(next) as SecretScope[]).forEach((scope) => {
    const value = next[scope];
    if (typeof value === 'string' && value) entries[scope] = value;
  });
  if (!(await secureStorage.isAvailable())) {
    throw new Error('Secure storage is not available on this system.');
  }
  if (Object.keys(entries).length === 0) {
    AppEnv.config.unset(SECRET_BLOB_KEY);
    return;
  }
  const encrypted = await secureStorage.encrypt(JSON.stringify(entries));
  AppEnv.config.set(SECRET_BLOB_KEY, encrypted.toString('base64'));
}

/**
 * Stores (or clears) one key under the encrypted blob. Every failure keeps the earlier
 * behaviour — the plain config slot — with a warning instead of losing the key: an AI key
 * in plain text is an inconvenience, a key nobody can explain the absence of is a bug.
 */
export async function storeSecret(scope: SecretScope, plaintext: string) {
  const intended = typeof plaintext === 'string' ? plaintext : '';
  CACHE[scope] = intended;
  try {
    // Build the map from the cache rather than re-reading the blob, so two writes in quick
    // succession (typing fast) cannot see each other's partial state and drop a scope.
    const next: SecretMap = {};
    (Object.keys(SECRET_LEGACY_KEYS) as SecretScope[]).forEach((other) => {
      next[other] = readSecret(other);
    });
    next[scope] = intended;
    await writeStoredMap(next);
    if (readLegacy(scope)) AppEnv.config.unset(SECRET_LEGACY_KEYS[scope]);
  } catch (err) {
    console.warn('Nuncio could not store the AI key securely; keeping it in local settings.', err);
    if (intended) {
      AppEnv.config.set(SECRET_LEGACY_KEYS[scope], intended);
    } else {
      AppEnv.config.unset(SECRET_LEGACY_KEYS[scope]);
    }
  }
}

/**
 * Fills the cache at startup and moves any plain keys from earlier versions into the
 * encrypted blob. The plaintext slot is only unset after the encrypted write succeeded.
 */
export async function loadSecrets() {
  const stored = await readStoredMap();
  for (const scope of Object.keys(SECRET_LEGACY_KEYS) as SecretScope[]) {
    const fromBlob = typeof stored[scope] === 'string' ? (stored[scope] as string) : null;
    if (fromBlob !== null) {
      CACHE[scope] = fromBlob;
      continue;
    }
    const legacy = readLegacy(scope);
    if (legacy) await storeSecret(scope, legacy);
  }
}

/** Clears the in-memory values. Only specs use this; real startup runs it never. */
export function resetSecretsForTests() {
  (Object.keys(CACHE) as SecretScope[]).forEach((scope) => delete CACHE[scope]);
}
