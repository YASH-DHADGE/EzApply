/**
 * EzApply — chrome.storage.local wrapper.
 *
 * Everything lives in local (not sync) storage: sync caps items at 8 KB, and a filled-in
 * projects list blows past that immediately. Export/import is therefore the backup story.
 * Nothing here ever touches the network.
 */
(function (root, factory) {
  'use strict';
  var ns = root.EzApply = root.EzApply || {};
  if (!ns.Schema && typeof require === 'function') require('./schema.js');
  ns.Storage = factory(ns.Schema, ns.Normalize);
  if (typeof module !== 'undefined' && module.exports) module.exports = ns.Storage;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Schema, N) {
  'use strict';

  var KEY = 'ezapply';

  function area() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      throw new Error('EzApply: chrome.storage is unavailable in this context.');
    }
    return chrome.storage.local;
  }

  /**
   * Fill in anything a stored state is missing. Users upgrading from an older version
   * must never lose data because a new field appeared in the schema.
   */
  function migrate(stored) {
    var fresh = Schema.defaultState();
    if (!stored || typeof stored !== 'object') return fresh;

    var state = {
      schemaVersion: Schema.SCHEMA_VERSION,
      profile: mergeDeep(fresh.profile, stored.profile || {}),
      mappings: stored.mappings && typeof stored.mappings === 'object' ? stored.mappings : {},
      settings: mergeDeep(fresh.settings, stored.settings || {}),
      lastRun: stored.lastRun || null
    };

    // Custom fields are an array of records, not a merge target.
    state.profile.custom = Array.isArray(stored.profile && stored.profile.custom)
      ? stored.profile.custom.map(Schema.makeCustomField)
      : [];
    state.profile.projects = Array.isArray(stored.profile && stored.profile.projects)
      ? stored.profile.projects
      : [];

    return state;
  }

  /** Recursive merge of plain objects; arrays and primitives from `over` win outright. */
  function mergeDeep(base, over) {
    var out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (var k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = mergeDeep(out[k], v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  }

  function getState() {
    return new Promise(function (resolve, reject) {
      try {
        area().get(KEY, function (result) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(migrate(result && result[KEY]));
        });
      } catch (err) { reject(err); }
    });
  }

  function setState(state) {
    return new Promise(function (resolve, reject) {
      var payload = {};
      payload[KEY] = state;
      try {
        area().set(payload, function () {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(state);
        });
      } catch (err) { reject(err); }
    });
  }

  function update(mutator) {
    return getState().then(function (state) {
      var next = mutator(state) || state;
      return setState(next);
    });
  }

  function saveProfile(profile) {
    return update(function (state) { state.profile = profile; return state; });
  }

  function saveSettings(settings) {
    return update(function (state) {
      state.settings = mergeDeep(state.settings, settings);
      return state;
    });
  }

  /** Record (or overwrite) a learned question-to-field mapping. */
  function saveMapping(questionLabel, fieldKey) {
    var key = N.canonical(questionLabel);
    if (!key || !fieldKey) return Promise.resolve(null);
    return update(function (state) {
      state.mappings[key] = {
        fieldKey: fieldKey,
        label: N.squash(questionLabel),
        updatedAt: new Date().toISOString()
      };
      return state;
    });
  }

  function deleteMapping(key) {
    return update(function (state) { delete state.mappings[key]; return state; });
  }

  /** Insert or update one user-defined field. Returns the saved record. */
  function saveCustomField(input) {
    var record = Schema.makeCustomField(input);
    return update(function (state) {
      var list = state.profile.custom || (state.profile.custom = []);
      var found = -1;
      for (var i = 0; i < list.length; i++) if (list[i].id === record.id) { found = i; break; }
      if (found >= 0) {
        record.createdAt = list[found].createdAt;
        list[found] = record;
      } else {
        list.push(record);
      }
      return state;
    }).then(function () { return record; });
  }

  function deleteCustomField(id) {
    return update(function (state) {
      state.profile.custom = (state.profile.custom || []).filter(function (c) { return c.id !== id; });
      // Drop any learned mappings that pointed at the field we just removed.
      var dead = 'custom.' + id;
      Object.keys(state.mappings).forEach(function (k) {
        var m = state.mappings[k];
        if ((m && m.fieldKey) === dead) delete state.mappings[k];
      });
      return state;
    });
  }

  function saveLastRun(summary) {
    return update(function (state) { state.lastRun = summary; return state; });
  }

  /**
   * Warn when a proposed custom field would compete with an existing one. Uses the same
   * scorer the matcher does rather than exact equality, so "LeetCode Profile Link" is
   * recognised as a duplicate of the built-in "LeetCode Profile" — two overlapping fields
   * would otherwise split the score and let an empty one win.
   * Returns {field, score} or null.
   */
  function findCollision(label, registry, ignoreId) {
    var Matcher = (typeof globalThis !== 'undefined' && globalThis.EzApply && globalThis.EzApply.Matcher) || null;
    var canon = N.canonical(label);
    if (!canon || !Matcher) return null;

    var question = { label: label, type: 'short', options: [] };
    var best = null;
    for (var i = 0; i < registry.length; i++) {
      var field = registry[i];
      if (ignoreId && field.customId === ignoreId) continue;
      var score = Matcher.scoreField(question, field);
      if (score >= 0.90 && (!best || score > best.score)) best = { field: field, score: score };
    }
    return best;
  }

  function exportJson(state) {
    return JSON.stringify({
      _app: 'EzApply',
      _exportedAt: new Date().toISOString(),
      schemaVersion: state.schemaVersion,
      profile: state.profile,
      mappings: state.mappings,
      settings: state.settings
    }, null, 2);
  }

  function importJson(text) {
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.profile) {
      throw new Error('That file does not look like an EzApply backup.');
    }
    return setState(migrate(parsed));
  }

  function resetAll() {
    return setState(Schema.defaultState());
  }

  return {
    KEY: KEY,
    migrate: migrate,
    mergeDeep: mergeDeep,
    getState: getState,
    setState: setState,
    update: update,
    saveProfile: saveProfile,
    saveSettings: saveSettings,
    saveMapping: saveMapping,
    deleteMapping: deleteMapping,
    saveCustomField: saveCustomField,
    deleteCustomField: deleteCustomField,
    saveLastRun: saveLastRun,
    findCollision: findCollision,
    exportJson: exportJson,
    importJson: importJson,
    resetAll: resetAll
  };
});
