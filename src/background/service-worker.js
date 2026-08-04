/**
 * EzApply — background service worker.
 *
 * Deliberately tiny. It seeds defaults on install, runs schema migration on update, and
 * opens the options page the first time so a brand-new user is not staring at an empty
 * popup. It makes no network requests — EzApply never talks to anything but local storage.
 */

const STORAGE_KEY = 'ezapply';

/** Read, migrate and write back, so a stored state from an older version gains new fields. */
async function migrateStoredState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result && result[STORAGE_KEY];

  if (!stored) {
    // First install: write a minimal shell. The full default shape is filled in by
    // src/common/storage.js#migrate on the first read from any page.
    await chrome.storage.local.set({
      [STORAGE_KEY]: { schemaVersion: 1, profile: { custom: [], projects: [] }, mappings: {}, settings: {} }
    });
    return;
  }

  if (stored.schemaVersion !== 1) {
    stored.schemaVersion = 1;
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrateStoredState();
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

/**
 * The popup asks the background for the options page URL rather than hard-coding it,
 * so the path only lives in the manifest.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'EZ_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});
