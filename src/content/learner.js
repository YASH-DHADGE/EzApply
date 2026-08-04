/**
 * EzApply — learns from the user's corrections.
 *
 * The whole feature rests on one browser guarantee: `event.isTrusted` is true only for
 * events the browser generated from real user input, and false for anything dispatched
 * from script. Since the filler writes exclusively via dispatched events, an isTrusted
 * event on a form control can only have come from the user's own hands. That is a clean
 * separator — no timers, no diffing against what we wrote, no false positives.
 *
 * On a genuine correction:
 *   - the typed value matches a profile field  -> remember question -> field, so the next
 *     form phrased differently still gets it right
 *   - it matches nothing                       -> offer to save it as a new custom field
 */
(function (root) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};

  var armed = false;
  var context = null;
  var pending = Object.create(null);

  /** Find the parsed question that owns an event target. */
  function questionFor(target) {
    if (!context || !target || !target.closest) return null;
    var item = target.closest('div[role="listitem"]');
    if (!item) return null;
    for (var i = 0; i < context.questions.length; i++) {
      if (context.questions[i].item === item) return context.questions[i];
    }
    return null;
  }

  function debounce(key, fn, ms) {
    clearTimeout(pending[key]);
    pending[key] = setTimeout(fn, ms);
  }

  function handleCorrection(question) {
    if (!context || !context.settings.learnFromCorrections) return;

    var typed = ns.Filler.currentValue(question);
    typed = ns.Normalize.squash(typed);
    if (!typed) return;

    var filledWith = context.filledValues[question.index];
    if (filledWith && ns.Normalize.normalizeValue(filledWith) === ns.Normalize.normalizeValue(typed)) {
      return; // unchanged — the user just tabbed through what we wrote
    }
    if (context.learned[question.index] === typed) return; // already handled this edit
    context.learned[question.index] = typed;

    var hit = ns.Matcher.fieldHoldingValue(typed, context.registry, context.profile);

    if (hit) {
      ns.Storage.saveMapping(question.label, hit.field.key).then(function () {
        if (context.mappings) {
          context.mappings[ns.Matcher.mappingKey(question.label)] = { fieldKey: hit.field.key };
        }
        ns.Panel.toast('Learned: "' + ns.Normalize.squash(question.label) +
          '" is your ' + hit.field.label + '. Future forms will fill it automatically.');
      }).catch(function () { /* a failed lesson must not disturb the user */ });
      return;
    }

    // Nothing in the profile holds this answer. Either the question was one EzApply
    // already understood and the *stored value* is out of date, or the question itself
    // is new to EzApply. Those need different offers — minting a duplicate field for the
    // first case would split the matching score and make later forms worse.
    var decision = context.decisions && context.decisions[question.index];
    if (decision && decision.field && decision.score >= context.settings.reviewThreshold) {
      ns.Panel.offerFieldUpdate(question, decision.field, typed);
    } else {
      ns.Panel.offerNewField(question, typed);
    }
  }

  function onUserEdit(event) {
    if (!event.isTrusted) return;                  // our own writes are never trusted
    var question = questionFor(event.target);
    if (!question) return;
    debounce('q' + question.index, function () { handleCorrection(question); }, 700);
  }

  /**
   * Start watching for corrections on the questions from the latest run.
   * @param {{questions, registry, profile, mappings, settings, filledValues}} ctx
   */
  function arm(ctx) {
    context = ctx;
    context.learned = Object.create(null);

    if (armed) return;
    armed = true;
    EDIT_EVENTS.forEach(function (type) {
      // Capture phase: Google stops propagation on some of its own widgets.
      document.addEventListener(type, onUserEdit, true);
    });
  }

  /**
   * `input` matters as much as `focusout` here: someone who types an answer and submits
   * without ever leaving the field would otherwise never be noticed. The debounce keeps
   * that from firing on every keystroke.
   */
  var EDIT_EVENTS = ['input', 'change', 'focusout', 'click'];

  function disarm() {
    EDIT_EVENTS.forEach(function (type) {
      document.removeEventListener(type, onUserEdit, true);
    });
    armed = false;
    context = null;
  }

  ns.Learner = { arm: arm, disarm: disarm, questionFor: questionFor };
})(typeof globalThis !== 'undefined' ? globalThis : this);
