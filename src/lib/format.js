import { PRODUCT } from './config.js';
import { deriveSignals, formatBytes, formatDuration } from './signals.js';
import { describeCrash, firstSourceLocation, parseCrashLog } from './crashlog.js';

/** Stable, filename-safe task id derived from the immutable feedback id. */
export function taskId(feedback) {
  const compact = feedback.id.replace(/[^A-Za-z0-9]/g, '');

  return `TF-${compact.slice(0, 10)}`;
}

function titleFor(feedback) {
  const firstLine = feedback.comment.split('\n')[0].trim();

  if (firstLine) {
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  }

  if (feedback.kind === 'crash') {
    const parsed = parseCrashLog(feedback.crashLog);

    if (parsed) {
      const where = firstSourceLocation(parsed);

      return where
        ? `${describeCrash(parsed)} at ${where}`
        : describeCrash(parsed);
    }

    // Without a log, reports sharing a crash point at least line up together.
    return feedback.crashPointId
      ? `Crash at ${feedback.crashPointId.slice(0, 8)}`
      : 'Crash report';
  }

  return 'Screenshot feedback';
}

function screenshotPaths(feedback) {
  const id = taskId(feedback);

  return feedback.screenshots.map((shot, index) => ({
    ...shot,
    path: `screenshots/${id}${
      feedback.screenshots.length > 1 ? `-${index + 1}` : ''
    }.jpg`,
  }));
}

function yamlEscape(value) {
  return String(value ?? '').replace(/"/g, '\\"');
}

function testerLine(feedback, includeIdentity) {
  if (!feedback.tester) {
    return 'Unknown';
  }

  if (!includeIdentity) {
    return `${feedback.tester.anonymousId} (identity redacted)`;
  }

  return [feedback.tester.name, feedback.tester.email]
    .filter(Boolean)
    .join(' · ');
}

function buildTaskFile(feedback, includeIdentity) {
  const id = taskId(feedback);
  const shots = screenshotPaths(feedback);
  const signals = deriveSignals(feedback);
  const { device, conditions } = feedback;

  const frontMatterLines = [
    '---',
    `id: ${id}`,
    `source_id: "${yamlEscape(feedback.id)}"`,
    'status: todo',
    `kind: ${feedback.kind}`,
    `reported_at: "${yamlEscape(feedback.createdAt)}"`,
    `app_version: "${yamlEscape(feedback.version)}"`,
    `build: "${yamlEscape(feedback.build)}"`,
    `device: "${yamlEscape(device.name)}"`,
    `os_version: "${yamlEscape(device.osVersion)}"`,
    `locale: "${yamlEscape(conditions.locale)}"`,
  ];

  if (feedback.crashPointId) {
    frontMatterLines.push(`crash_point: "${yamlEscape(feedback.crashPointId)}"`);
  }

  if (feedback.incidentId) {
    frontMatterLines.push(`incident: "${yamlEscape(feedback.incidentId)}"`);
  }

  const frontMatter = [...frontMatterLines, '---'].join('\n');

  const sections = [
    frontMatter,
    '',
    `# ${id} — ${titleFor(feedback)}`,
    '',
    '## Reported problem',
    '',
    feedback.comment || '_The tester submitted no written description._',
    '',
  ];

  if (conditions.locale && feedback.comment.trim()) {
    // The device locale says nothing about what language the tester typed in:
    // an "en-TR" device is English-language, Turkey-region, and its owner may
    // well write in Turkish. So state the locale and leave the language to the
    // reader rather than guessing.
    sections.push(
      `> Device locale: \`${conditions.locale}\`. The text above is the ` +
        'tester\'s own wording and may be in any language. Translate it if you ' +
        'need to, but quote the original when referring back to it.',
      '',
    );
  }

  if (shots.length) {
    sections.push('## Screenshot', '');

    for (const shot of shots) {
      sections.push(`![${id}](../${shot.path})`, '');

      if (shot.width && shot.height && device.screenPoints) {
        sections.push(
          `The image is ${shot.width}×${shot.height} px and the device's ` +
            `logical screen is ${device.screenPoints.width}×${device.screenPoints.height} pt, ` +
            `so divide any pixel coordinate by ${(
              shot.width / device.screenPoints.width
            ).toFixed(0)} to get points.`,
          '',
        );
      }
    }

    sections.push(
      '**Open the image before deciding anything.** It usually shows the exact ' +
        'screen state the description leaves out.',
      '',
    );
  }

  if (feedback.kind === 'crash') {
    sections.push('## Crash', '');

    const parsed = parseCrashLog(feedback.crashLog);

    if (parsed) {
      if (parsed.runtimeFailure) {
        sections.push(
          `**${parsed.runtimeFailure}** — a Swift runtime trap, so this is a ` +
            'programming error the language caught, not memory corruption.',
          '',
        );
      } else if (parsed.exceptionType) {
        sections.push(`**${parsed.exceptionType}**`, '');
      }

      if (parsed.appFrames.length) {
        sections.push(
          parsed.appFramesAreOwn
            ? `Frames in \`${parsed.process}\` on the crashed thread, innermost first:`
            : 'No frame on the crashed thread belongs to the app binary. Top of the stack:',
          '',
        );

        for (const frame of parsed.appFrames) {
          sections.push(
            `- ${frame.location ? `\`${frame.location}\` — ` : ''}${frame.symbol}`,
          );
        }

        sections.push('');

        const start = firstSourceLocation(parsed);

        if (start) {
          sections.push(`Start at \`${start}\`.`, '');
        }
      }

      sections.push(
        `Full report: \`../crashes/${id}.crash\` (${parsed.frameCount} frames on ` +
          'the crashed thread, plus every other thread, register state and ' +
          'binary images). Read it when the summary above is not enough.',
        '',
      );
    } else if (feedback.crashLog) {
      // Unparsed but present: better to hand over the raw text than nothing.
      sections.push(`Full report: \`../crashes/${id}.crash\``, '');
    } else {
      sections.push(
        '_App Store Connect did not return a crash log for this report._',
        '',
      );
    }

    if (feedback.crashPointId) {
      sections.push(
        `Crash point \`${feedback.crashPointId}\`. Any other task carrying the ` +
          'same crash point died at the same place — fix one and check the rest ' +
          'against it before investigating them separately.',
        '',
      );
    }
  }

  sections.push(
    '## Environment',
    '',
    `- App version: ${feedback.version || 'Unknown'} (build ${
      feedback.build || 'Unknown'
    })`,
    `- Bundle id: ${feedback.bundleId || 'Unknown'}`,
    `- Device: ${device.name}${
      device.identifier ? ` (\`${device.identifier}\`)` : ''
    }`,
    `- OS: ${device.platform} ${device.osVersion}`,
    `- Screen: ${
      device.screenPoints
        ? `${device.screenPoints.width}×${device.screenPoints.height} pt`
        : 'Unknown'
    }`,
    `- Locale: ${conditions.locale || 'Unknown'} · ${
      conditions.timeZone || 'Unknown timezone'
    }`,
    `- Reported: ${feedback.createdAt || 'Unknown'}`,
    `- Tester: ${testerLine(feedback, includeIdentity)}`,
    '',
    '## Runtime conditions',
    '',
    `- Free storage: ${formatBytes(conditions.diskBytesAvailable)} of ${formatBytes(
      conditions.diskBytesTotal,
    )}`,
    `- Battery: ${
      conditions.batteryPercentage == null
        ? 'Unknown'
        : `${conditions.batteryPercentage}%`
    }`,
    `- Session length before ${
      feedback.kind === 'crash' ? 'crash' : 'report'
    }: ${formatDuration(conditions.appUptimeInMilliseconds)}`,
    `- Network: ${conditions.connectionType || 'Unknown'}${
      conditions.carrier ? ` (${conditions.carrier})` : ''
    }`,
    '',
  );

  if (signals.length) {
    sections.push(
      '## Signals worth checking',
      '',
      '_Correlations from the report metadata, not confirmed causes._',
      '',
    );

    for (const signal of signals) {
      sections.push(`- **${signal.label}** — ${signal.detail}`);
    }

    sections.push('');
  }

  sections.push(
    '## Investigation',
    '',
    '_Replace this section with the root cause once you have found it._',
    '',
    '## Changes',
    '',
    '_List the files you changed and why._',
    '',
  );

  return sections.join('\n');
}

function buildIndex(feedbackList, meta) {
  const rows = feedbackList.map((feedback) => {
    const id = taskId(feedback);

    return `- [ ] [${id}](tasks/${id}.md) — ${titleFor(feedback)}  \n      ${
      feedback.device.name
    } · ${feedback.device.osVersion} · build ${feedback.build || '?'}`;
  });

  const builds = [...new Set(feedbackList.map((item) => item.build))]
    .filter(Boolean)
    .sort();

  return [
    '# TestFlight feedback',
    '',
    `Exported ${meta.exportedAt} from App Store Connect${
      meta.appId ? ` (app ${meta.appId})` : ''
    }.`,
    '',
    `- Tasks: ${feedbackList.length}`,
    `- Builds represented: ${builds.join(', ') || 'Unknown'}`,
    '',
    '## Open tasks',
    '',
    ...rows,
    '',
    '## Where to start',
    '',
    'Run the triage pass in `TRIAGE.md` first if there are more than a handful ',
    'of tasks — it groups duplicates and orders the work before any code changes.',
    '',
  ].join('\n');
}

function buildTriage(feedbackList) {
  const builds = [...new Set(feedbackList.map((item) => item.build))].filter(
    Boolean,
  );

  return `# Triage pass

${feedbackList.length} pieces of TestFlight feedback are in \`tasks/\`. Before
fixing anything, work through them as a set.

## What to produce

Rewrite \`TASKS.md\` so it contains, in this order:

1. **Crashes and data loss** — anything where the tester lost work or the app died.
2. **Blocked flows** — the tester could not complete what they set out to do.
3. **Confusing or wrong UI** — it works, but not as the tester expected.
4. **Requests** — new behaviour rather than broken behaviour.

Within each group, put the issue that appears in the most reports first.

## Rules

- Read every task file **and open every screenshot**. Two reports that sound
  alike often show different screens; two that sound different often show the
  same one.
- When several reports share a cause, keep one task as primary and list the
  others under it as \`Also reported in: TF-…\`. Do not delete any task file.
- Visual similarity is not shared causation. Only merge when you can name the
  single code path both reports go through.
- Crash tasks carry a \`crash_point\` in their front matter. Reports sharing one
  died at the same place, so group them without further argument — this is the
  one case where merging needs no justification.
- ${
    builds.length > 1
      ? `Reports span builds ${builds.join(
          ', ',
        )}. If an issue only appears on one build, say so — that is a regression window worth naming.`
      : 'All reports come from a single build, so there is no regression window to compare against.'
  }
- Note anything you cannot place, rather than forcing it into a group.

## Then

Stop and show the reordered \`TASKS.md\`. Do not start changing code until the
list has been reviewed.
`;
}

/**
 * The instructions adapt to what was actually exported: telling an agent to
 * open a screenshot in a crash-only pack sends it looking for a file that is
 * not there.
 */
function buildAgentInstructions(kinds) {
  const hasScreenshots = kinds.has('screenshot');
  const hasCrashes = kinds.has('crash');

  const evidence = [];

  if (hasScreenshots) {
    evidence.push(
      '2. **Open the screenshot.** It is part of the report, not decoration, ' +
        'and usually shows the screen state the description leaves out.',
    );
  }

  if (hasCrashes) {
    evidence.push(
      `${hasScreenshots ? '3' : '2'}. **Read the crash log in full**, not just ` +
        'the top frame. Tasks that share a `crash_point` in their front matter ' +
        'died at the same place and should be handled together.',
    );
  }

  const rest = [
    '**Read the *Signals worth checking* section.** Those are correlations ' +
      'from device metadata — useful leads, but confirm them in the code before ' +
      'treating any of them as the cause.',
    'Find the responsible code. Reproduce the problem if there is a way to.',
    'Fix the cause, not the symptom.',
    'Keep the change contained. Do not restructure unrelated code, and follow ' +
      'the conventions already in this repository.',
    "Run the project's build, linter and tests.",
    'Update the task file: set `status: done`, fill in *Investigation* with the ' +
      'root cause, and list what you changed under *Changes*.',
  ];

  const offset = 2 + evidence.length;

  return `# TestFlight feedback tasks

\`${PRODUCT.exportDir}/tasks/\` holds issues reported by TestFlight testers.
Each file carries the tester's own words${
    hasScreenshots ? ', the screenshot they took' : ''
  }${hasCrashes ? ', the crash log' : ''}, and the state their device was in at
the time.

## Working a task

For every task whose front matter says \`status: todo\`:

1. Read the whole description. Testers describe symptoms, not causes.
${evidence.join('\n')}
${rest.map((line, index) => `${offset + index}. ${line}`).join('\n')}

## Cautions

- Two reports that look alike may have separate causes. Verify each${
    hasCrashes ? ' — a shared `crash_point` is the one exception' : ''
  }.
- If a report is too vague to act on, set \`status: needs-info\` and write down
  the specific question you would ask the tester. Do not guess.
- The *Reported problem* section is the record of what the tester said. Leave it
  untouched.
`;
}

const SLASH_COMMAND = `---
description: Work through exported TestFlight feedback
---

Read \`${PRODUCT.exportDir}/TASKS.md\`, then work through every task in
\`${PRODUCT.exportDir}/tasks/\` whose front matter says \`status: todo\`,
following the instructions in \`${PRODUCT.exportDir}/CLAUDE.md\`.

Open each screenshot before proposing a fix. Report which tasks you completed,
which you skipped, and why.
`;


/**
 * Included in the ZIP only. The direct-to-folder path puts every file exactly
 * where it belongs, so there is nothing to explain — and dropping a stray
 * README into someone's repository root would be rude at best.
 */
function buildZipGuide(presets) {
  const hasSlashCommand = presets.includes('claude');

  const lines = [
    '# What to do with this folder',
    '',
    'This export holds TestFlight tester feedback, rewritten as tasks a coding',
    'agent can work through. Everything here is plain text and images — nothing',
    'runs on its own.',
    '',
    '## Copy into the root of your repository',
    '',
    '```text',
    `${PRODUCT.exportDir}/`.padEnd(16) + ' tasks, screenshots and feedback.json',
  ];

  if (hasSlashCommand) {
    lines.push(
      '.claude/'.padEnd(16) + ' a /hangar command for Claude Code',
      '```',
      '',
      '`.claude` begins with a dot, so your file browser is probably hiding it.',
      'In Finder press Cmd+Shift+. to show hidden files. If you do not use',
      'Claude Code you can skip that folder entirely.',
    );
  } else {
    lines.push('```');
  }

  lines.push(
    '',
    '## Then',
    '',
    `Open \`${PRODUCT.exportDir}/TASKS.md\` to see everything that was exported.`,
    '',
    hasSlashCommand
      ? 'In Claude Code, run `/hangar` from the repository root.'
      : `Point your agent at \`${PRODUCT.exportDir}/\` and ask it to work through the tasks.`,
    '',
    `If there are more than a handful of reports, run the triage pass in \`${PRODUCT.exportDir}/TRIAGE.md\` first —`,
    'it groups duplicates and orders the work before any code gets changed.',
    '',
    'This file is not part of the task pack. Delete it once you have moved the',
    'folders across.',
    '',
  );

  return lines.join('\n');
}

/**
 * Build every text file in the pack, plus the list of screenshots to download.
 *
 * @returns {{
 *   files: Array<{ path: string, text: string }>,
 *   screenshots: Array<{ path: string, url: string, feedbackId: string }>
 * }}
 */
export function buildTaskPack(feedbackList, options) {
  const { includeTesterIdentity, presets, appId, exportedAt, includeZipGuide } =
    options;
  const base = PRODUCT.exportDir;

  const files = [
    {
      path: `${base}/TASKS.md`,
      text: buildIndex(feedbackList, { appId, exportedAt }),
    },
    { path: `${base}/TRIAGE.md`, text: buildTriage(feedbackList) },
  ];

  const screenshots = [];

  for (const feedback of feedbackList) {
    const id = taskId(feedback);

    files.push({
      path: `${base}/tasks/${id}.md`,
      text: buildTaskFile(feedback, includeTesterIdentity),
    });

    if (feedback.crashLog) {
      files.push({ path: `${base}/crashes/${id}.crash`, text: feedback.crashLog });
    }

    for (const shot of screenshotPaths(feedback)) {
      if (shot.url) {
        screenshots.push({
          path: `${base}/${shot.path}`,
          url: shot.url,
          feedbackId: feedback.id,
        });
      }
    }
  }

  if (includeZipGuide) {
    files.push({ path: 'HOW-TO-USE.md', text: buildZipGuide(presets) });
  }

  const instructions = buildAgentInstructions(
    new Set(feedbackList.map((item) => item.kind)),
  );

  if (presets.includes('claude')) {
    files.push({ path: `${base}/CLAUDE.md`, text: instructions });
    files.push({ path: '.claude/commands/hangar.md', text: SLASH_COMMAND });
  }

  if (presets.includes('agents')) {
    files.push({ path: `${base}/AGENTS.md`, text: instructions });
  }

  files.push({
    path: `${base}/feedback.json`,
    text: JSON.stringify(
      {
        generator: PRODUCT.name,
        exportedAt,
        appId,
        source: 'App Store Connect TestFlight feedback',
        testerIdentityIncluded: includeTesterIdentity,
        count: feedbackList.length,
        tasks: feedbackList.map((feedback) => ({
          id: taskId(feedback),
          sourceId: feedback.id,
          status: 'todo',
          kind: feedback.kind,
          comment: feedback.comment,
          reportedAt: feedback.createdAt,
          version: feedback.version,
          build: feedback.build,
          bundleId: feedback.bundleId,
          device: feedback.device,
          conditions: feedback.conditions,
          signals: deriveSignals(feedback),
          tester: includeTesterIdentity
            ? feedback.tester
            : feedback.tester && { anonymousId: feedback.tester.anonymousId },
          screenshots: screenshotPaths(feedback).map((shot) => ({
            path: shot.path,
            width: shot.width,
            height: shot.height,
          })),
        })),
      },
      null,
      2,
    ),
  });

  return { files, screenshots };
}

export { titleFor };
