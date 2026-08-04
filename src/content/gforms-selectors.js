/**
 * EzApply — every Google Forms selector, in one place.
 *
 * ============================ READ THIS BEFORE EDITING ============================
 * Google's CSS class names are obfuscated and rotate without notice (.whsOnd, .Qr7Oae,
 * .M7eMe ...). Class-based selectors WILL break. ARIA roles and semantic attributes are
 * part of Google's accessibility contract and are far more stable, so every selector
 * below is role/attribute-first with class names only as a last-resort fallback.
 *
 * If EzApply suddenly stops recognising questions, this file is almost certainly the
 * only one that needs changing. See README.md -> "When Google changes their DOM".
 * ==================================================================================
 */
(function (root) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};

  ns.Selectors = {
    /** The container of every question on the current page/section. */
    QUESTION_ITEM: [
      'div[role="listitem"]'
    ],

    /** Question title. The heading role is stable; .M7eMe is today's title span. */
    QUESTION_HEADING: [
      '[role="heading"]',
      '.M7eMe'
    ],

    /** Optional help text under the title. Class-only, so treated as best-effort. */
    QUESTION_DESCRIPTION: [
      '.gubaDc',
      '.OIC90c',
      '[role="heading"] + div'
    ],

    /** The "*" Google appends to required questions. */
    REQUIRED_MARKER: [
      '[aria-label="Required question"]',
      '.vnumgf'
    ],

    /** Short-answer text box. */
    TEXT_INPUT: [
      'input[type="text"]:not([aria-label="Year"]):not([aria-label="Month"]):not([aria-label="Day"])',
      'input[type="email"]',
      'input[type="url"]',
      'input[type="tel"]',
      'input[type="number"]',
      'input[jsname="YPqjbf"]'
    ],

    /** Paragraph answer. */
    TEXTAREA: [
      'textarea'
    ],

    /** Radio question container and its options. */
    RADIO_GROUP: ['[role="radiogroup"]'],
    RADIO_OPTION: ['[role="radio"]'],

    /** Checkbox options (their container is a plain role=list, so we find options directly). */
    CHECKBOX_OPTION: ['[role="checkbox"]'],

    /** Dropdown. Options are often only rendered once the listbox is opened. */
    LISTBOX: ['[role="listbox"]'],
    LISTBOX_OPTION: ['[role="option"]'],

    /** Date question: a native date input, or three separate day/month/year boxes. */
    DATE_INPUT: ['input[type="date"]'],
    DATE_PART_DAY: ['input[aria-label="Day"]', 'input[aria-label="Date"]'],
    DATE_PART_MONTH: ['input[aria-label="Month"]'],
    DATE_PART_YEAR: ['input[aria-label="Year"]'],

    /** Time question. */
    TIME_HOUR: ['input[aria-label="Hour"]'],
    TIME_MINUTE: ['input[aria-label="Minute"]'],

    /** File-upload question — cannot be automated; detected only so we can say so. */
    FILE_UPLOAD_HINT: [
      'input[type="file"]',
      '[aria-label*="Add file" i]',
      '[data-tooltip*="Add file" i]'
    ],

    /** Value attributes an option may carry, in priority order. */
    OPTION_VALUE_ATTRS: ['data-value', 'data-answer-value', 'aria-label'],

    /** Google's sentinel for the free-text "Other" choice. */
    OTHER_OPTION_VALUE: '__other_option__',

    /** Navigation buttons on multi-section forms (used only to detect sections). */
    NAV_BUTTONS: ['[role="button"][jsname]']
  };

  /** Query the first element matching any selector in a list. */
  ns.Selectors.first = function (rootEl, list) {
    for (var i = 0; i < list.length; i++) {
      try {
        var el = rootEl.querySelector(list[i]);
        if (el) return el;
      } catch (e) { /* a malformed selector must never break the whole run */ }
    }
    return null;
  };

  /** Query all elements matching any selector in a list, de-duplicated, document order. */
  ns.Selectors.all = function (rootEl, list) {
    var seen = [], out = [];
    for (var i = 0; i < list.length; i++) {
      var found;
      try { found = rootEl.querySelectorAll(list[i]); } catch (e) { continue; }
      for (var j = 0; j < found.length; j++) {
        if (seen.indexOf(found[j]) === -1) { seen.push(found[j]); out.push(found[j]); }
      }
    }
    return out;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
