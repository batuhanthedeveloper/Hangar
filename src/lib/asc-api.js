import { ASC, FEEDBACK_KINDS } from './config.js';
import { describeDevice, formatPlatform } from './devices.js';

/**
 * Extract the numeric app id (and team id, when present) from an App Store
 * Connect URL such as:
 *   /teams/<uuid>/apps/1234567890/testflight/screenshots
 */
export function parseAppContext(url) {
  const appId = url.match(/\/apps\/(\d+)/)?.[1] || null;
  const teamId = url.match(/\/teams\/([0-9a-f-]{36})/i)?.[1] || null;
  const kind =
    Object.values(FEEDBACK_KINDS).find((entry) =>
      entry.pagePattern.test(url),
    )?.id || null;

  return { appId, teamId, kind };
}

/**
 * Only parameters App Store Connect has been observed to accept.
 *
 * Two tempting additions are rejected outright by the server:
 *   include=build.preReleaseVersion  -> "not a valid relationship name"
 *   fields[preReleaseVersions]=...   -> "not a valid type name"
 * so the marketing version is resolved afterwards instead, by following the
 * relationship link the response supplies.
 */
function buildUrl(appId, kind, limit) {
  const path = FEEDBACK_KINDS[kind].path;
  const params = new URLSearchParams({
    include: 'tester,build',
    'fields[builds]': 'version,preReleaseVersion',
    limit: String(limit),
  });

  return `${ASC.origin}/iris/v1/apps/${appId}/${path}?${params}`;
}

function irisHeaders() {
  return {
    [ASC.csrfHeader]: ASC.csrfValue,
    accept: ASC.accept,
  };
}

async function fetchPages(url, fetcher, onProgress) {
  const headers = irisHeaders();
  const collected = [];
  const included = [];

  let total = 0;
  let guard = 0;
  let next = url;

  while (next) {
    const page = await fetcher(next, headers);

    collected.push(...(page.data || []));
    included.push(...(page.included || []));

    total = page.meta?.paging?.total ?? collected.length;

    onProgress?.(collected.length, total);

    const following = page.links?.next || null;

    // Guard against a server that keeps handing back the same page.
    next = following && following !== next && ++guard < 50 ? following : null;
  }

  return { data: collected, included, total };
}

/**
 * Resolve each build's marketing version ("1.0") by following the
 * relationship link the feedback response already contains, and fold the
 * results into `included` so normalisation sees a single flat set.
 *
 * Best effort: a failure here costs the version label, not the export.
 */
async function resolveAppVersions(included, fetcher) {
  const headers = irisHeaders();

  // The API returns the relationship as a link only — there is no `data`
  // reference to follow — so each resolved version is both appended to
  // `included` and wired back onto its build, which is what normalisation
  // walks.
  const builds = included.filter(
    (item) =>
      item.type === 'builds' &&
      item.relationships?.preReleaseVersion?.links?.related &&
      !item.relationships.preReleaseVersion.data,
  );

  const resolved = await Promise.all(
    builds.map(async (build) => {
      try {
        const body = await fetcher(
          build.relationships.preReleaseVersion.links.related,
          headers,
        );

        return { build, entry: body?.data || null };
      } catch {
        return { build, entry: null };
      }
    }),
  );

  for (const { build, entry } of resolved) {
    if (!entry?.id) {
      continue;
    }

    build.relationships.preReleaseVersion.data = {
      type: entry.type,
      id: entry.id,
    };

    included.push(entry);
  }
}

/**
 * Pull the crash log for each crash submission.
 *
 * Like `preReleaseVersion`, the log arrives as a relationship link rather than
 * an attribute, so it takes one request per report. The response shape is not
 * documented, so several plausible carriers are checked and the raw body is
 * used when it is plain text.
 *
 * Best effort throughout: a crash without its log is still worth exporting.
 */
// `logText` is what App Store Connect actually uses (type: betaCrashLogs);
// the rest are kept as cheap insurance against it being renamed.
const CRASH_LOG_KEYS = ['logText', 'crashLog', 'log', 'text', 'content', 'body'];

function extractCrashLog(payload) {
  if (typeof payload === 'string') {
    return payload;
  }

  const attributes = payload?.data?.attributes || payload?.attributes || {};

  for (const key of CRASH_LOG_KEYS) {
    if (typeof attributes[key] === 'string' && attributes[key].trim()) {
      return attributes[key];
    }
  }

  // Unknown key: fall back to the longest multi-line string present, which a
  // crash log invariably is.
  const candidates = Object.values(attributes)
    .filter((value) => typeof value === 'string' && value.includes('\n'))
    .sort((a, b) => b.length - a.length);

  return candidates[0] || null;
}

async function resolveCrashLogs(entries, fetcher, onProgress) {
  const headers = irisHeaders();

  const targets = entries.filter(
    (entry) => entry.relationships?.crashLog?.links?.related,
  );

  let done = 0;

  await Promise.all(
    targets.map(async (entry) => {
      try {
        const body = await fetcher(
          entry.relationships.crashLog.links.related,
          headers,
        );

        entry.resolvedCrashLog = extractCrashLog(body);
      } catch {
        entry.resolvedCrashLog = null;
      } finally {
        onProgress?.(++done, targets.length);
      }
    }),
  );
}

/**
 * Fetch every page of feedback for an app.
 *
 * The request itself is delegated to `fetcher`, because it has to run in a
 * context that carries the App Store Connect session cookie — in practice the
 * content script on appstoreconnect.apple.com.
 *
 * @param {(url: string, headers: Record<string, string>) => Promise<any>} fetcher
 * @param {(loaded: number, total: number) => void} [onProgress]
 */
export async function fetchAllFeedback(appId, kind, fetcher, onProgress) {
  let payload;

  try {
    payload = await fetchPages(
      buildUrl(appId, kind, ASC.pageSize),
      fetcher,
      onProgress,
    );
  } catch (error) {
    // The documented ceiling for this collection is not published, so a
    // rejected page size falls back to one that has been seen to work.
    if (error?.status !== 400) {
      throw error;
    }

    payload = await fetchPages(
      buildUrl(appId, kind, ASC.fallbackPageSize),
      fetcher,
      onProgress,
    );
  }

  await resolveAppVersions(payload.included, fetcher);

  if (kind === 'crash') {
    await resolveCrashLogs(payload.data, fetcher, (done, total) =>
      onProgress?.(total, total, `crash log ${done} of ${total}`),
    );
  }

  return payload;
}

function indexIncluded(included) {
  const byType = new Map();

  for (const item of included) {
    byType.set(`${item.type}:${item.id}`, item);
  }

  return byType;
}

function resolveVersion(entry, index) {
  const buildRef = entry.relationships?.build?.data;

  if (!buildRef) {
    return { version: '', build: '' };
  }

  const build = index.get(`builds:${buildRef.id}`);
  const preReleaseRef = build?.relationships?.preReleaseVersion?.data;
  const preRelease = preReleaseRef
    ? index.get(`preReleaseVersions:${preReleaseRef.id}`)
    : null;

  return {
    version: preRelease?.attributes?.version || '',
    build: build?.attributes?.version || '',
    buildId: buildRef.id,
  };
}

function resolveTester(entry, index) {
  const ref = entry.relationships?.tester?.data;

  if (!ref) {
    return null;
  }

  const tester = index.get(`betaTesters:${ref.id}`);
  const attributes = tester?.attributes || {};
  const name = [attributes.firstName, attributes.lastName]
    .filter(Boolean)
    .join(' ');

  return {
    id: ref.id,
    /** Stable, non-identifying handle used when identity is redacted. */
    anonymousId: `tester-${ref.id.slice(0, 4)}`,
    name,
    email: attributes.email || entry.attributes?.email || '',
  };
}

function pickScreenshots(attributes, preferredSize) {
  const sized = attributes.sizedScreenshots || [];

  return sized.map((set, position) => {
    const chosen = set[preferredSize] || set.original || Object.values(set)[0];

    return {
      position,
      url: chosen?.url || attributes.screenshots?.[position]?.url || '',
      width: chosen?.width ?? null,
      height: chosen?.height ?? null,
      expiresAt: chosen?.expirationDate || null,
      thumbnailUrl: (set.fits256 || set.fits512 || chosen)?.url || '',
      // A mid-size variant for on-screen preview: the original can be several
      // megabytes, which is wasted bandwidth for a panel a few hundred pixels
      // wide. The export still downloads whichever size the user picked.
      previewUrl: (set.fits1024 || set.original || chosen)?.url || '',
    };
  });
}

/**
 * Flatten one raw iris record into the shape the rest of the extension uses.
 */
export function normalizeFeedback(entry, index, kind, preferredSize) {
  const attributes = entry.attributes || {};
  const device = describeDevice(attributes.deviceModel, attributes.deviceFamily);

  return {
    id: entry.id,
    kind,
    comment: (attributes.comment || '').trim(),
    createdAt: attributes.createdDate || '',
    tester: resolveTester(entry, index),
    ...resolveVersion(entry, index),
    bundleId: attributes.buildBundleId || '',
    screenshots: pickScreenshots(attributes, preferredSize),
    crashLog: entry.resolvedCrashLog || null,
    /**
     * `crashPointId` is shared by every report that died at the same place —
     * Apple's own grouping, free of charge. `incidentId` identifies the single
     * occurrence.
     */
    crashPointId: attributes.crashPointId || null,
    incidentId: attributes.incidentId || null,
    device: {
      name: device.name,
      identifier: device.identifier,
      exactName: device.exact,
      osVersion: attributes.osVersion || '',
      platform: formatPlatform(
        attributes.devicePlatform || attributes.appPlatform,
      ),
      architecture: attributes.architecture || '',
      screenPoints:
        attributes.screenWidthInPoints && attributes.screenHeightInPoints
          ? {
              width: attributes.screenWidthInPoints,
              height: attributes.screenHeightInPoints,
            }
          : null,
    },
    /**
     * Runtime conditions the App Store Connect UI never shows. These are the
     * difference between "a button looks wrong" and "a button looks wrong on
     * a device with 500 MB of free storage after a 56 minute session".
     */
    conditions: {
      locale: attributes.locale || '',
      timeZone: attributes.timeZone || '',
      connectionType: attributes.connectionType || '',
      carrier: attributes.carrier || null,
      batteryPercentage: attributes.batteryPercentage ?? null,
      diskBytesAvailable: attributes.diskBytesAvailable ?? null,
      diskBytesTotal: attributes.diskBytesTotal ?? null,
      appUptimeInMilliseconds: attributes.appUptimeInMilliseconds ?? null,
      pairedAppleWatch: attributes.pairedAppleWatch ?? null,
    },
  };
}

export function normalizeAll(payload, kind, preferredSize) {
  const index = indexIncluded(payload.included);

  return payload.data.map((entry) =>
    normalizeFeedback(entry, index, kind, preferredSize),
  );
}
