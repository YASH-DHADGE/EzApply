/**
 * EzApply — in-page review panel.
 *
 * Shows what was filled, what needs a second look, and what was skipped, and — crucially —
 * lets the user turn any unmatched question into a permanent profile field without leaving
 * the form. That is the moment they notice the gap, so that is where the affordance lives.
 *
 * All page-derived text (question labels, option names) is written with textContent, never
 * innerHTML: a Google Form is authored by someone else and its text is untrusted input.
 */
(function (root) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};

  var panelEl = null;
  var handlers = {};

  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent != null) node.textContent = textContent;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function truncate(text, max) {
    var s = ns.Normalize.squash(text);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // ---------------------------------------------------------------------------
  // Highlights
  // ---------------------------------------------------------------------------

  var HIGHLIGHT_CLASSES = ['ez-hl-filled', 'ez-hl-review', 'ez-hl-skipped', 'ez-hl-focus'];

  function clearHighlights() {
    var nodes = document.querySelectorAll('.' + HIGHLIGHT_CLASSES.join(', .'));
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove.apply(nodes[i].classList, HIGHLIGHT_CLASSES);
    }
  }

  function highlight(entry) {
    if (!entry.question.item) return;
    var cls = entry.bucket === 'filled' ? 'ez-hl-filled'
      : entry.bucket === 'review' ? 'ez-hl-review'
        : 'ez-hl-skipped';
    entry.question.item.classList.add(cls);
  }

  function focusQuestion(question) {
    if (!question.item) return;
    question.item.scrollIntoView({ block: 'center', behavior: 'smooth' });
    question.item.classList.add('ez-hl-focus');
    setTimeout(function () { question.item.classList.remove('ez-hl-focus'); }, 1400);
  }

  // ---------------------------------------------------------------------------
  // Panel construction
  // ---------------------------------------------------------------------------

  function ensurePanel() {
    if (panelEl && document.body.contains(panelEl)) return panelEl;

    panelEl = el('div', 'ez-panel');
    panelEl.setAttribute('role', 'complementary');
    panelEl.setAttribute('aria-label', 'EzApply results');

    var head = el('div', 'ez-head');
    head.appendChild(el('span', 'ez-title', 'EzApply'));

    var collapse = el('button', null, '–');
    collapse.title = 'Collapse';
    collapse.addEventListener('click', function () {
      panelEl.classList.toggle('ez-collapsed');
      collapse.textContent = panelEl.classList.contains('ez-collapsed') ? '+' : '–';
    });

    var close = el('button', null, '×');
    close.title = 'Close';
    close.addEventListener('click', destroy);

    head.appendChild(collapse);
    head.appendChild(close);

    panelEl.appendChild(head);
    panelEl.appendChild(el('div', 'ez-counts'));
    panelEl.appendChild(el('div', 'ez-body'));
    panelEl.appendChild(el('div', 'ez-foot'));

    document.body.appendChild(panelEl);
    return panelEl;
  }

  function destroy() {
    clearHighlights();
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
  }

  function chip(container, cls, label, count) {
    if (!count) return;
    container.appendChild(el('span', 'ez-chip ' + cls, count + ' ' + label));
  }

  /** Build the nodes for one report row (plus its add-field button) as a fragment. */
  function buildRow(entry) {
    var frag = document.createDocumentFragment();
    var row = el('button', 'ez-row ez-r-' + entry.bucket);
    row.type = 'button';
    row.appendChild(el('span', 'ez-q', truncate(entry.question.label || '(untitled question)', 90)));

    var detail = entry.bucket === 'filled' || entry.bucket === 'review'
      ? truncate(entry.result && entry.result.value, 110)
      : truncate(entry.reason, 130);

    var valueNode = el('span', 'ez-v' + (entry.bucket === 'skipped' ? ' ez-muted' : ''), detail);
    row.appendChild(valueNode);

    row.addEventListener('click', function () { focusQuestion(entry.question); });
    frag.appendChild(row);

    // The primary route to a user-defined field: right where the gap was noticed.
    if (entry.canAddField) {
      var add = el('button', 'ez-add', '+ Add this field');
      add.type = 'button';
      add.addEventListener('click', function (event) {
        event.stopPropagation();
        openAddFieldForm(entry, add);
      });
      var wrap = el('div');
      wrap.style.padding = '0 14px 8px';
      wrap.appendChild(add);
      frag.appendChild(wrap);
    }
    return frag;
  }

  // ---------------------------------------------------------------------------
  // Inline "add a field" form
  // ---------------------------------------------------------------------------

  /** Guess a sensible field type from the widget the question uses. */
  function inferType(question) {
    var label = (question.label + ' ' + (question.description || '')).toLowerCase();
    if (question.type === 'date') return 'date';
    if (question.type === 'longtext') return 'longtext';
    if (question.type === 'radio' || question.type === 'checkbox' ||
        question.type === 'dropdown' || question.type === 'scale') return 'choice';
    if (/\b(link|url|profile|website|github|portfolio)\b/.test(label)) return 'link';
    if (/\b(email|e-mail|mail id)\b/.test(label)) return 'email';
    if (/\b(mobile|phone|contact number|whatsapp)\b/.test(label)) return 'tel';
    if (/\b(year|number|percentage|marks|cgpa|count|age)\b/.test(label)) return 'number';
    return 'text';
  }

  function openAddFieldForm(entry, anchorButton) {
    var existing = panelEl.querySelector('.ez-form');
    if (existing) existing.parentNode.removeChild(existing);

    var question = entry.question;
    var form = el('div', 'ez-form');

    form.appendChild(el('label', null, 'Field name'));
    var labelInput = el('input');
    labelInput.type = 'text';
    labelInput.value = question.label || '';
    form.appendChild(labelInput);

    form.appendChild(el('label', null, 'Your answer (saved for every future form)'));
    var valueInput;
    if (inferType(question) === 'longtext') {
      valueInput = el('textarea');
    } else {
      valueInput = el('input');
      valueInput.type = 'text';
    }
    valueInput.value = entry.suggestedValue || '';
    form.appendChild(valueInput);

    form.appendChild(el('label', null, 'Type'));
    var typeSelect = el('select');
    var types = ns.Schema.CUSTOM_TYPES;
    var guessed = inferType(question);
    for (var i = 0; i < types.length; i++) {
      var opt = el('option', null, types[i].label);
      opt.value = types[i].value;
      if (types[i].value === guessed) opt.selected = true;
      typeSelect.appendChild(opt);
    }
    form.appendChild(typeSelect);

    var hint = el('p', 'ez-hint', '');
    form.appendChild(hint);

    var actions = el('div', 'ez-form-actions');
    var save = el('button', 'ez-btn ez-btn-primary', 'Save & fill');
    save.type = 'button';
    var cancel = el('button', 'ez-btn ez-btn-ghost', 'Cancel');
    cancel.type = 'button';
    actions.appendChild(save);
    actions.appendChild(cancel);
    form.appendChild(actions);

    function refreshHint() {
      var derived = ns.Normalize.deriveSynonyms(labelInput.value);
      var collision = handlers.checkCollision ? handlers.checkCollision(labelInput.value) : null;
      if (collision) {
        hint.className = 'ez-hint ez-warn';
        hint.textContent = 'Heads up: this overlaps the built-in "' + collision.field.label +
          '" field. Filling that one in the options page may work better.';
      } else {
        hint.className = 'ez-hint';
        hint.textContent = derived.length
          ? 'Will also match: ' + derived.slice(0, 4).join(' · ')
          : '';
      }
    }
    labelInput.addEventListener('input', refreshHint);
    refreshHint();

    cancel.addEventListener('click', function () {
      if (form.parentNode) form.parentNode.removeChild(form);
    });

    save.addEventListener('click', function () {
      var label = ns.Normalize.squash(labelInput.value);
      if (!label) { labelInput.focus(); return; }
      save.textContent = 'Saving…';
      Promise.resolve(handlers.onAddField && handlers.onAddField({
        question: question,
        label: label,
        value: valueInput.value,
        type: typeSelect.value
      })).then(function () {
        if (form.parentNode) form.parentNode.removeChild(form);
      }).catch(function (err) {
        hint.className = 'ez-hint ez-warn';
        hint.textContent = 'Could not save: ' + err.message;
        save.textContent = 'Save & fill';
      });
    });

    anchorButton.parentNode.insertBefore(form, anchorButton.nextSibling);
    valueInput.focus();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Render a completed run.
   * @param {{filled:Array, review:Array, skipped:Array}} report
   * @param {{onAddField:Function, onRefill:Function, checkCollision:Function}} callbacks
   */
  function render(report, callbacks) {
    handlers = callbacks || {};
    ensurePanel();
    clearHighlights();

    var counts = panelEl.querySelector('.ez-counts');
    var body = panelEl.querySelector('.ez-body');
    var foot = panelEl.querySelector('.ez-foot');
    clear(counts); clear(body); clear(foot);

    chip(counts, 'ez-c-filled', 'filled', report.filled.length);
    chip(counts, 'ez-c-review', 'to check', report.review.length);
    chip(counts, 'ez-c-skipped', 'skipped', report.skipped.length);
    if (!report.filled.length && !report.review.length && !report.skipped.length) {
      counts.appendChild(el('span', 'ez-chip ez-c-skipped', 'No questions found'));
    }

    var groups = [
      { key: 'review', title: 'Check these' },
      { key: 'filled', title: 'Filled' },
      { key: 'skipped', title: 'Skipped' }
    ];

    for (var g = 0; g < groups.length; g++) {
      var list = report[groups[g].key];
      if (!list.length) continue;
      body.appendChild(el('h4', 'ez-group-title', groups[g].title));
      for (var i = 0; i < list.length; i++) {
        body.appendChild(buildRow(list[i]));
        highlight(list[i]);
      }
    }

    foot.appendChild(el('span', 'ez-note', 'EzApply never submits — review, then submit yourself.'));
    var refill = el('button', 'ez-btn ez-btn-ghost', 'Fill again');
    refill.type = 'button';
    refill.addEventListener('click', function () {
      if (handlers.onRefill) handlers.onRefill();
    });
    foot.appendChild(refill);

    return panelEl;
  }

  /** Short-lived confirmation, used by the learner. */
  function toast(message, ms) {
    var node = el('div', 'ez-toast', message);
    document.body.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, ms || 3200);
  }

  /**
   * The user corrected a question EzApply *did* match — it just held the wrong value
   * (they changed Degree from B.Tech to M.Tech). Offer to update the existing field
   * rather than silently minting a near-duplicate custom field, which would split the
   * matching score between two fields and make future forms worse, not better.
   */
  function offerFieldUpdate(question, field, typedValue) {
    ensurePanel();
    var body = panelEl.querySelector('.ez-body');

    var box = el('div', 'ez-form');
    box.appendChild(el('p', 'ez-q', ns.Normalize.squash(question.label)));
    box.appendChild(el('p', 'ez-hint',
      'You changed this to "' + truncate(typedValue, 60) + '". Update your saved ' +
      field.label + '?'));

    var actions = el('div', 'ez-form-actions');

    var update = el('button', 'ez-btn ez-btn-primary', 'Update ' + field.label);
    update.type = 'button';
    update.addEventListener('click', function () {
      update.textContent = 'Saving…';
      Promise.resolve(handlers.onUpdateField &&
        handlers.onUpdateField(question, field, typedValue)).then(function () {
        box.parentNode && box.parentNode.removeChild(box);
        toast('Updated your ' + field.label + '.');
      });
    });

    var asNew = el('button', 'ez-btn ez-btn-ghost', 'Add as new field');
    asNew.type = 'button';
    asNew.addEventListener('click', function () {
      box.parentNode && box.parentNode.removeChild(box);
      offerNewField(question, typedValue);
    });

    var ignore = el('button', 'ez-btn ez-btn-ghost', 'Ignore');
    ignore.type = 'button';
    ignore.addEventListener('click', function () {
      box.parentNode && box.parentNode.removeChild(box);
    });

    actions.appendChild(update);
    actions.appendChild(asNew);
    actions.appendChild(ignore);
    box.appendChild(actions);

    body.insertBefore(box, body.firstChild);
    body.scrollTop = 0;
  }

  /**
   * Offer to save a value the user typed into a question EzApply did not recognise.
   * Opens the panel's add-field form pre-filled with what they wrote.
   */
  function offerNewField(question, typedValue) {
    ensurePanel();
    var body = panelEl.querySelector('.ez-body');
    var entry = {
      question: question,
      bucket: 'skipped',
      reason: 'You answered this yourself — save it for next time?',
      canAddField: true,
      suggestedValue: typedValue
    };

    var frag = document.createDocumentFragment();
    frag.appendChild(el('h4', 'ez-group-title', 'Save your answer'));
    frag.appendChild(buildRow(entry));
    body.insertBefore(frag, body.firstChild);
    body.scrollTop = 0;
  }

  ns.Panel = {
    render: render,
    destroy: destroy,
    toast: toast,
    offerNewField: offerNewField,
    offerFieldUpdate: offerFieldUpdate,
    focusQuestion: focusQuestion,
    clearHighlights: clearHighlights,
    inferType: inferType
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
