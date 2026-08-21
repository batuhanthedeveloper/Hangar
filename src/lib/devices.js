/**
 * The iris API reports raw hardware identifiers ("iPhone17_4") where the
 * App Store Connect UI shows marketing names ("iPhone 16 Plus").
 *
 * This table will inevitably go stale as Apple ships new hardware, so an
 * unknown identifier is never guessed at: it is passed through verbatim and
 * the caller pairs it with the reported point size, which stays accurate.
 */
const MODELS = {
  // iPhone 8 / X — still in TestFlight groups, and the first to crash on new SDKs
  'iPhone10,1': 'iPhone 8',
  'iPhone10,4': 'iPhone 8',
  'iPhone10,2': 'iPhone 8 Plus',
  'iPhone10,5': 'iPhone 8 Plus',
  'iPhone10,3': 'iPhone X',
  'iPhone10,6': 'iPhone X',
  // iPhone XS / XR
  'iPhone11,2': 'iPhone XS',
  'iPhone11,4': 'iPhone XS Max',
  'iPhone11,6': 'iPhone XS Max',
  'iPhone11,8': 'iPhone XR',
  // iPhone 11 / SE 2
  'iPhone12,1': 'iPhone 11',
  'iPhone12,3': 'iPhone 11 Pro',
  'iPhone12,5': 'iPhone 11 Pro Max',
  'iPhone12,8': 'iPhone SE (2nd generation)',
  // iPhone 12
  'iPhone13,1': 'iPhone 12 mini',
  'iPhone13,2': 'iPhone 12',
  'iPhone13,3': 'iPhone 12 Pro',
  'iPhone13,4': 'iPhone 12 Pro Max',
  // iPhone 13 / SE 3
  'iPhone14,2': 'iPhone 13 Pro',
  'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone14,4': 'iPhone 13 mini',
  'iPhone14,5': 'iPhone 13',
  'iPhone14,6': 'iPhone SE (3rd generation)',
  // iPhone 14
  'iPhone14,7': 'iPhone 14',
  'iPhone14,8': 'iPhone 14 Plus',
  'iPhone15,2': 'iPhone 14 Pro',
  'iPhone15,3': 'iPhone 14 Pro Max',
  // iPhone 15
  'iPhone15,4': 'iPhone 15',
  'iPhone15,5': 'iPhone 15 Plus',
  'iPhone16,1': 'iPhone 15 Pro',
  'iPhone16,2': 'iPhone 15 Pro Max',
  // iPhone 16
  'iPhone17,1': 'iPhone 16 Pro',
  'iPhone17,2': 'iPhone 16 Pro Max',
  'iPhone17,3': 'iPhone 16',
  'iPhone17,4': 'iPhone 16 Plus',
  'iPhone17,5': 'iPhone 16e',
  // iPhone 17
  'iPhone18,1': 'iPhone 17 Pro',
  'iPhone18,2': 'iPhone 17 Pro Max',
  'iPhone18,3': 'iPhone 17',
  'iPhone18,4': 'iPhone Air',

  // iPad
  'iPad13,1': 'iPad Air (4th generation)',
  'iPad13,2': 'iPad Air (4th generation)',
  'iPad13,4': 'iPad Pro 11-inch (3rd generation)',
  'iPad13,8': 'iPad Pro 12.9-inch (5th generation)',
  'iPad13,16': 'iPad Air (5th generation)',
  'iPad13,17': 'iPad Air (5th generation)',
  'iPad14,1': 'iPad mini (6th generation)',
  'iPad14,3': 'iPad Pro 11-inch (4th generation)',
  'iPad14,5': 'iPad Pro 12.9-inch (6th generation)',
  'iPad14,8': 'iPad Air 11-inch (M2)',
  'iPad14,10': 'iPad Air 13-inch (M2)',
  'iPad16,1': 'iPad mini (A17 Pro)',
  'iPad16,3': 'iPad Pro 11-inch (M4)',
  'iPad16,5': 'iPad Pro 13-inch (M4)',
};

const FAMILY_LABELS = {
  IPHONE: 'iPhone',
  IPAD: 'iPad',
  APPLE_TV: 'Apple TV',
  APPLE_WATCH: 'Apple Watch',
  MAC: 'Mac',
  VISION: 'Apple Vision Pro',
};

/** The API reports platforms in screaming case; Apple writes them otherwise. */
const PLATFORM_LABELS = {
  IOS: 'iOS',
  IPADOS: 'iPadOS',
  MAC_OS: 'macOS',
  TV_OS: 'tvOS',
  WATCH_OS: 'watchOS',
  VISION_OS: 'visionOS',
};

export function formatPlatform(raw) {
  return PLATFORM_LABELS[raw] || raw || '';
}

/**
 * @param {string} raw  e.g. "iPhone17_4"
 * @param {string} [deviceFamily]  e.g. "IPHONE"
 * @returns {{ name: string, identifier: string, exact: boolean }}
 */
export function describeDevice(raw, deviceFamily) {
  const identifier = String(raw || '').replace(/_/g, ',');

  if (!identifier) {
    return {
      name: FAMILY_LABELS[deviceFamily] || 'Unknown device',
      identifier: '',
      exact: false,
    };
  }

  const known = MODELS[identifier];

  if (known) {
    return { name: known, identifier, exact: true };
  }

  // Unknown hardware: surface the identifier rather than inventing a name.
  const family = FAMILY_LABELS[deviceFamily];

  return {
    name: family ? `${family} (${identifier})` : identifier,
    identifier,
    exact: false,
  };
}
