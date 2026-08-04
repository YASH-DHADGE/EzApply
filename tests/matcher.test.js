/**
 * Unit tests for the question-to-field matching engine — the part of EzApply that
 * decides whether an answer is right, so the part most worth testing.
 * Run with:  node --test tests
 */
const test = require('node:test');
const assert = require('node:assert');

const Schema = require('../src/common/schema.js');
const Matcher = require('../src/common/matcher.js');

const SETTINGS = Schema.DEFAULT_SETTINGS;

function makeProfile(overrides = {}) {
  const p = Schema.defaultProfile();
  p.personal.fullName = 'Yash Daoev';
  p.personal.phone = '9876543210';
  p.personal.email = 'yash@example.com';
  p.personal.dob = '2003-05-14';
  p.academic.collegeName = 'ABC Institute of Technology';
  p.academic.rollNumber = '21CS1234';
  p.academic.degree = 'B.Tech';
  p.academic.branch = 'Computer Science';
  p.academic.graduationYear = '2026';
  p.academic.cgpa = '8.6';
  p.academic.tenthPercent = '92';
  p.academic.twelfthPercent = '88';
  p.professional.skills = ['Java', 'Python', 'React', 'SQL'];
  p.links.github = 'github.com/yash';
  Object.assign(p, overrides);
  return p;
}

function ask(label, profile, { type = 'short', mappings = {}, description = '' } = {}) {
  const registry = Schema.buildFieldRegistry(profile);
  const question = { label, type, description, options: [] };
  return Matcher.decide(question, registry, mappings, profile, SETTINGS);
}

// ---------------------------------------------------------------------------
// Basic matching
// ---------------------------------------------------------------------------

test('common placement-form questions map to the right field', () => {
  const p = makeProfile();
  const cases = [
    ['Full Name *', 'personal.fullName'],
    ['Name of the candidate', 'personal.fullName'],
    ['Mobile No.', 'personal.phone'],
    ['Contact Number (WhatsApp)', 'personal.phone'],
    ['Email ID', 'personal.email'],
    ['University Roll No', 'academic.rollNumber'],
    ['College Name', 'academic.collegeName'],
    ['Year of Passing', 'academic.graduationYear'],
    ['CGPA (till date)', 'academic.cgpa'],
    ['10th Percentage', 'academic.tenthPercent'],
    ['12th %', 'academic.twelfthPercent'],
    ['Technical Skills', 'professional.skills'],
    ['Github profile link', 'links.github']
  ];

  for (const [label, expected] of cases) {
    const decision = ask(label, p);
    assert.strictEqual(decision.action, 'fill', `"${label}" should be filled, got ${decision.action}`);
    assert.strictEqual(decision.field.key, expected, `"${label}" matched ${decision.field.key}`);
  }
});

test('a question with no plausible field is reported unmatched, never guessed', () => {
  const decision = ask('Hostel Room Number', makeProfile());
  assert.strictEqual(decision.action, 'unmatched');
  assert.strictEqual(decision.field, null);
});

test('an empty best match is reported, not replaced by a different field', () => {
  // Regression: "Father's Name" once fell back to the user's OWN name, because the
  // empty fatherName field outscored fullName by only ~0.1.
  const decision = ask("Father's Name", makeProfile());
  assert.strictEqual(decision.action, 'no-value');
  assert.strictEqual(decision.field.key, 'personal.fatherName');
});

test('a filled field wins a genuine near-tie against an empty one', () => {
  const p = makeProfile();
  p.custom = [Schema.makeCustomField({ label: 'LeetCode Profile Link', value: 'leetcode.com/u/y', type: 'link' })];
  // links.leetcode is empty; the custom field holds the answer and scores within the margin.
  const decision = ask('Leetcode id', p);
  assert.strictEqual(decision.action, 'fill');
  assert.ok(decision.field.isCustom, `expected the custom field, got ${decision.field.key}`);
});

// ---------------------------------------------------------------------------
// User-defined fields
// ---------------------------------------------------------------------------

test('buildFieldRegistry merges custom fields with auto-seeded synonyms', () => {
  const p = makeProfile();
  p.custom = [Schema.makeCustomField({ label: 'Hostel Room Number', value: 'H-402', type: 'text' })];
  const registry = Schema.buildFieldRegistry(p);
  const field = registry.find((f) => f.isCustom);

  assert.ok(field, 'custom field must appear in the effective registry');
  assert.strictEqual(field.key, 'custom.' + p.custom[0].id);
  assert.ok(field.synonyms.includes('hostel'), 'synonyms should be derived from the label');
});

test('a custom field matches a differently-worded question without extra configuration', () => {
  const p = makeProfile();
  p.custom = [Schema.makeCustomField({ label: 'LeetCode Profile Link', value: 'leetcode.com/u/y', type: 'link' })];

  for (const label of ['Your LeetCode profile', 'Leetcode profile link', 'LeetCode']) {
    const decision = ask(label, p);
    assert.strictEqual(decision.action, 'fill', `"${label}" should fill`);
    assert.ok(decision.field.isCustom || decision.field.key === 'links.leetcode',
      `"${label}" resolved to ${decision.field.key}`);
  }
});

test('a disabled custom field drops out of the registry entirely', () => {
  const p = makeProfile();
  p.custom = [Schema.makeCustomField({ label: 'Hostel Room Number', value: 'H-402', enabled: false })];
  assert.strictEqual(Schema.buildFieldRegistry(p).filter((f) => f.isCustom).length, 0);
  assert.strictEqual(ask('Hostel Room Number', p).action, 'unmatched');
});

test('a custom field wins a near-tie against a built-in', () => {
  const p = makeProfile();
  p.custom = [Schema.makeCustomField({ label: 'Technical Skills', value: 'Rust, Go', type: 'text' })];
  const registry = Schema.buildFieldRegistry(p);
  const ranked = Matcher.rankFields({ label: 'Technical Skills', type: 'short', options: [] }, registry, {}, p);
  assert.ok(ranked[0].field.isCustom, `expected the user's own field first, got ${ranked[0].field.key}`);
});

// ---------------------------------------------------------------------------
// Learned mappings
// ---------------------------------------------------------------------------

test('a learned mapping outranks every heuristic', () => {
  const p = makeProfile();
  const mappings = { [Matcher.mappingKey('Hostel Room Number')]: { fieldKey: 'academic.rollNumber' } };
  const decision = ask('Hostel Room Number', p, { mappings });

  assert.strictEqual(decision.action, 'fill');
  assert.strictEqual(decision.field.key, 'academic.rollNumber');
  assert.strictEqual(decision.score, 1);
});

test('mapping keys survive rewording of the same question', () => {
  assert.strictEqual(Matcher.mappingKey('Your Mobile Number *'), Matcher.mappingKey('mobile number'));
  assert.strictEqual(Matcher.mappingKey('Please enter your Roll No.'), Matcher.mappingKey('Roll Number'));
});

// ---------------------------------------------------------------------------
// Type compatibility
// ---------------------------------------------------------------------------

test('an incompatible field is penalised out of the fill band', () => {
  const p = makeProfile();
  // "Email" against a date widget: the email field must not win outright.
  const decision = ask('Email ID', p, { type: 'date' });
  assert.notStrictEqual(decision.action, 'fill');
});

test('a date field still fills a plain short-answer date question', () => {
  assert.ok(Schema.isCompatible('date', 'short'));
  assert.ok(Schema.isCompatible('date', 'date'));
  assert.ok(!Schema.isCompatible('email', 'date'));
});

// ---------------------------------------------------------------------------
// Choice matching
// ---------------------------------------------------------------------------

test('matchOption tolerates the decoration Google Forms options carry', () => {
  const options = [{ label: 'B.Tech / B.E.' }, { label: 'M.Tech' }, { label: 'MBA' }];
  assert.strictEqual(Matcher.matchOption('B.Tech', options).index, 0);
  assert.strictEqual(Matcher.matchOption('BTech', options).index, 0);
  assert.strictEqual(Matcher.matchOption('MBA', options).index, 2);
  assert.strictEqual(Matcher.matchOption('PhD', options), null);
});

test('matchOptions ticks every checkbox a list value covers, and nothing else', () => {
  const options = [{ label: 'Java' }, { label: 'Python' }, { label: 'Go' }, { label: 'C++' }];
  const picked = Matcher.matchOptions(['Java', 'Python', 'React', 'SQL'], options);
  assert.deepStrictEqual(picked.map((p) => p.index).sort(), [0, 1]);
});

// ---------------------------------------------------------------------------
// Reverse lookup (used by the learner)
// ---------------------------------------------------------------------------

test('fieldHoldingValue finds which field already holds a typed answer', () => {
  const p = makeProfile();
  const registry = Schema.buildFieldRegistry(p);

  assert.strictEqual(Matcher.fieldHoldingValue('9876543210', registry, p).field.key, 'personal.phone');
  assert.strictEqual(Matcher.fieldHoldingValue('21CS1234', registry, p).field.key, 'academic.rollNumber');
  // A single element of a list field counts as a hit.
  assert.strictEqual(Matcher.fieldHoldingValue('Python', registry, p).field.key, 'professional.skills');
  assert.strictEqual(Matcher.fieldHoldingValue('something nobody stored', registry, p), null);
});

// ---------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------

test('formatters clean values without destroying them', () => {
  assert.strictEqual(Schema.FORMATTERS.tel('+91 98765-43210'), '+919876543210');
  assert.strictEqual(Schema.FORMATTERS.link('github.com/y'), 'https://github.com/y');
  assert.strictEqual(Schema.FORMATTERS.link('https://github.com/y'), 'https://github.com/y');
  assert.strictEqual(Schema.FORMATTERS.list(['Java', 'Python']), 'Java, Python');
});

test('projects render into a readable block for a paragraph question', () => {
  const p = makeProfile();
  p.projects = [{ title: 'EzApply', techStack: 'JS', description: 'Form filler', link: 'x.com' }];
  const registry = Schema.buildFieldRegistry(p);
  const value = Schema.readField(p, Schema.findField(registry, 'projects'));

  assert.match(value, /^1\. EzApply/);
  assert.match(value, /Tech: JS/);
  assert.strictEqual(Schema.readField(makeProfile(), Schema.findField(registry, 'projects')), '');
});

test('completeness counts only fields that hold a value', () => {
  const empty = Schema.completeness(Schema.defaultProfile());
  const filled = Schema.completeness(makeProfile());
  assert.strictEqual(empty.filled, 0);
  assert.ok(filled.filled > 10);
  assert.ok(filled.percent > 0 && filled.percent < 100);
});
