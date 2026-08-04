/**
 * EzApply — content script orchestrator.
 *
 * parse -> match -> fill -> report, then hand the results to the panel and arm the learner.
 * Also watches for multi-section forms: clicking "Next" replaces the questions on the page
 * without a navigation, so a MutationObserver re-offers a fill for the new section.
 */
(function (root) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};

  var running = false;
  var lastContext = null;

  function summarize(report) {
    return {
      filled: report.filled.length,
      review: report.review.length,
      skipped: report.skipped.length,
      total: report.filled.length + report.review.length + report.skipped.length,
      at: new Date().toISOString(),
      url: location.href.split('?')[0]
    };
  }

  /**
   * Fill every question in the current section.
   * @returns {Promise<Object>} a summary suitable for the popup
   */
  async function run() {
    if (running) return { busy: true };
    running = true;

    try {
      var state = await ns.Storage.getState();
      var profile = state.profile;
      var registry = ns.Schema.buildFieldRegistry(profile);
      var questions = ns.Parser.parse(document);

      var report = { filled: [], review: [], skipped: [] };
      var filledValues = Object.create(null);
      var decisions = Object.create(null);

      for (var i = 0; i < questions.length; i++) {
        var question = questions[i];
        var decision = ns.Matcher.decide(question, registry, state.mappings, profile, state.settings);
        decisions[question.index] = decision;
        var entry = {
          question: question,
          decision: decision,
          result: null,
          reason: decision.reason,
          bucket: 'skipped',
          canAddField: false
        };

        if (decision.action === 'fill' || decision.action === 'review') {
          var value = ns.Schema.readField(profile, decision.field);
          var result = await ns.Filler.fill(question, value);
          entry.result = result;
          entry.reason = result.reason || decision.reason;

          if (result.status === 'filled') {
            filledValues[question.index] = result.value;
            entry.bucket = decision.action === 'fill' ? 'filled' : 'review';
          } else {
            entry.bucket = 'skipped';
            // A value we hold but could not place is still worth a field of its own
            // if the question simply is not in the registry's vocabulary.
            entry.canAddField = false;
          }
        } else if (decision.action === 'unsupported') {
          entry.bucket = 'skipped';
        } else {
          // 'unmatched' or 'no-value' — both are gaps the user can close right here.
          entry.bucket = 'skipped';
          entry.canAddField = decision.action === 'unmatched';
          entry.suggestedValue = '';
        }

        report[entry.bucket].push(entry);
      }

      lastContext = {
        questions: questions,
        registry: registry,
        profile: profile,
        mappings: state.mappings,
        settings: state.settings,
        filledValues: filledValues,
        decisions: decisions
      };

      if (state.settings.showPanel) {
        ns.Panel.render(report, {
          onAddField: addFieldAndFill,
          onUpdateField: updateFieldValue,
          onRefill: run,
          checkCollision: function (label) {
            return ns.Storage.findCollision(label, registry);
          }
        });
      }

      ns.Learner.arm(lastContext);

      var summary = summarize(report);
      ns.Storage.saveLastRun(summary);
      return summary;
    } finally {
      running = false;
    }
  }

  /**
   * Save a user-defined field and immediately answer the question that prompted it.
   * Called from the panel's inline form.
   */
  async function addFieldAndFill(input) {
    var record = await ns.Storage.saveCustomField({
      label: input.label,
      value: input.value,
      type: input.type
    });

    var question = input.question;
    if (question && ns.Normalize.squash(input.value)) {
      var formatter = ns.Schema.FORMATTERS[record.type] || ns.Schema.FORMATTERS.text;
      var result = await ns.Filler.fill(question, formatter(record.value));
      if (result.status === 'filled') {
        question.item.classList.remove('ez-hl-skipped');
        question.item.classList.add('ez-hl-filled');
        if (lastContext) lastContext.filledValues[question.index] = result.value;
      }
      ns.Panel.toast('Saved "' + record.label + '". EzApply will fill it on every future form.');
      // Teach the mapping too, so this exact question resolves instantly next time rather
      // than relying on the synonym score alone.
      ns.Storage.saveMapping(question.label, 'custom.' + record.id);
    } else {
      ns.Panel.toast('Saved "' + record.label + '".');
    }

    return record;
  }

  /**
   * The user corrected a question EzApply already understood — the stored value was just
   * stale. Update that field in place and remember the mapping, instead of creating a
   * second field that would compete with it on every future form.
   */
  async function updateFieldValue(question, field, value) {
    await ns.Storage.update(function (state) {
      if (field.isCustom) {
        var list = state.profile.custom || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i].id === field.customId) { list[i].value = value; break; }
        }
      } else if (field.type === 'list') {
        ns.Schema.setByPath(state.profile, field.key,
          value.split(',').map(function (v) { return v.trim(); }).filter(Boolean));
      } else {
        ns.Schema.setByPath(state.profile, field.key, value);
      }
      return state;
    });

    await ns.Storage.saveMapping(question.label, field.key);

    if (lastContext) {
      lastContext.filledValues[question.index] = value;
      lastContext.mappings[ns.Matcher.mappingKey(question.label)] = { fieldKey: field.key };
    }
  }

  // ---------------------------------------------------------------------------
  // Multi-section forms
  // ---------------------------------------------------------------------------

  var sectionTimer = null;
  var lastQuestionCount = -1;

  function watchForSections() {
    var observer = new MutationObserver(function () {
      clearTimeout(sectionTimer);
      sectionTimer = setTimeout(async function () {
        if (running) return;
        var count = document.querySelectorAll('div[role="listitem"]').length;
        if (count === lastQuestionCount || count === 0) return;
        lastQuestionCount = count;
        if (!lastContext) return;          // never auto-act before the user's first click

        var state = await ns.Storage.getState();
        if (state.settings.autoFillNewSections) {
          run();
        } else if (state.settings.showPanel) {
          ns.Panel.toast('New section loaded — click EzApply (or "Fill again") to fill it.');
        }
      }, 600);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) return;

    if (message.type === 'EZ_PING') {
      sendResponse({ ready: true, isForm: ns.Parser.isFormPage() });
      return true;
    }

    if (message.type === 'EZ_FILL') {
      run().then(sendResponse).catch(function (err) {
        sendResponse({ error: err.message });
      });
      return true;                        // keep the message channel open for the async reply
    }

    if (message.type === 'EZ_CLOSE_PANEL') {
      ns.Panel.destroy();
      sendResponse({ ok: true });
      return true;
    }
  });

  if (ns.Parser.isFormPage()) {
    lastQuestionCount = document.querySelectorAll('div[role="listitem"]').length;
    watchForSections();
  }

  ns.Content = { run: run, addFieldAndFill: addFieldAndFill, updateFieldValue: updateFieldValue };
})(typeof globalThis !== 'undefined' ? globalThis : this);
