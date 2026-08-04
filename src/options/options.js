/**
 * EzApply — options page.
 *
 * The profile editor is *generated from the same field registry the matcher uses*, so a
 * field added to src/common/schema.js appears here automatically and can never drift out
 * of sync with what the extension knows how to fill.
 *
 * Everything autosaves to chrome.storage.local. No text from this page is ever inserted
 * as HTML — user data goes in through value/textContent only.
 */
(function () {
  'use strict';

  var EzApply = globalThis.EzApply;
  var Storage = EzApply.Storage;
  var Schema = EzApply.Schema;
  var N = EzApply.Normalize;

  var state = null;
  var saveTimer = null;

  var GROUP_ORDER = ['Personal', 'Academic', 'Professional', 'Links'];
  var LIST_FIELDS = { 'professional.skills': 1, 'professional.preferredLocations': 1 };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function $(id) { return document.getElementById(id); }

  function flashSaved() {
    var box = $('saveState');
    box.textContent = 'Saved';
    clearTimeout(box._t);
    box._t = setTimeout(function () { box.textContent = ''; }, 1600);
  }

  /** Debounced write of the whole state, so typing does not hammer storage. */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      Storage.setState(state).then(flashSaved).catch(function (err) {
        $('saveState').textContent = 'Save failed: ' + err.message;
      });
    }, 350);
  }

  function inputTypeFor(fieldType) {
    switch (fieldType) {
      case 'email': return 'email';
      case 'tel': return 'tel';
      case 'date': return 'date';
      default: return 'text';       // number/link/choice stay text: no spinners, no URL nagging
    }
  }

  function placeholderFor(field) {
    switch (field.type) {
      case 'link': return 'https://…';
      case 'date': return '';
      case 'number': return 'e.g. 8.6';
      default: return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Tag editor (skills, preferred locations)
  // ---------------------------------------------------------------------------

  function buildTagEditor(field) {
    var wrap = el('div', 'field wide');
    wrap.appendChild(el('label', null, field.label));

    var input = el('input');
    input.type = 'text';
    input.placeholder = 'Type and press Enter (or paste a comma-separated list)';
    wrap.appendChild(input);

    var tags = el('div', 'tags');
    wrap.appendChild(tags);

    function current() {
      var v = Schema.getByPath(state.profile, field.key);
      return Array.isArray(v) ? v : [];
    }

    function commit(list) {
      Schema.setByPath(state.profile, field.key, list);
      scheduleSave();
      renderTags();
    }

    function renderTags() {
      while (tags.firstChild) tags.removeChild(tags.firstChild);
      var list = current();
      list.forEach(function (value, i) {
        var tag = el('span', 'tag', value);
        var remove = el('button', null, '×');
        remove.type = 'button';
        remove.title = 'Remove ' + value;
        remove.addEventListener('click', function () {
          var next = current().slice();
          next.splice(i, 1);
          commit(next);
        });
        tag.appendChild(remove);
        tags.appendChild(tag);
      });
    }

    function addFromInput() {
      var parts = input.value.split(',').map(function (s) { return N.squash(s); }).filter(Boolean);
      if (!parts.length) return;
      var next = current().slice();
      parts.forEach(function (p) {
        if (next.indexOf(p) === -1) next.push(p);
      });
      input.value = '';
      commit(next);
    }

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault();
        addFromInput();
      }
    });
    input.addEventListener('blur', addFromInput);

    renderTags();
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Generated profile sections
  // ---------------------------------------------------------------------------

  function buildField(field) {
    if (LIST_FIELDS[field.key]) return buildTagEditor(field);

    var isLong = field.type === 'longtext';
    var wrap = el('div', 'field' + (isLong ? ' wide' : ''));
    wrap.appendChild(el('label', null, field.label));

    var input;
    if (isLong) {
      input = el('textarea');
    } else {
      input = el('input');
      input.type = inputTypeFor(field.type);
    }
    input.placeholder = placeholderFor(field);
    input.value = Schema.getByPath(state.profile, field.key) || '';
    input.id = 'f-' + field.key.replace(/\./g, '-');
    wrap.querySelector('label').htmlFor = input.id;

    input.addEventListener('input', function () {
      Schema.setByPath(state.profile, field.key, input.value);
      scheduleSave();
    });

    wrap.appendChild(input);
    return wrap;
  }

  function buildProfileSections() {
    var host = $('profileSections');
    while (host.firstChild) host.removeChild(host.firstChild);

    GROUP_ORDER.forEach(function (group) {
      var fields = Schema.BUILTIN_FIELDS.filter(function (f) { return f.group === group; });
      if (!fields.length) return;

      var card = el('section', 'card');
      card.id = 'section-' + group.toLowerCase();
      card.appendChild(el('h2', null, group));

      var grid = el('div', 'grid');
      fields.forEach(function (field) { grid.appendChild(buildField(field)); });
      card.appendChild(grid);

      host.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  var PROJECT_FIELDS = [
    { key: 'title', label: 'Title', long: false },
    { key: 'techStack', label: 'Tech stack', long: false },
    { key: 'link', label: 'Link', long: false },
    { key: 'duration', label: 'Duration', long: false },
    { key: 'description', label: 'Description', long: true }
  ];

  function renderProjects() {
    var host = $('projectList');
    while (host.firstChild) host.removeChild(host.firstChild);

    var list = state.profile.projects || (state.profile.projects = []);
    if (!list.length) host.appendChild(el('p', 'empty', 'No projects yet.'));

    list.forEach(function (project, index) {
      var box = el('div', 'repeat');
      var head = el('div', 'repeat-head');
      head.appendChild(el('strong', null, 'Project ' + (index + 1)));

      var remove = el('button', 'btn ghost tiny', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', function () {
        list.splice(index, 1);
        scheduleSave();
        renderProjects();
      });
      head.appendChild(remove);
      box.appendChild(head);

      var grid = el('div', 'grid');
      PROJECT_FIELDS.forEach(function (spec) {
        var field = el('div', 'field' + (spec.long ? ' wide' : ''));
        field.appendChild(el('label', null, spec.label));
        var input = spec.long ? el('textarea') : el('input');
        if (!spec.long) input.type = 'text';
        input.value = project[spec.key] || '';
        input.addEventListener('input', function () {
          project[spec.key] = input.value;
          scheduleSave();
        });
        field.appendChild(input);
        grid.appendChild(field);
      });
      box.appendChild(grid);
      host.appendChild(box);
    });
  }

  // ---------------------------------------------------------------------------
  // My Fields (user-defined)
  // ---------------------------------------------------------------------------

  function renderCustomFields() {
    var host = $('customList');
    while (host.firstChild) host.removeChild(host.firstChild);

    var list = state.profile.custom || (state.profile.custom = []);
    if (!list.length) {
      host.appendChild(el('p', 'empty',
        'None yet. You can also add one straight from a form: run EzApply, then click ' +
        '"+ Add this field" next to any question it skipped.'));
    }

    list.forEach(function (record, index) {
      host.appendChild(buildCustomRow(record, index, list));
    });
  }

  function buildCustomRow(record, index, list) {
    var box = el('div', 'repeat');

    var head = el('div', 'repeat-head');
    head.appendChild(el('strong', null, record.label || 'Untitled field'));

    var actions = el('div', 'row');

    var toggle = el('label', 'check');
    var toggleInput = el('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = record.enabled !== false;
    toggleInput.addEventListener('change', function () {
      record.enabled = toggleInput.checked;
      scheduleSave();
    });
    toggle.appendChild(toggleInput);
    toggle.appendChild(el('span', null, 'Use this'));
    actions.appendChild(toggle);

    var remove = el('button', 'btn ghost tiny', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', function () {
      list.splice(index, 1);
      // Drop any learned mappings that pointed at the field being deleted.
      var dead = 'custom.' + record.id;
      Object.keys(state.mappings).forEach(function (k) {
        if (state.mappings[k] && state.mappings[k].fieldKey === dead) delete state.mappings[k];
      });
      scheduleSave();
      renderCustomFields();
      renderMappings();
    });
    actions.appendChild(remove);
    head.appendChild(actions);
    box.appendChild(head);

    var grid = el('div', 'grid');

    // Label
    var labelField = el('div', 'field');
    labelField.appendChild(el('label', null, 'Field name'));
    var labelInput = el('input');
    labelInput.type = 'text';
    labelInput.value = record.label || '';
    labelInput.placeholder = 'e.g. LeetCode Profile Link';
    labelField.appendChild(labelInput);
    var warn = el('p', 'warn');
    labelField.appendChild(warn);
    grid.appendChild(labelField);

    // Type
    var typeField = el('div', 'field');
    typeField.appendChild(el('label', null, 'Type'));
    var typeSelect = el('select');
    Schema.CUSTOM_TYPES.forEach(function (t) {
      var option = el('option', null, t.label);
      option.value = t.value;
      if (t.value === record.type) option.selected = true;
      typeSelect.appendChild(option);
    });
    typeSelect.addEventListener('change', function () {
      record.type = typeSelect.value;
      scheduleSave();
      renderCustomFields();
    });
    typeField.appendChild(typeSelect);
    grid.appendChild(typeField);

    // Value
    var valueField = el('div', 'field wide');
    valueField.appendChild(el('label', null, 'Your answer'));
    var valueInput = record.type === 'longtext' ? el('textarea') : el('input');
    if (record.type !== 'longtext') valueInput.type = inputTypeFor(record.type);
    valueInput.value = record.value || '';
    valueInput.addEventListener('input', function () {
      record.value = valueInput.value;
      scheduleSave();
    });
    valueField.appendChild(valueInput);
    grid.appendChild(valueField);

    // Extra synonyms
    var synField = el('div', 'field wide');
    synField.appendChild(el('label', null, 'Also matches (comma separated — optional)'));
    var synInput = el('input');
    synInput.type = 'text';
    synInput.value = (record.synonyms || []).join(', ');
    synField.appendChild(synInput);
    var derived = el('p', 'hint');
    synField.appendChild(derived);
    grid.appendChild(synField);

    function refreshDerived() {
      var phrases = N.deriveSynonyms(labelInput.value);
      derived.textContent = phrases.length
        ? 'Automatically matches: ' + phrases.join(' · ')
        : '';

      var collision = Storage.findCollision(
        labelInput.value,
        Schema.buildFieldRegistry(state.profile),
        record.id
      );
      warn.textContent = collision
        ? 'Overlaps the "' + collision.field.label + '" field — consider filling that one instead.'
        : '';
    }

    labelInput.addEventListener('input', function () {
      record.label = labelInput.value;
      head.querySelector('strong').textContent = labelInput.value || 'Untitled field';
      refreshDerived();
      scheduleSave();
    });

    synInput.addEventListener('input', function () {
      record.synonyms = Schema.normalizeSynonymList(synInput.value);
      scheduleSave();
    });

    refreshDerived();
    box.appendChild(grid);
    return box;
  }

  // ---------------------------------------------------------------------------
  // Learned mappings
  // ---------------------------------------------------------------------------

  function renderMappings() {
    var host = $('mappingList');
    while (host.firstChild) host.removeChild(host.firstChild);

    var registry = Schema.buildFieldRegistry(state.profile);
    var keys = Object.keys(state.mappings || {});

    if (!keys.length) {
      host.appendChild(el('p', 'empty',
        'Nothing learned yet. Correct an answer on a form and EzApply will remember it.'));
      return;
    }

    keys.sort().forEach(function (key) {
      var mapping = state.mappings[key];
      var fieldKey = mapping && mapping.fieldKey ? mapping.fieldKey : mapping;
      var field = Schema.findField(registry, fieldKey);

      var row = el('div', 'mapping');
      row.appendChild(el('span', 'q', (mapping && mapping.label) || key));
      row.appendChild(el('span', 'arrow', '→'));
      row.appendChild(el('span', 'f', field ? field.label : String(fieldKey) + ' (missing)'));

      var remove = el('button', 'btn ghost tiny', 'Forget');
      remove.type = 'button';
      remove.addEventListener('click', function () {
        delete state.mappings[key];
        scheduleSave();
        renderMappings();
      });
      row.appendChild(remove);
      host.appendChild(row);
    });
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  var TOGGLES = ['learnFromCorrections', 'highlightFilled', 'showPanel', 'autoFillNewSections'];

  /** Bound once at boot — re-binding on every render would stack duplicate listeners. */
  function bindSettings() {
    var threshold = $('autoThreshold');
    var output = $('autoThresholdOut');

    threshold.addEventListener('input', function () {
      state.settings.autoThreshold = parseFloat(threshold.value);
      output.value = Math.round(state.settings.autoThreshold * 100) + '%';
      scheduleSave();
    });

    TOGGLES.forEach(function (key) {
      $(key).addEventListener('change', function () {
        state.settings[key] = $(key).checked;
        scheduleSave();
      });
    });
  }

  /** Pushes current values into the controls; safe to call on every render. */
  function syncSettings() {
    $('autoThreshold').value = state.settings.autoThreshold;
    $('autoThresholdOut').value = Math.round(state.settings.autoThreshold * 100) + '%';
    TOGGLES.forEach(function (key) { $(key).checked = !!state.settings[key]; });
  }

  // ---------------------------------------------------------------------------
  // Backup
  // ---------------------------------------------------------------------------

  function bindBackup() {
    $('exportBtn').addEventListener('click', function () {
      var blob = new Blob([Storage.exportJson(state)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'ezapply-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      $('backupStatus').textContent = 'Exported.';
    });

    $('importBtn').addEventListener('click', function () { $('importFile').click(); });

    $('importFile').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        Storage.importJson(String(reader.result))
          .then(function () { return Storage.getState(); })
          .then(function (next) {
            state = next;
            renderAll();
            $('backupStatus').textContent = 'Imported — your details have been replaced.';
          })
          .catch(function (err) {
            $('backupStatus').textContent = 'Import failed: ' + err.message;
          });
      };
      reader.readAsText(file);
      event.target.value = '';
    });

    $('resetBtn').addEventListener('click', function () {
      confirmAction('Erase everything?',
        'This deletes your details, your own fields and everything EzApply has learned, ' +
        'on this computer. Export a backup first if you might want it back.',
        function () {
          Storage.resetAll()
            .then(Storage.getState)
            .then(function (next) {
              state = next;
              renderAll();
              $('backupStatus').textContent = 'Everything erased.';
            });
        });
    });
  }

  function confirmAction(title, body, onConfirm) {
    var dialog = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmBody').textContent = body;

    function done() {
      dialog.removeEventListener('close', done);
      if (dialog.returnValue === 'confirm') onConfirm();
    }
    dialog.addEventListener('close', done);
    dialog.showModal();
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  function buildNav() {
    var nav = $('nav');
    while (nav.firstChild) nav.removeChild(nav.firstChild);

    var sections = GROUP_ORDER.map(function (g) {
      return { id: 'section-' + g.toLowerCase(), label: g };
    }).concat([
      { id: 'section-projects', label: 'Projects' },
      { id: 'section-myfields', label: 'My Fields' },
      { id: 'section-learned', label: 'Learned' },
      { id: 'section-settings', label: 'Settings' },
      { id: 'section-backup', label: 'Backup' }
    ]);

    // Projects sits between Professional and Links in the page order; sort the nav to
    // follow the DOM so the highlight tracks scrolling correctly.
    sections.sort(function (a, b) {
      var ea = document.getElementById(a.id), eb = document.getElementById(b.id);
      if (!ea || !eb) return 0;
      return (ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });

    sections.forEach(function (section) {
      if (!document.getElementById(section.id)) return;
      var link = el('a', null, section.label);
      link.href = '#' + section.id;
      link.dataset.target = section.id;
      nav.appendChild(link);
    });

    trackActiveSection();
  }

  function trackActiveSection() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.side a'));
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (link) {
          link.classList.toggle('active', link.dataset.target === entry.target.id);
        });
      });
    }, { rootMargin: '-90px 0px -70% 0px' });

    links.forEach(function (link) {
      var target = document.getElementById(link.dataset.target);
      if (target) observer.observe(target);
    });
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  function renderAll() {
    buildProfileSections();
    renderProjects();
    renderCustomFields();
    renderMappings();
    syncSettings();
    buildNav();
  }

  $('addProject').addEventListener('click', function () {
    (state.profile.projects || (state.profile.projects = [])).push({
      title: '', techStack: '', link: '', duration: '', description: ''
    });
    scheduleSave();
    renderProjects();
  });

  $('addCustom').addEventListener('click', function () {
    (state.profile.custom || (state.profile.custom = [])).push(
      Schema.makeCustomField({ label: '', value: '', type: 'text' })
    );
    scheduleSave();
    renderCustomFields();

    var lastRow = $('customList').querySelector('.repeat:last-of-type');
    var nameInput = lastRow && lastRow.querySelector('input[type="text"]');
    if (nameInput) { nameInput.scrollIntoView({ block: 'center' }); nameInput.focus(); }
  });

  Storage.getState().then(function (loaded) {
    state = loaded;
    renderAll();
    bindSettings();
    bindBackup();
  }).catch(function (err) {
    document.body.appendChild(el('p', 'warn', 'Could not load your details: ' + err.message));
  });
})();
