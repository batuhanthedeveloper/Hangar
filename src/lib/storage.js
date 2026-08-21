import { DEFAULT_SETTINGS } from './config.js';

const SETTINGS_KEY = 'settings';
const EXPORTED_KEY = 'exportedIds';

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);

  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };

  await chrome.storage.local.set({ [SETTINGS_KEY]: next });

  return next;
}

/**
 * Feedback ids that have already been exported, keyed by app so switching
 * between apps does not blur the "new since last export" count.
 *
 * @param {string} appId
 * @returns {Promise<Set<string>>}
 */
export async function getExportedIds(appId) {
  const stored = await chrome.storage.local.get(EXPORTED_KEY);
  const byApp = stored[EXPORTED_KEY] || {};

  return new Set(byApp[appId] || []);
}

export async function markExported(appId, ids) {
  const stored = await chrome.storage.local.get(EXPORTED_KEY);
  const byApp = stored[EXPORTED_KEY] || {};
  const merged = new Set([...(byApp[appId] || []), ...ids]);

  byApp[appId] = [...merged];

  await chrome.storage.local.set({ [EXPORTED_KEY]: byApp });
}

export async function clearExported(appId) {
  const stored = await chrome.storage.local.get(EXPORTED_KEY);
  const byApp = stored[EXPORTED_KEY] || {};

  delete byApp[appId];

  await chrome.storage.local.set({ [EXPORTED_KEY]: byApp });
}
