/**
 * EzApply — popup.
 *
 * Shows how complete the profile is, fires the fill, and reports the outcome.
 *
 * The one subtlety: a tab that was already open when the extension was installed (or
 * reloaded during development) has no content script in it, so `tabs.sendMessage` fails.
 * We detect that with a ping and inject on demand — without this, EzApply looks broken
 * on the very first install, which is exactly when a user decides whether to keep it.
 */
(function () {
  'use strict';

  var EzApply = globalThis.EzApply;
  var Storage = EzApply.Storage;
  var Schema = EzApply.Schema;

  var els = {
    meterLabel: document.getElementById('meterLabel'),
    meterPct: document.getElementById('meterPct'),
    meterFill: document.getElementById('meterFill'),
    fillBtn: document.getElementById('fillBtn'),
    ctaSub: document.getElementById('ctaSub'),
    status: document.getElementById('status'),
    lastRun: document.getElementById('lastRun'),
    lastFilled: document.getElementById('lastFilled'),
    lastReview: document.getElementById('lastReview'),
    lastSkipped: document.getElementById('lastSkipped'),
    lastWhen: document.getElementById('lastWhen'),
    openOptions: document.getElementById('openOptions')
  };

  var CONTENT_FILES = [
    'src/common/normalize.js',
    'src/common/schema.js',
    'src/common/matcher.js',
    'src/common/storage.js',
    'src/content/gforms-selectors.js',
    'src/content/gforms-parser.js',
    'src/content/gforms-filler.js',
    'src/content/panel.js',
    'src/content/learner.js',
    'src/content/content.js'
  ];

  function setStatus(text, kind) {
    els.status.textContent = text || '';
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function activeTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs && tabs[0]);
      });
    });
  }

  function sendMessage(tabId, message) {
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tabId, message, function (response) {
        // Reading lastError here is what stops Chrome logging an unchecked-error warning.
        if (chrome.runtime.lastError) return resolve(null);
        resolve(response);
      });
    });
  }

  /** Ping the tab; if nothing answers, inject the content script and its stylesheet. */
  async function ensureContentScript(tabId) {
    var pong = await sendMessage(tabId, { type: 'EZ_PING' });
    if (pong && pong.ready) return true;

    try {
      await chrome.scripting.insertCSS({ target: { tabId: tabId }, files: ['src/content/content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: CONTENT_FILES });
    } catch (err) {
      setStatus('Could not start on this page: ' + err.message, 'error');
      return false;
    }

    pong = await sendMessage(tabId, { type: 'EZ_PING' });
    return !!(pong && pong.ready);
  }

  function isGoogleForm(url) {
    return /^https:\/\/docs\.google\.com\/forms\//.test(url || '');
  }

  function renderCompleteness(state) {
    var stats = Schema.completeness(state.profile);
    var custom = (state.profile.custom || []).filter(function (c) { return c.enabled !== false; }).length;
    els.meterPct.textContent = stats.percent + '%';
    els.meterFill.style.width = stats.percent + '%';
    els.meterLabel.textContent = stats.filled + ' of ' + stats.total + ' fields set' +
      (custom ? ' · ' + custom + ' of your own' : '');
  }

  function renderLastRun(lastRun) {
    if (!lastRun) return;
    els.lastRun.hidden = false;
    els.lastFilled.textContent = lastRun.filled + ' filled';
    els.lastReview.textContent = lastRun.review + ' to check';
    els.lastSkipped.textContent = lastRun.skipped + ' skipped';
    var when = new Date(lastRun.at);
    els.lastWhen.textContent = isNaN(when.getTime()) ? '' : 'on ' + when.toLocaleString();
  }

  async function onFillClick() {
    var tab = await activeTab();
    if (!tab) return;

    els.fillBtn.disabled = true;
    setStatus('Filling…');

    var ready = await ensureContentScript(tab.id);
    if (!ready) {
      els.fillBtn.disabled = false;
      if (!els.status.textContent) setStatus('Could not reach this page. Try reloading it.', 'error');
      return;
    }

    var result = await sendMessage(tab.id, { type: 'EZ_FILL' });
    els.fillBtn.disabled = false;

    if (!result) { setStatus('No response from the page. Try reloading it.', 'error'); return; }
    if (result.error) { setStatus(result.error, 'error'); return; }
    if (result.busy) { setStatus('Already filling…'); return; }

    renderLastRun(result);
    if (!result.total) {
      setStatus('No questions found on this page.', 'error');
    } else {
      setStatus('Filled ' + result.filled + ' of ' + result.total + ' questions.', 'ok');
    }
  }

  async function init() {
    var state = await Storage.getState();
    renderCompleteness(state);
    renderLastRun(state.lastRun);

    var tab = await activeTab();
    var stats = Schema.completeness(state.profile);

    if (!isGoogleForm(tab && tab.url)) {
      els.fillBtn.disabled = true;
      els.ctaSub.textContent = 'Open a Google Form to use this';
    } else if (stats.filled === 0) {
      els.fillBtn.disabled = true;
      els.ctaSub.textContent = 'Add your details first';
      setStatus('Click "Edit my details" to get started.');
    } else {
      els.fillBtn.disabled = false;
      els.ctaSub.textContent = 'Fill this form in one click';
    }
  }

  els.fillBtn.addEventListener('click', onFillClick);
  els.openOptions.addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  init().catch(function (err) {
    setStatus(err.message, 'error');
  });
})();
