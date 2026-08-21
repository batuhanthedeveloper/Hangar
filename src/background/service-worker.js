/**
 * Opens the side panel and relays page-navigation events to it.
 * No data passes through here — the panel talks to the content script directly.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OPEN_PANEL') {
    const tabId = sender.tab?.id;

    if (tabId == null) {
      sendResponse({ ok: false, error: 'No tab context.' });

      return false;
    }

    // Requires the user gesture that produced the content-script click to
    // still be in effect; if Chrome rejects it the panel is one toolbar
    // click away, which the error message says.
    chrome.sidePanel
      .open({ tabId })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === 'NAVIGATED') {
    // Relayed for any open panel; failure just means no panel is listening.
    chrome.runtime
      .sendMessage({ type: 'PAGE_NAVIGATED', context: message.context })
      .catch(() => {});

    return false;
  }

  return false;
});
