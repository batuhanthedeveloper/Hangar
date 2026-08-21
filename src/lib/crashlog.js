/**
 * Reader for Apple's crash report format.
 *
 * A TestFlight crash log runs to ten kilobytes or so, most of it thread dumps
 * for threads that were sitting idle, register state and a table of binary
 * images. Handing all of that to an agent buries the part that matters, so the
 * salient facts are pulled out and the full text is written alongside as its
 * own file.
 */

const HEADER = /^([A-Za-z /]+):\s+(.*)$/;

/**
 * Frames look like:
 *   2   AppName<TAB>0x0000000100b7c5c4 Array.subscript.getter + 0 (View.swift:226)
 * The binary column is tab-separated from the address in Apple's output, but
 * older reports use runs of spaces, so both are accepted.
 */
const FRAME = /^(\d+)\s+(.+?)[\t ]+(0x[0-9a-fA-F]+)\s+(.*)$/;

const SWIFT_FAILURE = /^Swift runtime failure:\s*(.+?)(?:\s+\+\s+\d+)?$/;

function parseFrame(line) {
  const match = line.match(FRAME);

  if (!match) {
    return null;
  }

  const [, index, binary, address, remainder] = match;

  // A trailing "(File.swift:226)" is the source location; "+ 632" is the
  // offset into the symbol and carries no meaning without the binary.
  const location = remainder.match(/\(([^()]*)\)\s*$/)?.[1] || null;
  const symbol = remainder
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/\s+\+\s+\d+$/, '')
    .trim();

  return {
    index: Number(index),
    binary: binary.trim(),
    address,
    symbol,
    // "/<compiler-generated>:0" says only that the compiler synthesised it,
    // and a line number of 0 is a placeholder rather than a position.
    location:
      location &&
      !location.includes('<compiler-generated>') &&
      !/:0$/.test(location)
        ? location
        : null,
  };
}

/**
 * Frames that appear in every report and point at nothing: the trap marker,
 * which is already the headline, and the program entry point.
 */
function isNoiseFrame(frame) {
  return (
    SWIFT_FAILURE.test(frame.symbol) ||
    frame.symbol === 'main' ||
    /(^|\s)\S*\.\$main\(\)$/.test(frame.symbol)
  );
}

/**
 * @param {string} text raw crash report
 * @returns {{
 *   process: string, version: string, osVersion: string, hardware: string,
 *   exceptionType: string, terminationReason: string, runtimeFailure: string|null,
 *   crashedThread: number|null, appFrames: Array<object>, frameCount: number,
 *   truncated: boolean
 * } | null}
 */
export function parseCrashLog(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const lines = text.split('\n');
  const headers = {};

  for (const line of lines) {
    const match = line.match(HEADER);

    if (match && !headers[match[1]]) {
      headers[match[1]] = match[2].trim();
    }

    // Headers all precede the first thread section.
    if (/^Thread \d+/.test(line)) {
      break;
    }
  }

  // "ExampleApp [45930]" — the pid is not useful here.
  const process = (headers.Process || '').replace(/\s*\[\d+\]\s*$/, '').trim();

  const triggered = headers['Triggered by Thread'];
  const crashedThread = triggered != null ? Number(triggered) : null;

  // Collect the frames of the thread that actually crashed.
  const frames = [];

  let inCrashedThread = false;

  for (const line of lines) {
    if (/^Thread \d+/.test(line)) {
      inCrashedThread =
        /Crashed:/.test(line) ||
        (crashedThread != null &&
          new RegExp(`^Thread ${crashedThread}\\b.*Crashed`).test(line));

      continue;
    }

    if (!inCrashedThread) {
      continue;
    }

    if (!line.trim()) {
      // A blank line ends the thread's frame list.
      if (frames.length) {
        break;
      }

      continue;
    }

    const frame = parseFrame(line);

    if (frame) {
      frames.push(frame);
    }
  }

  // Swift traps surface as a frame symbol rather than a header field, and they
  // name the actual programming error.
  let runtimeFailure = null;

  for (const frame of frames) {
    const match = frame.symbol.match(SWIFT_FAILURE);

    if (match) {
      runtimeFailure = match[1].trim();
      break;
    }
  }

  const appFrames = process
    ? frames.filter((frame) => frame.binary === process && !isNoiseFrame(frame))
    : [];

  return {
    process,
    version: headers.Version || '',
    osVersion: headers['OS Version'] || '',
    hardware: headers['Hardware Model'] || '',
    exceptionType: headers['Exception Type'] || '',
    exceptionCodes: headers['Exception Codes'] || '',
    terminationReason: headers['Termination Reason'] || '',
    runtimeFailure,
    crashedThread,
    // Fall back to the top of the stack when nothing belongs to the app binary,
    // which happens when a crash is entirely inside a system framework.
    appFrames: appFrames.length ? appFrames : frames.slice(0, 5),
    appFramesAreOwn: appFrames.length > 0,
    frameCount: frames.length,
  };
}

/** One-line description of what went wrong, for indexes and card titles. */
export function describeCrash(parsed) {
  if (!parsed) {
    return 'Crash report';
  }

  if (parsed.runtimeFailure) {
    return parsed.runtimeFailure;
  }

  const type = parsed.exceptionType.split(' ')[0];

  return type ? `Crash (${type})` : 'Crash report';
}

/** The innermost app frame that names a source file — where to start reading. */
export function firstSourceLocation(parsed) {
  return parsed?.appFrames.find((frame) => frame.location)?.location || null;
}
