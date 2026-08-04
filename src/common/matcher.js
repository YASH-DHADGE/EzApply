/**
 * EzApply — question-to-field matching engine.
 *
 * Pure functions: given a parsed question and an effective field registry, decide which
 * profile field (if any) answers it, and with how much confidence. No DOM, no chrome.*,
 * which is why this file carries the bulk of the unit tests.
 *
 * Resolution order:
 *   1. a learned mapping the user taught us            -> 1.00
 *   2. an exact synonym hit                            -> 0.95
 *   3. a whole-phrase synonym contained in the label   -> 0.72 .. 0.97 by coverage
 *   4. token overlap (Dice) between label and synonym  -> 0 .. ~0.85
 */
(function (root, factory) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};
  if (!ns.Normalize && typeof require === 'function') require('./normalize.js');
  if (!ns.Schema && typeof require === 'function') require('./schema.js');
  ns.Matcher = factory(ns.Normalize, ns.Schema);
  if (typeof module !== 'undefined' && module.exports) module.exports = ns.Matcher;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (N, Schema) {
  'use strict';

  var LEARNED_SCORE = 1.0;
  var EXACT_SCORE = 0.95;
  var CUSTOM_BONUS = 0.03;   // the user defined it deliberately — break near-ties their way
  var HAS_VALUE_BONUS = 0.01;
  // How far below the top match a *filled* runner-up may sit and still be preferred over
  // an empty top match. Wide enough that a filled custom field beats an empty built-in it
  // overlaps with; narrow enough that "Father's Name" never falls back to the user's own
  // name (which scores ~0.10 lower).
  var NEAR_TIE_MARGIN = 0.08;
  var DESCRIPTION_WEIGHT = 0.55;

  /** Stable key a learned mapping is stored under. */
  function mappingKey(label) {
    return N.canonical(label);
  }

  /** Score one synonym against an already-canonicalized question label. */
  function scoreSynonym(qCanon, qTokens, synonym) {
    var sCanon = N.canonical(synonym);
    if (!sCanon) return 0;
    if (qCanon === sCanon) return EXACT_SCORE;

    var sTokens = sCanon.split(' ').filter(Boolean);

    if (N.containsPhrase(qCanon, sCanon)) {
      // A synonym that covers more of the question is a better explanation of it:
      // "expected ctc" inside "expected ctc in lpa" beats "ctc" inside the same.
      var coverage = qTokens.length ? Math.min(1, sTokens.length / qTokens.length) : 0;
      return 0.72 + 0.25 * coverage;
    }

    return N.diceTokens(qTokens, sTokens) * 0.85;
  }

  /** Best score across all of a field's synonyms, plus its own label. */
  function scoreField(question, field) {
    var qCanon = N.canonical(question.label);
    var qTokens = qCanon.split(' ').filter(Boolean);
    if (!qTokens.length) return 0;

    var phrases = (field.synonyms || []).concat([field.label]);
    var best = 0;
    for (var i = 0; i < phrases.length; i++) {
      var s = scoreSynonym(qCanon, qTokens, phrases[i]);
      if (s > best) best = s;
      if (best >= EXACT_SCORE) break;
    }

    // A question's help text is a weaker but real signal: "Paste the full URL" under a
    // question titled "Profile" should still be able to tip a link field over the line.
    if (best < EXACT_SCORE && question.description) {
      var dCanon = N.canonical(question.description);
      var dTokens = dCanon.split(' ').filter(Boolean);
      if (dTokens.length) {
        for (var j = 0; j < phrases.length; j++) {
          var ds = scoreSynonym(dCanon, dTokens, phrases[j]) * DESCRIPTION_WEIGHT;
          if (ds > best) best = ds;
        }
      }
    }

    return best;
  }

  /**
   * Rank every registry field against a question.
   * @returns {Array<{field, score, hasValue, learned, compatible}>} sorted best-first
   */
  function rankFields(question, registry, mappings, profile) {
    var key = mappingKey(question.label);
    var learnedKey = mappings && Object.prototype.hasOwnProperty.call(mappings, key)
      ? (mappings[key] && mappings[key].fieldKey) || mappings[key]
      : null;

    var results = [];
    for (var i = 0; i < registry.length; i++) {
      var field = registry[i];
      var compatible = Schema.isCompatible(field.type, question.type);
      var isLearned = !!learnedKey && field.key === learnedKey;
      var score;

      if (isLearned) {
        score = LEARNED_SCORE;               // an explicit lesson outranks every heuristic
      } else {
        score = scoreField(question, field);
        if (!score) continue;
        if (!compatible) score *= 0.25;      // penalise rather than erase, so it can still
                                             // surface as a low-confidence suggestion
        if (field.isCustom) score = Math.min(1, score + CUSTOM_BONUS);
      }

      var filled = profile ? Schema.hasValue(profile, field) : false;
      if (filled && score < LEARNED_SCORE) score = Math.min(1, score + HAS_VALUE_BONUS);

      results.push({
        field: field,
        score: Math.round(score * 1000) / 1000,
        hasValue: filled,
        learned: isLearned,
        compatible: compatible
      });
    }

    results.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.hasValue !== b.hasValue) return a.hasValue ? -1 : 1;
      return a.field.key.localeCompare(b.field.key);
    });
    return results;
  }

  /**
   * Decide what to do with one question.
   * @returns {{action, field, score, alternatives, reason}}
   *   action is one of: 'fill' | 'review' | 'unmatched' | 'no-value' | 'unsupported'
   */
  function decide(question, registry, mappings, profile, settings) {
    var s = settings || Schema.DEFAULT_SETTINGS;

    if (question.type === 'unsupported') {
      return {
        action: 'unsupported', field: null, score: 0, alternatives: [],
        reason: question.unsupportedReason || 'This question type cannot be filled automatically.'
      };
    }

    var ranked = rankFields(question, registry, mappings, profile);
    var top = ranked[0];
    var alternatives = ranked.slice(0, 5);

    if (!top || top.score < s.reviewThreshold) {
      return {
        action: 'unmatched', field: null, score: top ? top.score : 0,
        alternatives: alternatives,
        reason: 'No profile field matches this question.'
      };
    }

    if (!top.hasValue) {
      // A close-but-filled runner-up may be the better answer, but only if it is a genuine
      // near-tie. Without the margin check this silently answers "Father's Name" with the
      // user's own name, because the empty fatherName field scores just above fullName.
      var withValue = null;
      for (var i = 1; i < ranked.length; i++) {
        var alt = ranked[i];
        if (!alt.hasValue) continue;
        if (alt.score >= s.autoThreshold && alt.score >= top.score - NEAR_TIE_MARGIN) withValue = alt;
        break;
      }
      if (!withValue) {
        return {
          action: 'no-value', field: top.field, score: top.score,
          alternatives: alternatives,
          reason: 'Matched "' + top.field.label + '", but you have not filled that in yet.'
        };
      }
      top = withValue;
    }

    return {
      action: top.score >= s.autoThreshold ? 'fill' : 'review',
      field: top.field,
      score: top.score,
      alternatives: alternatives,
      reason: top.learned
        ? 'You taught EzApply this mapping.'
        : 'Matched "' + top.field.label + '" (' + Math.round(top.score * 100) + '% confidence).'
    };
  }

  /**
   * Pick the choice option that best represents a stored value.
   * @param {string} value
   * @param {Array<{label:string}>} options
   * @param {number} [threshold]
   * @returns {{index:number, score:number}|null}
   */
  function matchOption(value, options, threshold) {
    var min = typeof threshold === 'number' ? threshold : 0.6;
    var best = null;
    for (var i = 0; i < options.length; i++) {
      var score = N.valueSimilarity(value, options[i].label);
      if (!best || score > best.score) best = { index: i, score: score };
    }
    return best && best.score >= min ? best : null;
  }

  /**
   * Pick every option matching any of a list of values — used for checkbox questions,
   * e.g. a skills list against a "Which of these do you know?" question.
   */
  function matchOptions(values, options, threshold) {
    var picked = [], seen = Object.create(null);
    for (var i = 0; i < values.length; i++) {
      var hit = matchOption(values[i], options, threshold);
      if (hit && !seen[hit.index]) { seen[hit.index] = 1; picked.push(hit); }
    }
    return picked;
  }

  /**
   * Reverse lookup used by the learner: which field already holds this exact value?
   * Returns the best-matching field or null.
   */
  function fieldHoldingValue(value, registry, profile) {
    var target = N.normalizeValue(value);
    if (!target) return null;

    var best = null;
    for (var i = 0; i < registry.length; i++) {
      var field = registry[i];
      var stored = Schema.readField(profile, field);
      if (!stored) continue;

      var score = N.valueSimilarity(stored, value);
      // For list fields, also try each element on its own.
      if (field.type === 'list') {
        var parts = String(stored).split(',');
        for (var j = 0; j < parts.length; j++) {
          score = Math.max(score, N.valueSimilarity(parts[j], value));
        }
      }
      if (score >= 0.92 && (!best || score > best.score)) best = { field: field, score: score };
    }
    return best;
  }

  return {
    LEARNED_SCORE: LEARNED_SCORE,
    EXACT_SCORE: EXACT_SCORE,
    mappingKey: mappingKey,
    scoreSynonym: scoreSynonym,
    scoreField: scoreField,
    rankFields: rankFields,
    decide: decide,
    matchOption: matchOption,
    matchOptions: matchOptions,
    fieldHoldingValue: fieldHoldingValue
  };
});
