/**
 * EzApply — writes values into Google Forms widgets.
 *
 * Google Forms is a Closure app: it does not read `input.value` at submit time, it reads
 * its own internal model, which is updated by the events its listeners receive. So every
 * text write goes through the *native* value setter (to survive any property shadowing)
 * and is followed by bubbling input/change events plus a real blur — a bare
 * `el.value = x` looks correct on screen and submits an empty answer.
 *
 * Choice widgets are custom divs, not native controls, so they are driven with click().
 *
 * Every fill returns a result object instead of throwing: one unfillable question must
 * never abort the rest of the run.
 */
(function (root) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};
  var S = ns.Selectors;

  var OPTION_MATCH_THRESHOLD = 0.6;

  function ok(value, note) { return { status: 'filled', value: value, reason: note || '' }; }
  function skip(reason) { return { status: 'skipped', value: '', reason: reason }; }
  function fail(reason) { return { status: 'error', value: '', reason: reason }; }

  function raf() {
    return new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); });
  }
  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /**
   * Assign through the prototype's value setter. If a framework has replaced the `value`
   * property on the element itself, a plain assignment would hit that shim instead of the
   * real DOM property and the change would never reach the page's model.
   */
  function setNativeValue(el, value) {
    var proto = (typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement)
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  /** Write text into a real <input>/<textarea> the way Google Forms expects. */
  async function typeInto(el, value) {
    if (!el) return fail('Input element missing.');
    try {
      el.focus();
      setNativeValue(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));

      setNativeValue(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await raf();
      el.blur();
      el.dispatchEvent(new Event('blur', { bubbles: false }));
      return ok(value);
    } catch (err) {
      return fail('Could not type into this field: ' + err.message);
    }
  }

  /** Click a custom (div-based) control and let Google's own listeners do the work. */
  async function clickOption(el) {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.click();
    await raf();
  }

  // ---------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------

  /**
   * Parse a stored date into parts. ISO (yyyy-mm-dd) is what the options page writes;
   * dd/mm/yyyy is accepted for imported data and follows the Indian convention.
   */
  function parseDate(value) {
    var s = ns.Normalize.squash(value);
    if (!s) return null;

    var iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3] };

    var dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (dmy) return { year: +dmy[3], month: +dmy[2], day: +dmy[1] };

    var parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
    }
    return null;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  async function fillDate(question, value) {
    var parts = parseDate(value);
    if (!parts) return skip('"' + value + '" is not a date EzApply can read.');

    var els = question.elements;

    if (els.date) {
      return typeInto(els.date, parts.year + '-' + pad(parts.month) + '-' + pad(parts.day));
    }

    if (els.day) {
      await typeInto(els.day, String(parts.day));
      if (els.month) await typeInto(els.month, String(parts.month));
      if (els.year) await typeInto(els.year, String(parts.year));
      return ok(pad(parts.day) + '/' + pad(parts.month) + '/' + parts.year);
    }

    return skip('No date input found in this question.');
  }

  async function fillTime(question, value) {
    var m = ns.Normalize.squash(value).match(/^(\d{1,2})[:.](\d{2})/);
    if (!m) return skip('"' + value + '" is not a time EzApply can read.');
    await typeInto(question.elements.hour, m[1]);
    if (question.elements.minute) await typeInto(question.elements.minute, m[2]);
    return ok(m[1] + ':' + m[2]);
  }

  // ---------------------------------------------------------------------------
  // Choice widgets
  // ---------------------------------------------------------------------------

  /** Select the "Other" choice and type a free-text answer, when the question offers one. */
  async function fillOther(question, value) {
    var other = null;
    for (var i = 0; i < question.options.length; i++) {
      if (question.options[i].isOther) { other = question.options[i]; break; }
    }
    if (!other) return null;

    await clickOption(other.element);
    var input = question.elements.otherInput || S.first(question.item, S.TEXT_INPUT);
    if (input) await typeInto(input, value);
    return ok(value, 'Filled via the "Other" option.');
  }

  async function fillRadio(question, value) {
    var choices = question.options.filter(function (o) { return !o.isOther; });
    if (!choices.length) return skip('This question has no selectable options.');

    var hit = ns.Matcher.matchOption(value, choices, OPTION_MATCH_THRESHOLD);
    if (hit) {
      await clickOption(choices[hit.index].element);
      return ok(choices[hit.index].label);
    }

    var other = await fillOther(question, value);
    if (other) return other;

    return skip('"' + value + '" does not match any option (' +
      choices.slice(0, 4).map(function (o) { return o.label; }).join(', ') +
      (choices.length > 4 ? ', …' : '') + ').');
  }

  async function fillCheckbox(question, value) {
    var choices = question.options.filter(function (o) { return !o.isOther; });
    if (!choices.length) return skip('This question has no selectable options.');

    // A comma-separated stored value (skills, preferred locations) should tick every
    // option it covers, not just the first.
    var values = String(value).split(',').map(function (v) { return v.trim(); }).filter(Boolean);
    var hits = ns.Matcher.matchOptions(values, choices, OPTION_MATCH_THRESHOLD);

    if (!hits.length) {
      var other = await fillOther(question, value);
      if (other) return other;
      return skip('None of "' + value + '" matches the available options.');
    }

    var picked = [];
    for (var i = 0; i < hits.length; i++) {
      var choice = choices[hits[i].index];
      if (choice.element.getAttribute('aria-checked') !== 'true') {
        await clickOption(choice.element);
      }
      picked.push(choice.label);
    }
    return ok(picked.join(', '));
  }

  /** Collect the option elements of an open dropdown, wherever Google rendered them. */
  function dropdownOptions(listbox) {
    var nodes = Array.prototype.slice.call(listbox.querySelectorAll('[role="option"]'));

    if (nodes.length <= 1) {
      var owns = listbox.getAttribute('aria-owns') || listbox.getAttribute('aria-controls');
      var owner = owns ? document.getElementById(owns) : null;
      if (owner) nodes = Array.prototype.slice.call(owner.querySelectorAll('[role="option"]'));
    }

    if (nodes.length <= 1) {
      // Last resort: the popup can be reparented to <body>. Take visible options only.
      nodes = Array.prototype.slice.call(document.querySelectorAll('[role="option"]'))
        .filter(function (n) { return n.offsetParent !== null; });
    }

    return ns.Parser.readOptions(nodes).filter(function (o) {
      return o.value !== '' && o.label && o.label.toLowerCase() !== 'choose';
    });
  }

  async function fillDropdown(question, value) {
    var listbox = question.elements.listbox;
    if (!listbox) return skip('No dropdown found in this question.');

    // Options are rendered lazily, so the list must be opened before it can be read.
    listbox.click();
    var options = [];
    for (var attempt = 0; attempt < 25; attempt++) {
      options = dropdownOptions(listbox);
      if (options.length) break;
      await raf();
    }
    if (!options.length) options = question.options.filter(function (o) { return o.value !== ''; });
    if (!options.length) {
      closeDropdown(listbox);
      return skip('This dropdown has no options EzApply can read.');
    }

    var hit = ns.Matcher.matchOption(value, options, OPTION_MATCH_THRESHOLD);
    if (!hit) {
      closeDropdown(listbox);
      return skip('"' + value + '" does not match any dropdown option.');
    }

    await clickOption(options[hit.index].element);
    await sleep(30);
    return ok(options[hit.index].label);
  }

  function closeDropdown(listbox) {
    try {
      listbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      document.body.click();
    } catch (e) { /* closing is best-effort */ }
  }

  // ---------------------------------------------------------------------------
  // Entry point
  // ---------------------------------------------------------------------------

  /**
   * Fill one question with one value.
   * @returns {Promise<{status:'filled'|'skipped'|'error', value:string, reason:string}>}
   */
  async function fill(question, value) {
    if (value == null || String(value).trim() === '') {
      return skip('No value stored for this field.');
    }
    var text = String(value);

    try {
      switch (question.type) {
        case 'short':
          return await typeInto(question.elements.input, text);
        case 'longtext':
          return await typeInto(question.elements.input, text);
        case 'date':
          return await fillDate(question, text);
        case 'time':
          return await fillTime(question, text);
        case 'radio':
        case 'scale':
          return await fillRadio(question, text);
        case 'checkbox':
          return await fillCheckbox(question, text);
        case 'dropdown':
          return await fillDropdown(question, text);
        case 'unsupported':
          return skip(question.unsupportedReason || 'Unsupported question type.');
        default:
          return skip('Unknown question type "' + question.type + '".');
      }
    } catch (err) {
      return fail('Filling failed: ' + err.message);
    }
  }

  /** Read back what a question currently contains — used to detect user corrections. */
  function currentValue(question) {
    var els = question.elements || {};
    if (els.input) return els.input.value || '';
    if (els.date) return els.date.value || '';
    if (question.type === 'radio' || question.type === 'scale' || question.type === 'checkbox') {
      var chosen = question.options.filter(function (o) {
        return o.element.getAttribute('aria-checked') === 'true';
      });
      return chosen.map(function (o) { return o.label; }).join(', ');
    }
    if (question.type === 'dropdown' && els.listbox) {
      var sel = els.listbox.querySelector('[aria-selected="true"]');
      return sel ? ns.Normalize.squash(sel.textContent) : '';
    }
    return '';
  }

  ns.Filler = {
    fill: fill,
    typeInto: typeInto,
    setNativeValue: setNativeValue,
    parseDate: parseDate,
    currentValue: currentValue,
    OPTION_MATCH_THRESHOLD: OPTION_MATCH_THRESHOLD
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
