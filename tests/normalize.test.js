/**
 * Unit tests for the text-normalization layer.
 * Run with:  node --test tests
 */
const test = require('node:test');
const assert = require('node:assert');
const N = require('../src/common/normalize.js');

test('stripRequiredMarker removes the Google Forms asterisk', () => {
  assert.strictEqual(N.stripRequiredMarker('Full Name *'), 'Full Name');
  assert.strictEqual(N.stripRequiredMarker('Full Name*'), 'Full Name');
  assert.strictEqual(N.stripRequiredMarker('Email (required)'), 'Email');
  assert.strictEqual(N.stripRequiredMarker('Rating * out of 5'), 'Rating * out of 5');
});

test('normalizeLabel expands the abbreviations college forms actually use', () => {
  assert.strictEqual(N.normalizeLabel('Roll No.'), 'roll number');
  assert.strictEqual(N.normalizeLabel('Mob No'), 'mobile number');
  assert.strictEqual(N.normalizeLabel('DOB'), 'date of birth');
  assert.strictEqual(N.normalizeLabel('10th Percentage'), 'tenth percentage');
  assert.strictEqual(N.normalizeLabel('12th %'), 'twelfth');
});

test('a standalone "No" is the word no, not an abbreviation for number', () => {
  assert.strictEqual(N.normalizeLabel('No'), 'no');
  assert.strictEqual(N.normalizeLabel('Roll No'), 'roll number');
});

test('tokens drops stopwords but keeps the qualifiers that disambiguate', () => {
  assert.deepStrictEqual(N.tokens('What is your name?'), ['name']);
  assert.deepStrictEqual(N.tokens('Please enter your college name'), ['college', 'name']);
  // "current" and "expected" are the only thing separating these two questions.
  assert.ok(N.tokens('Current CTC').includes('current'));
  assert.ok(N.tokens('Expected CTC').includes('expected'));
  // "state" is an address field, never a stopword.
  assert.deepStrictEqual(N.tokens('State'), ['state']);
});

test('stemming makes plurals and possessives compare equal', () => {
  assert.strictEqual(N.canonical('Skills'), N.canonical('Skill'));
  assert.strictEqual(N.canonical('Projects'), N.canonical('Project'));
  assert.strictEqual(N.canonical("Father's Name"), N.canonical('Father Name'));
  // Words ending in "ss" must survive intact.
  assert.strictEqual(N.stem('address'), 'address');
});

test('canonical is the single comparison space', () => {
  assert.strictEqual(N.canonical('Your Mobile Number *'), N.canonical('mobile number'));
  assert.strictEqual(N.canonical('Please enter your Roll No.'), N.canonical('roll number'));
});

test('containsPhrase only matches whole token runs', () => {
  assert.ok(N.containsPhrase('expected ctc lpa', 'expected ctc'));
  assert.ok(!N.containsPhrase('expected ctc', 'ctc lpa'));
  assert.ok(!N.containsPhrase('mobile number', 'obile'));
});

test('valueSimilarity is punctuation-blind for choice options', () => {
  assert.ok(N.valueSimilarity('B.Tech', 'B.Tech / B.E.') > 0.8);
  assert.ok(N.valueSimilarity('BTech', 'B.Tech') > 0.9);
  assert.strictEqual(N.valueSimilarity('Java', 'Java'), 1);
  assert.ok(N.valueSimilarity('Java', 'Go') < 0.5);
});

test('valueSimilarity keeps + and # so C++ and C# stay distinct', () => {
  assert.ok(N.valueSimilarity('C++', 'C++') === 1);
  assert.ok(N.valueSimilarity('C++', 'C#') < 1);
});

test('deriveSynonyms lets a new field match differently-worded questions', () => {
  const derived = N.deriveSynonyms('LeetCode Profile Link');
  assert.ok(derived.includes('leetcode profile link'));
  assert.ok(derived.includes('leetcode'), 'the bare subject must be matchable');
  assert.ok(derived.includes('leetcode link'));
  assert.strictEqual(new Set(derived).size, derived.length, 'no duplicates');
});

test('levenshtein and editSimilarity behave at the edges', () => {
  assert.strictEqual(N.levenshtein('', ''), 0);
  assert.strictEqual(N.levenshtein('abc', ''), 3);
  assert.strictEqual(N.levenshtein('kitten', 'sitting'), 3);
  assert.strictEqual(N.editSimilarity('abc', 'abc'), 1);
});
