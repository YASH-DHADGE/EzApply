/**
 * EzApply — profile schema, built-in field registry, and the effective-registry builder.
 *
 * The registry is deliberately NOT a constant: `buildFieldRegistry(profile)` merges the
 * built-in fields with the user's own custom fields, so a user-defined field is
 * indistinguishable from a built-in one everywhere downstream (matcher, filler, learner,
 * review panel). That single decision is what keeps the custom-field feature from
 * leaking special cases through the codebase.
 */
(function (root, factory) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};
  if (!ns.Normalize && typeof require === 'function') require('./normalize.js');
  ns.Schema = factory(ns.Normalize);
  if (typeof module !== 'undefined' && module.exports) module.exports = ns.Schema;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (N) {
  'use strict';

  var SCHEMA_VERSION = 1;

  /** Field types. These drive formatting, validation, and question/field compatibility. */
  var TYPES = ['text', 'longtext', 'email', 'tel', 'number', 'date', 'link', 'choice', 'list'];

  /** Types a user may pick when defining their own field. */
  var CUSTOM_TYPES = [
    { value: 'text', label: 'Short text' },
    { value: 'longtext', label: 'Long text / paragraph' },
    { value: 'number', label: 'Number' },
    { value: 'email', label: 'Email' },
    { value: 'tel', label: 'Phone' },
    { value: 'date', label: 'Date' },
    { value: 'link', label: 'Link / URL' },
    { value: 'choice', label: 'Choice (radio, checkbox, dropdown)' }
  ];

  var DEFAULT_SETTINGS = {
    autoThreshold: 0.80,        // fill without flagging at or above this score
    reviewThreshold: 0.55,      // fill but flag amber down to this score
    learnFromCorrections: true,
    highlightFilled: true,
    autoFillNewSections: false,
    showPanel: true
  };

  function defaultProfile() {
    return {
      personal: {
        fullName: '', firstName: '', lastName: '', gender: '', dob: '',
        email: '', altEmail: '', phone: '', altPhone: '',
        fatherName: '', motherName: '', bloodGroup: '', nationality: '',
        address: { line1: '', city: '', state: '', pincode: '', country: '' }
      },
      academic: {
        collegeName: '', rollNumber: '', registrationNumber: '',
        degree: '', branch: '', specialization: '',
        admissionYear: '', graduationYear: '', currentSemester: '',
        cgpa: '', degreePercentage: '',
        tenthPercent: '', tenthBoard: '', tenthYear: '',
        twelfthPercent: '', twelfthBoard: '', twelfthYear: '',
        activeBacklogs: '', totalBacklogs: '', yearGap: ''
      },
      professional: {
        skills: [], experienceYears: '', internships: '', certifications: '',
        achievements: '', careerObjective: '', currentCTC: '', expectedCTC: '',
        noticePeriod: '', preferredLocations: []
      },
      projects: [],
      links: {
        linkedin: '', github: '', portfolio: '', resumeUrl: '',
        leetcode: '', hackerrank: '', codechef: ''
      },
      custom: []
    };
  }

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      profile: defaultProfile(),
      mappings: {},
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      lastRun: null
    };
  }

  // ---------------------------------------------------------------------------
  // Value formatting
  // ---------------------------------------------------------------------------

  var FORMATTERS = {
    text: function (v) { return N.squash(v); },
    longtext: function (v) { return String(v == null ? '' : v).trim(); },
    email: function (v) { return N.squash(v); },
    number: function (v) { return N.squash(v); },
    choice: function (v) { return N.squash(v); },
    date: function (v) { return N.squash(v); },
    tel: function (v) {
      // Keep a leading "+" and the digits; drop the spaces, dashes and brackets that
      // trip up forms with a numeric validation rule.
      var s = N.squash(v);
      var plus = s.charAt(0) === '+' ? '+' : '';
      return plus + s.replace(/\D/g, '');
    },
    link: function (v) {
      var s = N.squash(v);
      if (!s) return '';
      return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s.replace(/^\/+/, '');
    },
    list: function (v) {
      if (Array.isArray(v)) return v.filter(Boolean).join(', ');
      return N.squash(v);
    }
  };

  /** Render the projects array into a readable block for a paragraph question. */
  function formatProjects(projects) {
    if (!Array.isArray(projects) || !projects.length) return '';
    return projects.map(function (p, i) {
      var lines = [(i + 1) + '. ' + (p.title || 'Project')];
      if (p.techStack) lines.push('   Tech: ' + p.techStack);
      if (p.description) lines.push('   ' + String(p.description).replace(/\s*\n\s*/g, ' '));
      if (p.link) lines.push('   ' + p.link);
      return lines.join('\n');
    }).join('\n\n');
  }

  /** Read a dotted path out of an object without throwing on missing intermediates. */
  function getByPath(obj, path) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /** Write a dotted path, creating intermediate objects as needed. */
  function setByPath(obj, path, value) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  }

  // ---------------------------------------------------------------------------
  // Built-in field registry
  // ---------------------------------------------------------------------------

  function f(key, label, type, group, synonyms, extra) {
    var field = {
      key: key, label: label, type: type, group: group,
      synonyms: synonyms, isCustom: false
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) field[k] = extra[k];
    return field;
  }

  var BUILTIN_FIELDS = [
    // --- Personal -----------------------------------------------------------
    f('personal.fullName', 'Full Name', 'text', 'Personal',
      ['full name', 'name', 'candidate name', 'student name', 'applicant name',
       'name of the candidate', 'name of student', 'name as per aadhaar',
       'name as per marksheet', 'complete name']),
    f('personal.firstName', 'First Name', 'text', 'Personal',
      ['first name', 'given name']),
    f('personal.lastName', 'Last Name', 'text', 'Personal',
      ['last name', 'surname', 'family name']),
    f('personal.gender', 'Gender', 'choice', 'Personal',
      ['gender', 'sex']),
    f('personal.dob', 'Date of Birth', 'date', 'Personal',
      ['date of birth', 'birth date', 'birthday', 'born on']),
    f('personal.email', 'Email Address', 'email', 'Personal',
      ['email', 'email address', 'email id', 'personal email', 'mail id',
       'gmail', 'gmail id', 'contact email', 'official email']),
    f('personal.altEmail', 'Alternate Email', 'email', 'Personal',
      ['alternate email', 'alternative email', 'secondary email', 'other email',
       'college email', 'institute email']),
    f('personal.phone', 'Mobile Number', 'tel', 'Personal',
      ['mobile number', 'phone number', 'contact number', 'mobile', 'phone',
       'contact', 'whatsapp number', 'cell number', 'primary contact number',
       'active mobile number', 'personal contact number']),
    f('personal.altPhone', 'Alternate Mobile Number', 'tel', 'Personal',
      ['alternate mobile number', 'alternate phone number', 'secondary contact number',
       'emergency contact number', 'parent contact number', 'guardian contact number',
       'alternate contact number']),
    f('personal.fatherName', "Father's Name", 'text', 'Personal',
      ['father name', 'fathers name', 'parent name', 'guardian name']),
    f('personal.motherName', "Mother's Name", 'text', 'Personal',
      ['mother name', 'mothers name']),
    f('personal.bloodGroup', 'Blood Group', 'choice', 'Personal',
      ['blood group', 'blood type']),
    f('personal.nationality', 'Nationality', 'text', 'Personal',
      ['nationality', 'citizenship']),
    f('personal.address.line1', 'Address', 'longtext', 'Personal',
      ['address', 'current address', 'residential address', 'permanent address',
       'postal address', 'communication address', 'street address', 'full address']),
    f('personal.address.city', 'City', 'text', 'Personal',
      ['city', 'town', 'current city', 'city of residence', 'hometown']),
    f('personal.address.state', 'State', 'text', 'Personal',
      ['state', 'province', 'home state']),
    f('personal.address.pincode', 'Pincode', 'number', 'Personal',
      ['pincode', 'pin code', 'postal code', 'zip code', 'zip']),
    f('personal.address.country', 'Country', 'text', 'Personal',
      ['country']),

    // --- Academic -----------------------------------------------------------
    f('academic.collegeName', 'College / Institute Name', 'text', 'Academic',
      ['college name', 'institute name', 'university name', 'college',
       'institution name', 'name of college', 'name of institute', 'school name']),
    f('academic.rollNumber', 'Roll Number', 'text', 'Academic',
      ['roll number', 'university roll number', 'college roll number',
       'student id', 'student number', 'enrollment number', 'enrolment number']),
    f('academic.registrationNumber', 'Registration Number', 'text', 'Academic',
      ['registration number', 'university registration number', 'admission number',
       'usn', 'prn']),
    f('academic.degree', 'Degree / Course', 'choice', 'Academic',
      ['degree', 'course', 'qualification', 'programme', 'program',
       'degree program', 'highest qualification', 'course name',
       'degree pursuing', 'current course']),
    f('academic.branch', 'Branch / Department', 'choice', 'Academic',
      ['branch', 'department', 'stream', 'discipline', 'engineering branch',
       'branch of study']),
    f('academic.specialization', 'Specialization', 'text', 'Academic',
      ['specialization', 'major', 'area of specialization', 'sub branch']),
    f('academic.admissionYear', 'Year of Admission', 'number', 'Academic',
      ['year of admission', 'admission year', 'joining year', 'year of joining',
       'batch start year']),
    f('academic.graduationYear', 'Year of Graduation', 'number', 'Academic',
      ['year of graduation', 'graduation year', 'year of passing', 'passing year',
       'passout year', 'batch', 'expected graduation year', 'completion year']),
    f('academic.currentSemester', 'Current Semester', 'number', 'Academic',
      ['current semester', 'semester', 'sem', 'present semester', 'current year of study']),
    f('academic.cgpa', 'CGPA', 'number', 'Academic',
      ['cgpa', 'current cgpa', 'aggregate cgpa', 'overall cgpa', 'cgpa till date',
       'graduation cgpa', 'degree cgpa']),
    f('academic.degreePercentage', 'Degree Percentage', 'number', 'Academic',
      ['degree percentage', 'graduation percentage', 'aggregate percentage',
       'undergraduate percentage', 'overall percentage', 'btech percentage']),
    f('academic.tenthPercent', '10th Percentage', 'number', 'Academic',
      ['tenth percentage', 'class tenth percentage', 'tenth aggregate',
       'matriculation percentage', 'tenth cgpa', 'tenth result', 'tenth']),
    f('academic.tenthBoard', '10th Board', 'text', 'Academic',
      ['tenth board', 'class tenth board', 'board of tenth']),
    f('academic.tenthYear', '10th Passing Year', 'number', 'Academic',
      ['tenth graduation year', 'tenth year', 'year of tenth']),
    f('academic.twelfthPercent', '12th Percentage', 'number', 'Academic',
      ['twelfth percentage', 'class twelfth percentage', 'twelfth aggregate',
       'intermediate percentage', 'diploma percentage', 'twelfth result', 'twelfth']),
    f('academic.twelfthBoard', '12th Board', 'text', 'Academic',
      ['twelfth board', 'class twelfth board', 'board of twelfth']),
    f('academic.twelfthYear', '12th Passing Year', 'number', 'Academic',
      ['twelfth graduation year', 'twelfth year', 'year of twelfth']),
    f('academic.activeBacklogs', 'Active Backlogs', 'number', 'Academic',
      ['active backlogs', 'current backlogs', 'live backlogs', 'standing arrears',
       'number of backlogs', 'backlogs', 'active arrears', 'current arrears']),
    f('academic.totalBacklogs', 'Total Backlogs (History)', 'number', 'Academic',
      ['total backlogs', 'backlog history', 'history of arrears', 'total arrears',
       'past backlogs', 'cleared backlogs']),
    f('academic.yearGap', 'Gap in Education', 'text', 'Academic',
      ['year gap', 'education gap', 'gap years', 'gap in education',
       'academic gap', 'break in education']),

    // --- Professional -------------------------------------------------------
    f('professional.skills', 'Skills', 'list', 'Professional',
      ['skills', 'technical skills', 'key skills', 'skill set', 'technologies',
       'tech stack', 'programming languages', 'areas of expertise', 'core competencies',
       'technologies known', 'languages known']),
    f('professional.experienceYears', 'Years of Experience', 'number', 'Professional',
      ['years of experience', 'total experience', 'work experience in year',
       'experience in year', 'relevant experience']),
    f('professional.internships', 'Internships', 'longtext', 'Professional',
      ['internship', 'internship details', 'internships done', 'work experience details',
       'previous experience', 'industrial training']),
    f('professional.certifications', 'Certifications', 'longtext', 'Professional',
      ['certifications', 'certificates', 'courses completed', 'online courses',
       'certification details']),
    f('professional.achievements', 'Achievements', 'longtext', 'Professional',
      ['achievements', 'accomplishments', 'awards', 'awards and achievements',
       'extra curricular activities', 'positions of responsibility']),
    f('professional.careerObjective', 'Career Objective / About Me', 'longtext', 'Professional',
      ['career objective', 'objective', 'about yourself', 'tell us about yourself',
       'brief about yourself', 'professional summary', 'summary',
       'why should we hire', 'introduce yourself']),
    f('professional.currentCTC', 'Current CTC', 'text', 'Professional',
      ['current ctc', 'current salary', 'present ctc', 'current package']),
    f('professional.expectedCTC', 'Expected CTC', 'text', 'Professional',
      ['expected ctc', 'expected salary', 'salary expectation', 'expected package']),
    f('professional.noticePeriod', 'Notice Period', 'text', 'Professional',
      ['notice period', 'availability to join', 'joining time']),
    f('professional.preferredLocations', 'Preferred Locations', 'list', 'Professional',
      ['preferred location', 'preferred job location', 'location preference',
       'preferred work location', 'willing to relocate to', 'job location preference']),

    // --- Projects (derived from the projects array) -------------------------
    f('projects', 'Projects', 'longtext', 'Projects',
      ['projects', 'project details', 'major projects', 'academic projects',
       'project description', 'describe your projects', 'final year project',
       'projects done', 'project work'],
      { derive: function (profile) { return formatProjects(profile.projects); } }),

    // --- Links --------------------------------------------------------------
    f('links.linkedin', 'LinkedIn Profile', 'link', 'Links',
      ['linkedin', 'linkedin profile', 'linkedin link', 'linkedin id',
       'linkedin profile link', 'linkedin username']),
    f('links.github', 'GitHub Profile', 'link', 'Links',
      ['github', 'github profile', 'github link', 'github id', 'git profile',
       'github profile link', 'github username', 'github repository link']),
    f('links.portfolio', 'Portfolio / Website', 'link', 'Links',
      ['portfolio', 'portfolio website', 'personal website', 'website',
       'portfolio link', 'personal portfolio']),
    f('links.resumeUrl', 'Resume Link', 'link', 'Links',
      ['resume link', 'resume drive link', 'cv link', 'resume url',
       'resume google drive link', 'resume', 'cv', 'drive link of resume']),
    f('links.leetcode', 'LeetCode Profile', 'link', 'Links',
      ['leetcode', 'leetcode profile', 'leetcode link', 'leetcode id',
       'leetcode username', 'leetcode profile link']),
    f('links.hackerrank', 'HackerRank Profile', 'link', 'Links',
      ['hackerrank', 'hackerrank profile', 'hackerrank link', 'hackerrank id']),
    f('links.codechef', 'CodeChef Profile', 'link', 'Links',
      ['codechef', 'codechef profile', 'codechef link', 'codechef id'])
  ];

  // ---------------------------------------------------------------------------
  // Custom fields and the effective registry
  // ---------------------------------------------------------------------------

  /** Build a fresh custom-field record from user input. */
  function makeCustomField(input) {
    var label = N.squash(input && input.label);
    var type = (input && input.type) || 'text';
    if (TYPES.indexOf(type) === -1) type = 'text';
    return {
      id: (input && input.id) || (N.slug(label) || 'field') + '-' + Date.now().toString(36),
      label: label,
      value: input && input.value != null ? input.value : '',
      type: type,
      synonyms: normalizeSynonymList(input && input.synonyms),
      enabled: input && input.enabled === false ? false : true,
      createdAt: (input && input.createdAt) || new Date().toISOString()
    };
  }

  /** Accept either an array or a comma-separated string of synonyms. */
  function normalizeSynonymList(input) {
    var list = Array.isArray(input)
      ? input
      : String(input == null ? '' : input).split(',');
    var seen = Object.create(null), out = [];
    for (var i = 0; i < list.length; i++) {
      var s = N.squash(list[i]).toLowerCase();
      if (!s || seen[s]) continue;
      seen[s] = 1;
      out.push(s);
    }
    return out;
  }

  /**
   * The effective registry: built-ins plus every enabled user-defined field.
   * Custom-field synonyms are auto-seeded from the label (see Normalize.deriveSynonyms),
   * so "LeetCode Profile Link" already matches a form asking "Your LeetCode profile"
   * without the user configuring anything.
   */
  function buildFieldRegistry(profile) {
    var registry = BUILTIN_FIELDS.slice();
    var custom = (profile && Array.isArray(profile.custom)) ? profile.custom : [];

    for (var i = 0; i < custom.length; i++) {
      var c = custom[i];
      if (!c || c.enabled === false || !N.squash(c.label)) continue;
      registry.push({
        key: 'custom.' + c.id,
        label: c.label,
        type: TYPES.indexOf(c.type) === -1 ? 'text' : c.type,
        group: 'My Fields',
        synonyms: N.deriveSynonyms(c.label).concat(normalizeSynonymList(c.synonyms)),
        isCustom: true,
        customId: c.id
      });
    }
    return registry;
  }

  /** Look up a field definition by key in an effective registry. */
  function findField(registry, key) {
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].key === key) return registry[i];
    }
    return null;
  }

  /** Raw (unformatted) stored value for a field. */
  function rawValue(profile, field) {
    if (!field) return '';
    if (typeof field.derive === 'function') return field.derive(profile);
    if (field.isCustom) {
      var custom = (profile && profile.custom) || [];
      for (var i = 0; i < custom.length; i++) {
        if (custom[i].id === field.customId) return custom[i].value;
      }
      return '';
    }
    return getByPath(profile, field.key);
  }

  /** Final string to type into a form for this field, after type formatting. */
  function readField(profile, field) {
    var raw = rawValue(profile, field);
    if (raw == null) return '';
    var fmt = FORMATTERS[field.type] || FORMATTERS.text;
    return fmt(raw);
  }

  /** True when the stored value is non-empty. */
  function hasValue(profile, field) {
    var raw = rawValue(profile, field);
    if (Array.isArray(raw)) return raw.filter(Boolean).length > 0;
    return N.squash(raw) !== '';
  }

  /**
   * Question types a field of this type may be written into. Prevents nonsense like
   * an email address landing in a date question.
   */
  var TYPE_COMPATIBILITY = {
    date: ['date', 'short'],
    email: ['short', 'longtext'],
    tel: ['short', 'longtext'],
    number: ['short', 'longtext', 'radio', 'checkbox', 'dropdown', 'scale'],
    link: ['short', 'longtext'],
    text: ['short', 'longtext', 'radio', 'checkbox', 'dropdown'],
    longtext: ['short', 'longtext'],
    choice: ['radio', 'checkbox', 'dropdown', 'short', 'longtext', 'scale'],
    list: ['short', 'longtext', 'checkbox', 'dropdown', 'radio']
  };

  function isCompatible(fieldType, questionType) {
    var allowed = TYPE_COMPATIBILITY[fieldType];
    if (!allowed) return true;
    return allowed.indexOf(questionType) !== -1;
  }

  /** Fraction of built-in fields the user has filled in, for the popup indicator. */
  function completeness(profile) {
    var registry = buildFieldRegistry(profile);
    var total = 0, filled = 0;
    for (var i = 0; i < registry.length; i++) {
      var field = registry[i];
      if (field.key === 'projects') continue; // derived, counted via the array below
      total++;
      if (hasValue(profile, field)) filled++;
    }
    return { filled: filled, total: total, percent: total ? Math.round((filled / total) * 100) : 0 };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    TYPES: TYPES,
    CUSTOM_TYPES: CUSTOM_TYPES,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    BUILTIN_FIELDS: BUILTIN_FIELDS,
    FORMATTERS: FORMATTERS,
    defaultProfile: defaultProfile,
    defaultState: defaultState,
    formatProjects: formatProjects,
    getByPath: getByPath,
    setByPath: setByPath,
    makeCustomField: makeCustomField,
    normalizeSynonymList: normalizeSynonymList,
    buildFieldRegistry: buildFieldRegistry,
    findField: findField,
    rawValue: rawValue,
    readField: readField,
    hasValue: hasValue,
    isCompatible: isCompatible,
    completeness: completeness
  };
});
