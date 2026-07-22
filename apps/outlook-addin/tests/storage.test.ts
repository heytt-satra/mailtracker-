import { beforeEach, describe, expect, it } from 'vitest';
import { getSettings, setSettings } from '../src/storage';

// jsdom/happy-dom aren't configured for this workspace (vitest.config.ts
// uses the 'node' environment, matching the extension's own choice) — a
// minimal in-memory localStorage stand-in is enough to exercise the pure
// get/set logic without needing a real browser environment.
function installFakeLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('storage (ADR-61, Outlook add-in)', () => {
  beforeEach(() => {
    installFakeLocalStorage();
  });

  it('getSettings returns defaults when nothing is stored', () => {
    expect(getSettings()).toEqual({ apiKey: null, accountEmail: null, trackingEnabledByDefault: true });
  });

  it('setSettings merges into existing settings rather than replacing them', () => {
    setSettings({ apiKey: 'k1' });
    expect(getSettings().trackingEnabledByDefault).toBe(true); // untouched default preserved
    expect(getSettings().apiKey).toBe('k1');
  });

  it('persists across separate getSettings calls (round-trips through localStorage, not just an in-memory variable)', () => {
    setSettings({ apiKey: 'k2', accountEmail: 'a@b.com', trackingEnabledByDefault: false });
    const reloaded = getSettings();
    expect(reloaded).toEqual({ apiKey: 'k2', accountEmail: 'a@b.com', trackingEnabledByDefault: false });
  });

  it('falls back to defaults if the stored value is corrupted JSON', () => {
    localStorage.setItem('mailtrack:settings', 'not valid json{{{');
    expect(getSettings()).toEqual({ apiKey: null, accountEmail: null, trackingEnabledByDefault: true });
  });
});
