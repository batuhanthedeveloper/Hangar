/**
 * Single place to rebrand. Everything user-facing reads from here.
 */
export const PRODUCT = {
  name: 'Hangar',
  tagline: 'Turn TestFlight feedback into agent-ready tasks.',
  /**
   * Deliberately not a dotfile. A hidden directory is invisible in Finder and
   * most file browsers, so a ZIP whose only top-level entries are dotted
   * extracts to what looks like an empty folder.
   */
  exportDir: 'testflight',
};

export const ASC = {
  origin: 'https://appstoreconnect.apple.com',
  /**
   * App Store Connect's internal "iris" API accepts a static literal as its
   * CSRF value; there is no token to extract. Requests still need the session
   * cookie, which is why they are issued from the content script (same-origin)
   * rather than from an extension page.
   */
  csrfHeader: 'x-csrf-itc',
  csrfValue: '[asc-ui]',
  accept: 'application/vnd.api+json',
  pageSize: 200,
  /** Page size App Store Connect has been observed to accept. */
  fallbackPageSize: 60,
};

/** Screenshot CDN. Pre-signed URLs, no cookies required, but they expire. */
export const SCREENSHOT_HOST = 'tf-feedback.itunes.apple.com';

export const FEEDBACK_KINDS = {
  screenshot: {
    id: 'screenshot',
    label: 'Screenshots',
    path: 'betaFeedbackScreenshotSubmissions',
    pagePattern: /\/testflight\/screenshots/,
  },
  crash: {
    id: 'crash',
    label: 'Crashes',
    path: 'betaFeedbackCrashSubmissions',
    pagePattern: /\/testflight\/crashes/,
  },
};

export const DEFAULT_SETTINGS = {
  /** Tester email / name are personal data; off unless explicitly enabled. */
  includeTesterIdentity: false,
  /** Preferred screenshot size key from the API's sizedScreenshots map. */
  screenshotSize: 'original',
  /** Which agent preset files to emit alongside the tasks. */
  presets: ['claude'],
  /** Write straight into a chosen repo folder when the browser allows it. */
  preferDirectExport: true,
};
