import { PRODUCT, FEEDBACK_KINDS } from '../lib/config.js';
import { fetchAllFeedback, normalizeAll, parseAppContext } from '../lib/asc-api.js';
import { buildTaskPack, titleFor } from '../lib/format.js';
import { deriveSignals } from '../lib/signals.js';
import { createZip, textToBytes } from '../lib/zip.js';
import * as fsExport from '../lib/fs-export.js';
import {
  getExportedIds,
  getSettings,
  markExported,
  saveSettings,
} from '../lib/storage.js';

const $ = (id) => document.getElementById(id);

const dom = {
  context: $('context'),
  refresh: $('refresh'),
  openSettings: $('open-settings'),

  toolbar: $('toolbar'),
  search: $('search'),
  searchClear: $('search-clear'),
  filters: $('filters'),

  loading: $('loading'),
  loadingSub: $('loading-sub'),
  state: $('state'),
  stateGlyph: $('state-glyph'),
  stateTitle: $('state-title'),
  stateSub: $('state-sub'),
  stateAction: $('state-action'),
  list: $('list'),

  footer: $('footer'),
  selectedCount: $('selected-count'),
  clear: $('clear'),
  selectAll: $('select-all'),
  exportButton: $('export'),
  destination: $('destination'),

  preview: $('preview'),
  previewImage: $('preview-image'),
  previewComment: $('preview-comment'),
  previewMeta: $('preview-meta'),
  previewPosition: $('preview-position'),
  previewPrev: $('preview-prev'),
  previewNext: $('preview-next'),
  previewClose: $('preview-close'),
  previewToggle: $('preview-toggle'),

  settings: $('settings'),
  settingsClose: $('settings-close'),
  chooseFolder: $('choose-folder'),
  forgetFolder: $('forget-folder'),
  folderName: $('folder-name'),
  folderHint: $('folder-hint'),
  includeTester: $('include-tester'),
  screenshotSize: $('screenshot-size'),
  presetClaude: $('preset-claude'),
  presetAgents: $('preset-agents'),

  exportOverlay: $('export-overlay'),
  ringFill: $('ring-fill'),
  exportStep: $('export-step'),
  exportDetail: $('export-detail'),

  toast: $('toast'),
};

const RING_LENGTH = 2 * Math.PI * 21;

const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  settings: null,
  tabId: null,
  context: null,
  feedback: [],
  exported: new Set(),
  selected: new Set(),
  flagged: new Set(),
  filter: 'all',
  query: '',
  previewIndex: -1,
  busy: false,
};

/** Cards are reused across renders so they do not replay their entry animation. */
const cardCache = new Map();

let toastTimer = null;

// ==========================================================================
// Chrome plumbing
// ==========================================================================

async function proxyFetch(url, headers) {
  let response;

  try {
    response = await chrome.tabs.sendMessage(state.tabId, {
      type: 'IRIS_FETCH',
      url,
      headers,
    });
  } catch {
    throw new Error(
      'Could not reach the App Store Connect tab. Reload the page and try again.',
    );
  }

  if (!response?.ok) {
    const error = new Error(response?.error || 'The request failed.');

    // Carried through so the caller can retry with a different query shape.
    error.status = response?.status;

    throw error;
  }

  return response.data;
}

// ==========================================================================
// Chrome-free UI helpers
// ==========================================================================

function toast(message, tone = '') {
  clearTimeout(toastTimer);

  dom.toast.textContent = message;
  dom.toast.className = `toast${tone ? ` is-${tone}` : ''}`;
  dom.toast.hidden = false;

  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, tone === 'error' ? 7000 : 4000);
}

/** @param {'loading'|'list'|'state'} view */
function showView(view) {
  dom.loading.hidden = view !== 'loading';
  dom.list.hidden = view !== 'list';
  dom.state.hidden = view !== 'state';
  dom.toolbar.hidden = view !== 'list';
  dom.footer.hidden = view !== 'list';
}

function showState({ title, sub, glyph = '#i-inbox', action, onAction, tone }) {
  dom.state.classList.toggle('is-error', tone === 'error');
  dom.stateGlyph.setAttribute('href', glyph);
  dom.stateTitle.textContent = title;
  dom.stateSub.textContent = sub || '';

  dom.stateAction.hidden = !action;
  dom.stateAction.textContent = action || '';
  dom.stateAction.onclick = onAction || null;

  showView('state');
}

function setRing(fraction) {
  dom.ringFill.style.strokeDasharray = String(RING_LENGTH);
  dom.ringFill.style.strokeDashoffset = String(
    RING_LENGTH * (1 - Math.max(0, Math.min(1, fraction))),
  );
}

function setExportProgress(fraction, step, detail = '') {
  setRing(fraction);
  dom.exportStep.textContent = step;
  dom.exportDetail.textContent = detail;
}

function metaChips(feedback) {
  return [
    feedback.device.name,
    feedback.device.osVersion ? `${feedback.device.platform} ${feedback.device.osVersion}` : null,
    feedback.build ? `Build ${feedback.build}` : null,
  ].filter(Boolean);
}

// ==========================================================================
// Filtering
// ==========================================================================

function matchesQuery(feedback) {
  if (!state.query) {
    return true;
  }

  return [
    feedback.comment,
    feedback.device.name,
    feedback.device.identifier,
    feedback.build,
    feedback.version,
    feedback.device.osVersion,
  ]
    .join(' ')
    .toLowerCase()
    .includes(state.query);
}

function matchesFilter(feedback) {
  if (state.filter === 'new') {
    return !state.exported.has(feedback.id);
  }

  if (state.filter === 'flagged') {
    return state.flagged.has(feedback.id);
  }

  return true;
}

function visibleFeedback() {
  return state.feedback.filter(
    (item) => matchesFilter(item) && matchesQuery(item),
  );
}

// ==========================================================================
// Card rendering
// ==========================================================================

function buildCard(feedback) {
  const card = document.createElement('li');

  card.className = 'card';
  card.tabIndex = 0;

  // Played imperatively rather than through a CSS rule. Every filter keystroke
  // rebuilds the list, and re-inserting an element restarts any CSS animation
  // still matching it — so the whole list would flash on each keypress. A
  // scripted animation belongs to this element and runs exactly once.
  if (!prefersReducedMotion.matches) {
    card.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 240, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
    );
  }

  card.dataset.id = feedback.id;
  card.setAttribute('role', 'button');

  // Thumbnail -----------------------------------------------------------
  const shot = feedback.screenshots[0];
  const thumb = document.createElement('button');

  thumb.type = 'button';
  thumb.className = 'card-thumb';

  if (shot?.thumbnailUrl) {
    const img = document.createElement('img');

    img.src = shot.thumbnailUrl;
    img.alt = '';
    img.loading = 'lazy';

    const hint = document.createElement('span');

    hint.className = 'thumb-hint';
    hint.innerHTML = '<svg class="icon"><use href="#i-expand"/></svg>';

    thumb.append(img, hint);
    thumb.title = 'Open screenshot';
    thumb.addEventListener('click', (event) => {
      event.stopPropagation();
      openPreview(feedback.id);
    });
  } else {
    thumb.className = 'card-thumb is-empty';
    thumb.textContent = feedback.kind === 'crash' ? 'Crash' : 'No image';
    thumb.disabled = true;
  }

  // Body ----------------------------------------------------------------
  const body = document.createElement('div');

  body.className = 'card-body';

  const text = document.createElement('p');
  const comment = feedback.comment.trim();

  text.className = comment ? 'card-text' : 'card-text is-empty';
  // With no tester description, fall back to whatever the report itself says —
  // for a crash that is the trap message and the line it came from, which
  // beats "No written description" by some distance.
  text.textContent = comment || titleFor(feedback);

  const meta = document.createElement('div');

  meta.className = 'card-meta';

  if (!state.exported.has(feedback.id)) {
    const flag = document.createElement('span');

    flag.className = 'flag flag-new';
    flag.textContent = 'New';
    meta.append(flag);
  }

  for (const signal of deriveSignals(feedback).filter((s) => s.level === 'warn')) {
    const flag = document.createElement('span');

    flag.className = 'flag flag-warn';
    flag.textContent = signal.label;
    flag.title = signal.detail;
    meta.append(flag);
  }

  for (const label of metaChips(feedback)) {
    const chip = document.createElement('span');

    chip.className = 'meta-chip';
    chip.textContent = label;
    meta.append(chip);
  }

  body.append(text, meta);

  // Check ---------------------------------------------------------------
  const check = document.createElement('span');

  check.className = 'card-check';
  check.innerHTML = '<svg class="icon"><use href="#i-check"/></svg>';

  card.append(thumb, body, check);

  card.addEventListener('click', () => toggleSelection(feedback.id));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleSelection(feedback.id);
    }
  });

  return card;
}

function renderList() {
  const visible = visibleFeedback();

  if (!visible.length) {
    const filtered = state.query || state.filter !== 'all';

    showState(
      filtered
        ? {
            title: 'Nothing matches',
            sub: 'Try a different search, or switch back to All.',
            action: 'Reset filters',
            onAction: resetFilters,
          }
        : {
            title: 'No feedback yet',
            sub: `Testers have not sent any ${
              FEEDBACK_KINDS[state.context.kind].label.toLowerCase()
            } for this app.`,
          },
    );

    return;
  }

  showView('list');

  const fragment = document.createDocumentFragment();

  for (const feedback of visible) {
    let card = cardCache.get(feedback.id);

    if (!card) {
      card = buildCard(feedback);
      cardCache.set(feedback.id, card);
    }

    card.classList.toggle('is-selected', state.selected.has(feedback.id));
    card.setAttribute('aria-pressed', String(state.selected.has(feedback.id)));

    fragment.append(card);
  }

  dom.list.replaceChildren(fragment);
}

function renderCounts() {
  const counts = {
    all: state.feedback.length,
    new: state.feedback.filter((item) => !state.exported.has(item.id)).length,
    flagged: state.flagged.size,
  };

  for (const [key, value] of Object.entries(counts)) {
    dom.filters.querySelector(`[data-count="${key}"]`).textContent = String(value);
  }

  dom.filters.querySelector('[data-filter="flagged"]').disabled = counts.flagged === 0;

  dom.context.textContent = [
    state.context?.appId ? `App ${state.context.appId}` : null,
    FEEDBACK_KINDS[state.context?.kind || 'screenshot']?.label,
    `${counts.all} report${counts.all === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function renderFooter() {
  const count = state.selected.size;

  dom.selectedCount.textContent = count
    ? `${count} selected`
    : 'Nothing selected';
  dom.selectedCount.classList.toggle('is-active', count > 0);

  dom.clear.hidden = count === 0;
  dom.exportButton.disabled = count === 0 || state.busy;
  dom.exportButton.textContent = count ? `Export ${count}` : 'Export';

  const visible = visibleFeedback();
  const allChosen =
    visible.length > 0 && visible.every((item) => state.selected.has(item.id));

  dom.selectAll.textContent = allChosen ? 'Deselect all' : 'Select all';
  dom.selectAll.disabled = visible.length === 0;
}

function render() {
  renderCounts();
  renderList();
  renderFooter();
}

// ==========================================================================
// Selection
// ==========================================================================

function toggleSelection(id) {
  if (state.busy) {
    return;
  }

  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    state.selected.add(id);
  }

  const card = cardCache.get(id);

  card?.classList.toggle('is-selected', state.selected.has(id));
  card?.setAttribute('aria-pressed', String(state.selected.has(id)));

  if (state.previewIndex >= 0) {
    renderPreviewToggle();
  }

  renderFooter();
}

function resetFilters() {
  state.filter = 'all';
  state.query = '';
  dom.search.value = '';
  dom.searchClear.hidden = true;

  for (const chip of dom.filters.querySelectorAll('.chip')) {
    chip.classList.toggle('is-active', chip.dataset.filter === 'all');
  }

  render();
}

// ==========================================================================
// Preview
// ==========================================================================

function openPreview(id) {
  const visible = visibleFeedback();
  const index = visible.findIndex((item) => item.id === id);

  if (index < 0) {
    return;
  }

  state.previewIndex = index;
  dom.preview.hidden = false;
  renderPreview();
  dom.previewClose.focus();
}

function closePreview() {
  state.previewIndex = -1;
  dom.preview.hidden = true;
  dom.previewImage.removeAttribute('src');
}

function movePreview(delta) {
  const visible = visibleFeedback();
  const next = state.previewIndex + delta;

  if (next < 0 || next >= visible.length) {
    return;
  }

  state.previewIndex = next;
  renderPreview();
}

function renderPreviewToggle() {
  const feedback = visibleFeedback()[state.previewIndex];

  if (!feedback) {
    return;
  }

  const chosen = state.selected.has(feedback.id);

  dom.previewToggle.textContent = chosen
    ? 'Selected for export'
    : 'Select for export';
  dom.previewToggle.classList.toggle('is-on', chosen);
}

function renderPreview() {
  const visible = visibleFeedback();
  const feedback = visible[state.previewIndex];

  if (!feedback) {
    closePreview();

    return;
  }

  const shot = feedback.screenshots[0];

  dom.previewImage.src = shot?.previewUrl || shot?.url || '';
  dom.previewImage.alt = titleFor(feedback);
  dom.previewComment.textContent =
    feedback.comment.trim() || 'No written description';
  dom.previewPosition.textContent = `${state.previewIndex + 1} of ${visible.length}`;

  dom.previewPrev.disabled = state.previewIndex === 0;
  dom.previewNext.disabled = state.previewIndex === visible.length - 1;

  dom.previewMeta.replaceChildren(
    ...metaChips(feedback).map((label) => {
      const chip = document.createElement('span');

      chip.className = 'meta-chip';
      chip.textContent = label;

      return chip;
    }),
  );

  renderPreviewToggle();
}

// ==========================================================================
// Loading
// ==========================================================================

async function loadFeedback() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.startsWith('https://appstoreconnect.apple.com/')) {
    showState({
      title: 'Open App Store Connect',
      sub: `${PRODUCT.name} works on the TestFlight feedback pages of your app.`,
    });

    return;
  }

  state.tabId = tab.id;
  state.context = parseAppContext(tab.url);

  if (!state.context.appId) {
    showState({
      title: 'Open one of your apps',
      sub: 'Then go to TestFlight → Feedback and reload.',
    });

    return;
  }

  state.context.kind = state.context.kind || 'screenshot';
  state.exported = await getExportedIds(state.context.appId);

  showView('loading');
  dom.loadingSub.textContent = 'Asking App Store Connect…';
  dom.refresh.classList.add('is-spinning');

  try {
    const payload = await fetchAllFeedback(
      state.context.appId,
      state.context.kind,
      proxyFetch,
      (loaded, total, label) => {
        dom.loadingSub.textContent =
          label || (total ? `${loaded} of ${total} reports` : `${loaded} reports`);
      },
    );

    state.feedback = normalizeAll(
      payload,
      state.context.kind,
      state.settings.screenshotSize,
    );

    state.feedback.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    state.flagged = new Set(
      state.feedback
        .filter((item) => deriveSignals(item).some((s) => s.level === 'warn'))
        .map((item) => item.id),
    );

    state.selected.clear();
    cardCache.clear();

    render();
  } catch (error) {
    showState({
      title: 'Could not load feedback',
      sub: error.message,
      glyph: '#i-alert',
      tone: 'error',
      action: 'Try again',
      onAction: loadFeedback,
    });
  } finally {
    dom.refresh.classList.remove('is-spinning');
  }
}

// ==========================================================================
// Export
// ==========================================================================

async function downloadScreenshot(url) {
  // Pre-signed CDN URLs: no credentials, and host_permissions clears CORS.
  const response = await fetch(url, { credentials: 'omit' });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function downloadZip(blob) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `${PRODUCT.name.toLowerCase()}-${stamp}.zip`;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function exportSelected() {
  if (state.busy || state.selected.size === 0) {
    return;
  }

  state.busy = true;
  dom.exportOverlay.hidden = false;
  setExportProgress(0, 'Preparing…');
  renderFooter();

  const chosen = state.feedback.filter((item) => state.selected.has(item.id));

  try {
    const directory = state.settings.preferDirectExport
      ? await fsExport.getDirectory(false)
      : null;

    const { files, screenshots } = buildTaskPack(chosen, {
      includeTesterIdentity: state.settings.includeTesterIdentity,
      presets: state.settings.presets,
      appId: state.context.appId,
      exportedAt: new Date().toISOString(),
      // Only the ZIP needs a plain-language note; writing straight into the
      // repository puts everything where it already belongs.
      includeZipGuide: !directory,
    });

    const entries = files.map((file) => ({
      path: file.path,
      data: textToBytes(file.text),
    }));

    const failed = [];

    for (const [index, shot] of screenshots.entries()) {
      // Downloads take the bulk of the time, so they own most of the ring.
      setExportProgress(
        (index / screenshots.length) * 0.85,
        'Downloading screenshots',
        `${index + 1} of ${screenshots.length}`,
      );

      try {
        entries.push({ path: shot.path, data: await downloadScreenshot(shot.url) });
      } catch (error) {
        failed.push(shot.path);
        entries.push({
          path: `${shot.path}.failed.txt`,
          data: textToBytes(
            'This screenshot could not be downloaded.\n\n' +
              `Reason: ${error.message}\n\n` +
              'App Store Connect screenshot links are signed and expire a few ' +
              'days after the feedback is submitted. If this report is older ' +
              'than that, the image is no longer retrievable.\n',
          ),
        });
      }
    }

    if (directory) {
      setExportProgress(0.9, 'Writing files', directory.name);

      await fsExport.writeFiles(directory, entries, (written, total) => {
        setExportProgress(0.9 + (written / total) * 0.1, 'Writing files', directory.name);
      });
    } else {
      setExportProgress(0.95, 'Building archive');
      downloadZip(createZip(entries));
    }

    setExportProgress(1, 'Done');

    await markExported(
      state.context.appId,
      chosen.map((item) => item.id),
    );

    state.exported = await getExportedIds(state.context.appId);
    state.selected.clear();
    cardCache.clear();

    const where = directory
      ? `${directory.name}/${PRODUCT.exportDir}`
      : 'your downloads';

    toast(
      failed.length
        ? `Exported ${chosen.length} to ${where} · ${failed.length} screenshot${
            failed.length === 1 ? '' : 's'
          } unavailable`
        : `Exported ${chosen.length} task${chosen.length === 1 ? '' : 's'} to ${where}`,
      failed.length ? '' : 'good',
    );

    render();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.busy = false;
    dom.exportOverlay.hidden = true;
    renderFooter();
  }
}

// ==========================================================================
// Settings
// ==========================================================================

async function refreshDestination() {
  if (!fsExport.isSupported()) {
    dom.chooseFolder.disabled = true;
    dom.folderName.textContent = 'Downloads a ZIP file';
    dom.folderHint.textContent = 'This browser cannot write to a folder directly.';
    dom.destination.textContent = 'Exports download as a ZIP file';

    return;
  }

  const directory = await fsExport.getDirectory(false);

  dom.chooseFolder.classList.toggle('is-set', Boolean(directory));
  dom.forgetFolder.hidden = !directory;

  if (directory) {
    dom.folderName.textContent = directory.name;
    dom.folderHint.textContent = `Writes ${PRODUCT.exportDir}/ into this folder`;
    dom.destination.textContent = `Writes into ${directory.name}/${PRODUCT.exportDir}`;
  } else {
    dom.folderName.textContent = 'Downloads a ZIP file';
    dom.folderHint.textContent = 'Choose a repository folder to write into it directly';
    dom.destination.textContent = 'Exports download as a ZIP file';
  }
}

function applySettings() {
  dom.includeTester.checked = state.settings.includeTesterIdentity;
  dom.screenshotSize.value = state.settings.screenshotSize;
  dom.presetClaude.checked = state.settings.presets.includes('claude');
  dom.presetAgents.checked = state.settings.presets.includes('agents');
}

function collectPresets() {
  return [
    dom.presetClaude.checked ? 'claude' : null,
    dom.presetAgents.checked ? 'agents' : null,
  ].filter(Boolean);
}

// ==========================================================================
// Wiring
// ==========================================================================

dom.refresh.addEventListener('click', loadFeedback);

dom.openSettings.addEventListener('click', () => {
  dom.settings.hidden = false;
  dom.settingsClose.focus();
});

dom.settingsClose.addEventListener('click', () => {
  dom.settings.hidden = true;
});

dom.search.addEventListener('input', () => {
  state.query = dom.search.value.trim().toLowerCase();
  dom.searchClear.hidden = !dom.search.value;
  render();
});

dom.searchClear.addEventListener('click', () => {
  dom.search.value = '';
  state.query = '';
  dom.searchClear.hidden = true;
  dom.search.focus();
  render();
});

dom.filters.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');

  if (!chip || chip.disabled) {
    return;
  }

  state.filter = chip.dataset.filter;

  for (const other of dom.filters.querySelectorAll('.chip')) {
    other.classList.toggle('is-active', other === chip);
  }

  render();
});

dom.selectAll.addEventListener('click', () => {
  const visible = visibleFeedback();
  const allChosen = visible.every((item) => state.selected.has(item.id));

  for (const item of visible) {
    if (allChosen) {
      state.selected.delete(item.id);
    } else {
      state.selected.add(item.id);
    }
  }

  render();
});

dom.clear.addEventListener('click', () => {
  state.selected.clear();
  render();
});

dom.exportButton.addEventListener('click', exportSelected);

dom.previewClose.addEventListener('click', closePreview);
dom.previewPrev.addEventListener('click', () => movePreview(-1));
dom.previewNext.addEventListener('click', () => movePreview(1));
dom.previewToggle.addEventListener('click', () => {
  const feedback = visibleFeedback()[state.previewIndex];

  if (feedback) {
    toggleSelection(feedback.id);
  }
});

dom.chooseFolder.addEventListener('click', async () => {
  try {
    await fsExport.pickDirectory();
    state.settings = await saveSettings({ preferDirectExport: true });
    await refreshDestination();
    toast('Export folder set', 'good');
  } catch (error) {
    if (error.name !== 'AbortError') {
      toast(error.message, 'error');
    }
  }
});

dom.forgetFolder.addEventListener('click', async () => {
  await fsExport.forgetDirectory();
  await refreshDestination();
  toast('Exports will download as a ZIP again');
});

dom.includeTester.addEventListener('change', async () => {
  state.settings = await saveSettings({
    includeTesterIdentity: dom.includeTester.checked,
  });
});

dom.screenshotSize.addEventListener('change', async () => {
  state.settings = await saveSettings({ screenshotSize: dom.screenshotSize.value });
  // Re-normalise so the newly chosen size is what gets downloaded.
  await loadFeedback();
});

for (const input of [dom.presetClaude, dom.presetAgents]) {
  input.addEventListener('change', async () => {
    state.settings = await saveSettings({ presets: collectPresets() });
  });
}

document.addEventListener('keydown', (event) => {
  const typing = event.target.matches('input, select, textarea');

  if (event.key === 'Escape') {
    if (!dom.preview.hidden) {
      closePreview();
    } else if (!dom.settings.hidden) {
      dom.settings.hidden = true;
    } else if (dom.search.value) {
      dom.searchClear.click();
    }

    return;
  }

  if (!dom.preview.hidden) {
    if (event.key === 'ArrowLeft') {
      movePreview(-1);
    } else if (event.key === 'ArrowRight') {
      movePreview(1);
    } else if (event.key === ' ') {
      event.preventDefault();
      dom.previewToggle.click();
    }

    return;
  }

  if (!typing && event.key === '/') {
    event.preventDefault();
    dom.search.focus();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'PAGE_NAVIGATED') {
    loadFeedback();
  }
});

(async function init() {
  state.settings = await getSettings();
  applySettings();
  await refreshDestination();
  await loadFeedback();
})();
