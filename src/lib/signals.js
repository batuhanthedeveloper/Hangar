/**
 * Turn raw runtime conditions into hypotheses worth putting in front of an
 * agent. These are hints, not diagnoses — the wording keeps that explicit so
 * an agent does not treat a correlation as a root cause.
 */

const LOW_DISK_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const LOW_BATTERY_PERCENT = 20;
const LONG_SESSION_MS = 30 * 60 * 1000; // 30 minutes
const SHORT_SESSION_MS = 60 * 1000; // 1 minute

export function formatBytes(bytes) {
  if (bytes == null) {
    return 'Unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];

  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatDuration(ms) {
  if (ms == null) {
    return 'Unknown';
  }

  if (ms < 60000) {
    return `${Math.round(ms / 1000)} s`;
  }

  const totalMinutes = Math.round(ms / 60000);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);

  return `${hours} h ${totalMinutes % 60} min`;
}

/**
 * @returns {Array<{ level: 'info'|'warn', label: string, detail: string }>}
 */
export function deriveSignals(feedback) {
  const { conditions, device } = feedback;
  const signals = [];

  if (
    conditions.diskBytesAvailable != null &&
    conditions.diskBytesAvailable < LOW_DISK_BYTES
  ) {
    signals.push({
      level: 'warn',
      label: 'Low free storage',
      detail:
        `Only ${formatBytes(conditions.diskBytesAvailable)} free. ` +
        'Writes to caches, temporary files, databases or image pipelines ' +
        'can fail silently under this condition.',
    });
  }

  if (
    feedback.kind === 'crash' &&
    conditions.appUptimeInMilliseconds != null &&
    conditions.appUptimeInMilliseconds <= SHORT_SESSION_MS
  ) {
    signals.push({
      level: 'warn',
      label: 'Crashed near launch',
      detail:
        `The app had been running for only ${formatDuration(
          conditions.appUptimeInMilliseconds,
        )}. ` +
        'Look at startup work — migrations, restored state, first network call ' +
        'or anything touched before the first screen is interactive.',
    });
  }

  if (
    conditions.appUptimeInMilliseconds != null &&
    conditions.appUptimeInMilliseconds > LONG_SESSION_MS
  ) {
    signals.push({
      level: 'info',
      label: 'Long-running session',
      detail:
        `The app had been running for ${formatDuration(
          conditions.appUptimeInMilliseconds,
        )} when this was reported. ` +
        'Consider state that accumulates over time rather than a cold-start path.',
    });
  }

  if (
    conditions.batteryPercentage != null &&
    conditions.batteryPercentage <= LOW_BATTERY_PERCENT
  ) {
    signals.push({
      level: 'info',
      label: 'Low battery',
      detail:
        `Battery at ${conditions.batteryPercentage}%. ` +
        'Low Power Mode may have been active, which throttles background work ' +
        'and reduces animation frame rates.',
    });
  }

  if (conditions.connectionType && conditions.connectionType !== 'WIFI') {
    signals.push({
      level: 'info',
      label: 'Cellular connection',
      detail:
        `Reported over ${conditions.connectionType}` +
        `${conditions.carrier ? ` (${conditions.carrier})` : ''}. ` +
        'Latency and timeouts differ from Wi-Fi.',
    });
  }

  if (!device.exactName && device.identifier) {
    signals.push({
      level: 'info',
      label: 'Unrecognised hardware',
      detail:
        `Device identifier ${device.identifier} is not in this extension's ` +
        'lookup table, so no marketing name is claimed. ' +
        (device.screenPoints
          ? `The reported logical screen size is ${device.screenPoints.width}×${device.screenPoints.height} pt.`
          : ''),
    });
  }

  return signals;
}
