/**
 * EzApply — Google Forms DOM reader.
 *
 * Turns the page into a plain Question[] and nothing more. It never writes to the DOM,
 * and the filler never re-queries the page, so the two can be reasoned about separately.
 *
 * Question shape:
 *   {
 *     index, id, label, description, required,
 *     type: 'short' | 'longtext' | 'radio' | 'checkbox' | 'dropdown' | 'date' | 'time'
 *           | 'scale' | 'unsupported',
 *     options: [{ label, value, element, isOther }],
 *     elements: { ... type-specific nodes ... },
 *     item: HTMLElement,          // the role=listitem container, for highlighting
 *     unsupportedReason
 *   }
 */
(function (root) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};
  var S = ns.Selectors;

  function text(el) {
    return el ? ns.Normalize.squash(el.textContent) : '';
  }

  /** Read an option's stored value, falling back through the attributes Google uses. */
  function optionValue(el) {
    for (var i = 0; i < S.OPTION_VALUE_ATTRS.length; i++) {
      var v = el.getAttribute(S.OPTION_VALUE_ATTRS[i]);
      if (v != null && v !== '') return v;
    }
    return text(el);
  }

  /** Human-readable option label; falls back to the value when there is no visible text. */
  function optionLabel(el) {
    var aria = el.getAttribute('aria-label');
    var inner = text(el);
    var label = ns.Normalize.squash(inner || aria || '');
    if (!label) label = optionValue(el);
    return label;
  }

  function readOptions(nodes) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var value = optionValue(el);
      var isOther = value === S.OTHER_OPTION_VALUE;
      var label = isOther ? 'Other' : optionLabel(el);
      // Google renders a disabled placeholder ("Choose") as the first dropdown option.
      if (!isOther && !label) continue;
      out.push({ label: label, value: value, element: el, isOther: isOther });
    }
    return out;
  }

  /** The free-text box that belongs to an "Other" choice, if the question has one. */
  function findOtherInput(item) {
    var inputs = S.all(item, S.TEXT_INPUT);
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (aria.indexOf('other') !== -1) return el;
      // Otherwise: a text box living inside a choice question can only be the Other box.
      if (el.closest('[role="radiogroup"], [role="list"]')) return el;
    }
    return inputs.length ? inputs[inputs.length - 1] : null;
  }

  function looksLikeFileUpload(item) {
    if (S.first(item, S.FILE_UPLOAD_HINT)) return true;
    return /\badd file\b/i.test(item.textContent || '');
  }

  /**
   * Work out what kind of question this is. Order matters: the most specific widgets are
   * tested first, and anything unrecognised falls into an explicit 'unsupported' bucket
   * rather than being silently dropped.
   */
  function detect(item) {
    var radioGroups = S.all(item, S.RADIO_GROUP);
    var checkboxes = S.all(item, S.CHECKBOX_OPTION);
    var listbox = S.first(item, S.LISTBOX);
    var textarea = S.first(item, S.TEXTAREA);
    var dateInput = S.first(item, S.DATE_INPUT);
    var dayPart = S.first(item, S.DATE_PART_DAY);
    var hourPart = S.first(item, S.TIME_HOUR);

    if (radioGroups.length > 1) {
      return { type: 'unsupported', reason: 'Grid questions are not supported yet.' };
    }

    if (textarea) {
      return { type: 'longtext', elements: { input: textarea } };
    }

    if (dateInput) {
      return { type: 'date', elements: { date: dateInput } };
    }

    if (dayPart) {
      return {
        type: 'date',
        elements: {
          day: dayPart,
          month: S.first(item, S.DATE_PART_MONTH),
          year: S.first(item, S.DATE_PART_YEAR)
        }
      };
    }

    if (hourPart) {
      return {
        type: 'time',
        elements: { hour: hourPart, minute: S.first(item, S.TIME_MINUTE) }
      };
    }

    if (radioGroups.length === 1) {
      var radios = S.all(radioGroups[0], S.RADIO_OPTION);
      var options = readOptions(radios);
      // A linear scale is a radiogroup whose options are all bare numbers.
      var numeric = options.length > 2 && options.every(function (o) { return /^\d+$/.test(o.label); });
      return {
        type: numeric ? 'scale' : 'radio',
        options: options,
        elements: { group: radioGroups[0], otherInput: findOtherInput(item) }
      };
    }

    if (checkboxes.length) {
      return {
        type: 'checkbox',
        options: readOptions(checkboxes),
        elements: { otherInput: findOtherInput(item) }
      };
    }

    if (listbox) {
      return {
        type: 'dropdown',
        options: readOptions(S.all(listbox, S.LISTBOX_OPTION)),
        elements: { listbox: listbox }
      };
    }

    var textInput = S.first(item, S.TEXT_INPUT);
    if (textInput) {
      return { type: 'short', elements: { input: textInput } };
    }

    if (looksLikeFileUpload(item)) {
      return {
        type: 'unsupported',
        reason: 'File uploads open Google Drive and cannot be filled by an extension — attach it yourself.'
      };
    }

    return { type: 'none' };
  }

  /** Read the question title, minus the required-question asterisk. */
  function readLabel(item) {
    var heading = S.first(item, S.QUESTION_HEADING);
    if (!heading) return '';
    var raw = heading.textContent || '';
    // The required marker lives inside the heading; drop its text before normalizing.
    var marker = S.first(heading, S.REQUIRED_MARKER);
    if (marker && marker.textContent) {
      raw = raw.split(marker.textContent).join(' ');
    }
    return ns.Normalize.stripRequiredMarker(raw);
  }

  function readDescription(item) {
    var heading = S.first(item, S.QUESTION_HEADING);
    var nodes = S.all(item, S.QUESTION_DESCRIPTION);
    for (var i = 0; i < nodes.length; i++) {
      if (heading && heading.contains(nodes[i])) continue;
      var t = text(nodes[i]);
      if (t) return t;
    }
    return '';
  }

  /**
   * Parse every question in the current section.
   * @returns {Array} questions, in document order, excluding non-question blocks.
   */
  function parse(scope) {
    var container = scope || document;
    var items = S.all(container, S.QUESTION_ITEM);
    var questions = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      // Google nests role=listitem inside checkbox questions; only take outer containers.
      if (item.parentElement && item.parentElement.closest('div[role="listitem"]')) continue;

      var label = readLabel(item);
      var detected;
      try {
        detected = detect(item);
      } catch (err) {
        detected = { type: 'unsupported', reason: 'Could not read this question (' + err.message + ').' };
      }

      if (detected.type === 'none') continue;              // section header, image, text block
      if (!label && detected.type === 'unsupported') continue;

      questions.push({
        index: questions.length,
        id: item.getAttribute('data-params') ? hashString(item.getAttribute('data-params')) : 'q' + i,
        label: label,
        description: readDescription(item),
        required: !!S.first(item, S.REQUIRED_MARKER),
        type: detected.type,
        options: detected.options || [],
        elements: detected.elements || {},
        item: item,
        unsupportedReason: detected.reason || ''
      });
    }

    return questions;
  }

  /** Small non-cryptographic hash, used only to give a question a stable local id. */
  function hashString(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return 'q' + (h >>> 0).toString(36);
  }

  /** True when the current page actually looks like a fillable Google Form. */
  function isFormPage() {
    return /\/forms\//.test(location.pathname) && !!document.querySelector('div[role="listitem"]');
  }

  ns.Parser = {
    parse: parse,
    detect: detect,
    readLabel: readLabel,
    readDescription: readDescription,
    readOptions: readOptions,
    optionValue: optionValue,
    optionLabel: optionLabel,
    isFormPage: isFormPage
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
