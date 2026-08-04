/**
 * EzApply — text normalization utilities.
 *
 * Pure functions only: no DOM, no chrome.* APIs. This file is loaded both as a classic
 * content script (attaching to the shared EzApply namespace) and as a CommonJS module
 * by the unit tests.
 */
(function (root, factory) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};
  ns.Normalize = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = ns.Normalize;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Token-level rewrites applied to question labels. Google Forms authors abbreviate
   * heavily and inconsistently ("Roll No.", "Mob No", "DOB"), so expanding to a canonical
   * long form before scoring is what lets one synonym list cover many phrasings.
   */
  var ABBREVIATIONS = {
    no: 'number', nos: 'number', num: 'number',
    mob: 'mobile', mo: 'mobile', ph: 'phone', tel: 'phone', cell: 'mobile',
    dob: 'date of birth', bday: 'date of birth', birthdate: 'date of birth',
    email: 'email', mail: 'email', emailid: 'email', mailid: 'email',
    clg: 'college', coll: 'college', univ: 'university', uni: 'university',
    inst: 'institute', instn: 'institution',
    grad: 'graduation', gradn: 'graduation', passout: 'graduation',
    yr: 'year', yrs: 'year', yop: 'year of passing', passing: 'graduation',
    reg: 'registration', regn: 'registration', regd: 'registration',
    enrol: 'enrollment', enrolment: 'enrollment',
    addr: 'address', pin: 'pincode', zip: 'pincode',
    dept: 'department', spec: 'specialization', qualif: 'qualification',
    exp: 'experience', expd: 'expected',
    pct: 'percentage', perc: 'percentage', percent: 'percentage',
    marks: 'percentage', agg: 'aggregate',
    gpa: 'cgpa', ogpa: 'cgpa', sgpa: 'cgpa',
    '10th': 'tenth', 'xth': 'tenth', 'x': 'tenth', 'ssc': 'tenth',
    '12th': 'twelfth', 'xiith': 'twelfth', 'xii': 'twelfth', 'hsc': 'twelfth',
    'ug': 'undergraduate', 'pg': 'postgraduate',
    linkedin: 'linkedin', git: 'github',
    url: 'link', urls: 'link', links: 'link', profile: 'profile',
    cv: 'resume', resume: 'resume',
    ctc: 'ctc', lpa: 'ctc',
    fname: 'first name', lname: 'last name', mname: 'middle name',
    surname: 'last name', 'firstname': 'first name', 'lastname': 'last name',
    'fullname': 'full name', 'rollno': 'roll number', 'mobileno': 'mobile number',
    'phoneno': 'phone number', 'regno': 'registration number',
    plz: '', pls: '', kindly: ''
  };

  /**
   * Words carrying no discriminating signal in a form question. Deliberately conservative:
   * qualifiers like "current", "expected", "permanent" and "alternate" ARE kept, because
   * they are exactly what separates otherwise-identical questions ("current CTC" vs
   * "expected CTC", "permanent address" vs "current address").
   */
  var STOPWORDS = {
    a: 1, an: 1, the: 1, is: 1, are: 1, was: 1, were: 1, be: 1, been: 1,
    do: 1, does: 1, did: 1, has: 1, have: 1, will: 1, would: 1, can: 1,
    you: 1, your: 1, yours: 1, my: 1, mine: 1, me: 1, i: 1, we: 1, our: 1, us: 1,
    please: 1, enter: 1, provide: 1, mention: 1, write: 1, fill: 1, specify: 1,
    give: 1, type: 1, select: 1, choose: 1, pick: 1, share: 1, submit: 1,
    what: 1, whats: 1, which: 1, who: 1, where: 1, when: 1, how: 1,
    here: 1, this: 1, that: 1, these: 1, those: 1, it: 1, its: 1,
    of: 1, in: 1, on: 1, at: 1, to: 1, for: 1, from: 1, with: 1, by: 1,
    as: 1, per: 1, and: 1, or: 1, if: 1, any: 1, all: 1, also: 1, s: 1,
    only: 1, kindly: 1, note: 1, field: 1, question: 1, answer: 1, below: 1,
    above: 1, following: 1
    // Note: "state", "current", "expected", "permanent", "alternate" are deliberately
    // NOT stopwords — they are what distinguish otherwise-identical questions.
  };

  /** Abbreviations that are also real words; only expanded when other tokens surround them. */
  var AMBIGUOUS_ALONE = { no: 1, x: 1, mo: 1, marks: 1 };

  /** Collapse unicode spaces and trim. */
  function squash(text) {
    return String(text == null ? '' : text).replace(/[\s ​]+/g, ' ').trim();
  }

  /**
   * Strip the trailing "*" Google Forms appends to required questions, plus any
   * "(required)" style suffix.
   */
  function stripRequiredMarker(text) {
    return squash(String(text == null ? '' : text)
      .replace(/\s*\*+\s*$/, '')
      .replace(/\s*\(\s*required\s*\)\s*$/i, ''));
  }

  /**
   * Light normalization for comparing *values* against choice options: case and spacing
   * are flattened but "+" and "#" survive, so "C++" and "C#" still compare correctly.
   */
  function normalizeValue(text) {
    return squash(String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}+#.\s-]/gu, ' ')
      .replace(/[-_]+/g, ' '));
  }

  /**
   * Aggressive normalization for question labels: lowercase, punctuation to spaces,
   * abbreviations expanded. Returns a canonical space-separated string.
   */
  function normalizeLabel(text) {
    var raw = stripRequiredMarker(text)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ');

    var parts = squash(raw).split(' ').filter(Boolean);
    if (parts.length === 0) return '';

    var expanded = [];
    for (var i = 0; i < parts.length; i++) {
      var word = parts[i];
      // A handful of abbreviations are also ordinary standalone words — a label that is
      // just "No" means no, not "number". Everything else expands freely, including
      // single-token labels like "12th" -> "twelfth".
      var ambiguousAlone = parts.length === 1 && AMBIGUOUS_ALONE[word];
      var mapped = (!ambiguousAlone && Object.prototype.hasOwnProperty.call(ABBREVIATIONS, word))
        ? ABBREVIATIONS[word]
        : word;
      if (mapped) expanded.push(mapped);
    }
    return squash(expanded.join(' '));
  }

  /**
   * Very light suffix stripping so plurals and possessives compare equal:
   * skills/skill, projects/project, father's/father, universities/university.
   * Words ending in "ss" (address, business) are left alone.
   */
  function stem(word) {
    if (word.length > 4 && /ies$/.test(word)) return word.slice(0, -3) + 'y';
    if (word.length > 3 && /[^s]s$/.test(word)) return word.slice(0, -1);
    return word;
  }

  /** Normalized label split into meaningful, stemmed tokens (stopwords removed). */
  function tokens(text) {
    var out = [];
    var parts = normalizeLabel(text).split(' ');
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i];
      if (!t || STOPWORDS[t]) continue;
      if (t.length < 2 && !/\d/.test(t)) continue;
      out.push(stem(t));
    }
    // If stopword removal emptied the label, fall back to the raw tokens rather than
    // returning nothing — an all-stopword question should still be comparable.
    if (out.length === 0) {
      return normalizeLabel(text).split(' ').filter(Boolean).map(stem);
    }
    return out;
  }

  /**
   * The canonical comparison form of a label: normalized, stopword-free, stemmed, joined.
   * Everything in the matcher — synonyms, question labels and learned mapping keys —
   * is compared in this one space, so the comparisons stay symmetric.
   */
  function canonical(text) {
    return tokens(text).join(' ');
  }

  /** True when `phrase` appears in `text` as a whole-token run (both canonical). */
  function containsPhrase(text, phrase) {
    if (!text || !phrase) return false;
    return (' ' + text + ' ').indexOf(' ' + phrase + ' ') !== -1;
  }

  /** Sørensen–Dice coefficient over two token arrays (order-insensitive set overlap). */
  function diceTokens(a, b) {
    if (!a.length || !b.length) return 0;
    var seen = Object.create(null), i;
    for (i = 0; i < a.length; i++) seen[a[i]] = (seen[a[i]] || 0) + 1;
    var overlap = 0;
    for (i = 0; i < b.length; i++) {
      if (seen[b[i]] > 0) { overlap++; seen[b[i]]--; }
    }
    return (2 * overlap) / (a.length + b.length);
  }

  /** Classic Levenshtein distance, iterative with a single rolling row. */
  function levenshtein(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    var prev = new Array(b.length + 1), curr = new Array(b.length + 1), i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= b.length; j++) prev[j] = curr[j];
    }
    return prev[b.length];
  }

  /** Character-level similarity in 0..1, used for typo tolerance on short strings. */
  function editSimilarity(a, b) {
    a = String(a || ''); b = String(b || '');
    var longest = Math.max(a.length, b.length);
    if (longest === 0) return 1;
    return 1 - (levenshtein(a, b) / longest);
  }

  /**
   * Similarity between a stored value and a choice option label. Choice options are short
   * and often decorated ("B.Tech / B.E.", "Yes, I am willing"), so this blends exact,
   * containment, token-overlap and edit-distance signals.
   */
  function valueSimilarity(a, b) {
    var na = normalizeValue(a), nb = normalizeValue(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;

    // Punctuation-free comparison so "B.Tech" matches "BTech" and "B.Tech / B.E."
    var ca = compact(na), cb = compact(nb);
    if (ca && ca === cb) return 0.97;

    var contained = (nb.indexOf(na) !== -1 || na.indexOf(nb) !== -1) ? 0.88 : 0;
    if (!contained && ca && cb && (cb.indexOf(ca) !== -1 || ca.indexOf(cb) !== -1)) {
      var ratio = Math.min(ca.length, cb.length) / Math.max(ca.length, cb.length);
      if (ratio >= 0.4) contained = 0.82;
    }

    var overlap = diceTokens(na.split(' ').filter(Boolean), nb.split(' ').filter(Boolean));
    var edit = editSimilarity(na, nb);

    return Math.max(contained, overlap, edit * 0.9);
  }

  /** Strip everything but letters and digits — used for punctuation-blind comparison. */
  function compact(text) {
    return normalizeValue(text).replace(/[^\p{L}\p{N}]/gu, '');
  }

  /** Turn arbitrary text into a safe identifier fragment. */
  function slug(text) {
    return normalizeValue(text).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  /**
   * Derive extra matching phrases from a user-supplied field label so a newly added
   * field matches differently-worded questions immediately. "LeetCode Profile Link"
   * yields "leetcode profile link", "leetcode profile", "leetcode link", "leetcode".
   */
  function deriveSynonyms(label) {
    var base = normalizeLabel(label);
    if (!base) return [];
    var toks = tokens(label);
    var out = [base];

    if (toks.length) out.push(toks.join(' '));
    if (toks.length > 1) {
      out.push(toks[0]);                                   // the head noun alone
      out.push(toks[0] + ' ' + toks[toks.length - 1]);      // head + tail
      out.push(toks.slice(0, 2).join(' '));
    }
    // Generic decorators people append; the bare subject should match too.
    var trimmed = base.replace(/\b(link|profile|id|username|handle|number|name|details?)\b/g, '').trim();
    if (trimmed && trimmed !== base) out.push(squash(trimmed));

    var seen = Object.create(null);
    return out.filter(function (s) {
      s = squash(s);
      if (!s || seen[s]) return false;
      seen[s] = 1;
      return true;
    });
  }

  return {
    ABBREVIATIONS: ABBREVIATIONS,
    STOPWORDS: STOPWORDS,
    squash: squash,
    stripRequiredMarker: stripRequiredMarker,
    normalizeLabel: normalizeLabel,
    normalizeValue: normalizeValue,
    compact: compact,
    stem: stem,
    tokens: tokens,
    canonical: canonical,
    containsPhrase: containsPhrase,
    diceTokens: diceTokens,
    levenshtein: levenshtein,
    editSimilarity: editSimilarity,
    valueSimilarity: valueSimilarity,
    slug: slug,
    deriveSynonyms: deriveSynonyms
  };
});
