/**
 * Content script bridge.
 *
 * Its only real job is to issue requests to App Store Connect's internal iris
 * API from a same-origin context, so the session cookie rides along without
 * the extension ever touching credentials. Extension pages cannot do this
 * reliably: their requests are cross-site, so SameSite cookies are withheld.
 *
 * Declared content scripts cannot be ES modules, so this file stands alone.
 */

(() => {
  'use strict';

  const ALLOWED_PREFIX = 'https://appstoreconnect.apple.com/iris/';

  let launcher = null;

  function currentContext() {
    const url = location.href;

    return {
      url,
      appId: url.match(/\/apps\/(\d+)/)?.[1] || null,
      teamId: url.match(/\/teams\/([0-9a-f-]{36})/i)?.[1] || null,
      onFeedbackPage: /\/testflight\/(screenshots|crashes)/.test(url),
      kind: /\/testflight\/crashes/.test(url) ? 'crash' : 'screenshot',
    };
  }

  /**
   * App Store Connect answers rejected requests with a JSON:API `errors`
   * array explaining exactly what it disliked. Surfacing that beats guessing
   * from the status code alone, which is undocumented territory.
   */
  async function describeFailure(response) {
    let detail = '';

    try {
      const body = await response.json();

      detail = (body?.errors || [])
        .map((error) =>
          [error.title, error.detail].filter(Boolean).join(': '),
        )
        .filter(Boolean)
        .join(' · ');
    } catch {
      // Non-JSON error body; the status code is all we have.
    }

    const status = response.status;

    if (status === 401 || status === 403) {
      return 'Your App Store Connect session has expired. Reload the page, ' +
        'sign in again, then retry.';
    }

    if (status === 404) {
      return 'App Store Connect has no feedback endpoint for this app. ' +
        'Open the TestFlight Feedback section for the app and retry.';
    }

    if (status === 429) {
      return 'App Store Connect is rate limiting this session. Wait a minute ' +
        'and retry.';
    }

    const base = `App Store Connect rejected the request (HTTP ${status}).`;

    return detail ? `${base} ${detail}` : base;
  }

  async function irisFetch(url, headers) {
    if (!url.startsWith(ALLOWED_PREFIX)) {
      throw new Error('Refused: only App Store Connect iris requests are proxied.');
    }

    const response = await fetch(url, { credentials: 'include', headers });

    if (!response.ok) {
      const error = new Error(await describeFailure(response));

      error.status = response.status;

      throw error;
    }

    // Most endpoints answer with JSON:API, but a crash log may well come back
    // as plain text. Parse when it parses and hand back the raw body when it
    // does not, rather than failing on a perfectly good response.
    const body = await response.text();

    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING') {
      sendResponse({ ok: true, context: currentContext() });

      return false;
    }

    if (message?.type === 'IRIS_FETCH') {
      irisFetch(message.url, message.headers)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) =>
          sendResponse({ ok: false, error: error.message, status: error.status }),
        );

      return true; // keep the channel open for the async reply
    }

    return false;
  });

  // --- Launcher -----------------------------------------------------------
  // App Store Connect is a single-page app, so the button is added and removed
  // as the user moves between sections rather than once at load.

  let observer = null;
  let scanTimer = null;

  /**
   * When the extension is reloaded or updated, the copy of this script already
   * running in the page is orphaned: every `chrome.runtime` call then throws
   * "Extension context invalidated" — synchronously, so a trailing .catch()
   * does not help. Left alone the orphan keeps reacting to DOM mutations and
   * throws on each one, so it shuts itself down instead.
   */
  function isAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function shutdown() {
    observer?.disconnect();
    observer = null;

    clearTimeout(scanTimer);

    launcher?.remove();
    launcher = null;
  }

  function send(message) {
    if (!isAlive()) {
      shutdown();

      return;
    }

    try {
      chrome.runtime.sendMessage(message)?.catch?.(() => {});
    } catch {
      // The context died between the check and the call.
      shutdown();
    }
  }

  function openPanel() {
    send({ type: 'OPEN_PANEL' });
  }

  function syncLauncher() {
    const { onFeedbackPage } = currentContext();

    if (!onFeedbackPage) {
      launcher?.remove();
      launcher = null;

      return;
    }

    if (launcher?.isConnected) {
      return;
    }

    launcher = document.createElement('button');
    launcher.className = 'hangar-launcher';
    launcher.type = 'button';
    launcher.textContent = 'Open Hangar';
    launcher.addEventListener('click', openPanel);

    document.body.appendChild(launcher);
  }

  let lastUrl = location.href;

  function handleMutations() {
    if (!isAlive()) {
      shutdown();

      return;
    }

    if (location.href !== lastUrl) {
      lastUrl = location.href;

      send({ type: 'NAVIGATED', context: currentContext() });
    }

    syncLauncher();
  }

  observer = new MutationObserver(() => {
    // App Store Connect mutates the DOM constantly; coalesce the bursts.
    clearTimeout(scanTimer);
    scanTimer = setTimeout(handleMutations, 150);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  syncLauncher();
})();
