"use strict";

// CRM field loading plus the analysis layer: mapping fields to Analytics
// columns, fetching dependents, and computing verdicts.

function loadModules() {
  ZOHO.CRM.META.getModules().then(function (resp) {
    S.modules = (resp.modules || []).filter(function (m) {
      return m.api_supported && m.generated_type !== "linking";
    });
    var pick = $("module-pick");
    pick.innerHTML = "";
    S.modules.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.api_name; opt.textContent = m.plural_label;
      pick.appendChild(opt);
    });
    pick.onchange = loadFields;
  });
}

function loadFields() {
  var mod = $("module-pick").value;
  if (!mod) return;
  ZOHO.CRM.META.getFields({ Entity: mod }).then(function (resp) {
    S.fields = (resp.fields || []).map(function (f) {
      return { api_name: f.api_name, label: f.field_label, type: f.data_type, custom: !!f.custom_field, source: "crm" };
    });
    S.results = {};
    S.activeField = null;
    renderFieldList();
    $("detail-body").innerHTML = "<p class='section-note'>Select a field on the left, or run \"Check all fields\".</p>";
  });
}

// Distinct app+form combos found in the Creator scan, for the Step 2 picker
// when browsing Creator fields instead of CRM fields. Fields stay scoped to
// one form at a time, same as CRM fields stay scoped to one module.
function creatorFormList() {
  var seen = {}, out = [];
  S.creatorFields.forEach(function (cf) {
    var key = cf.appLabel + " — " + cf.formLabel;
    if (!seen[key]) { seen[key] = true; out.push({ key: key, label: key }); }
  });
  return out;
}

function loadCreatorFieldsForForm() {
  var key = $("module-pick").value;
  S.fields = S.creatorFields.filter(function (cf) { return (cf.appLabel + " — " + cf.formLabel) === key; })
    .map(function (cf) {
      return {
        api_name: cf.apiName, label: cf.label, type: "Creator field", custom: false,
        source: "creator", appLabel: cf.appLabel, formLabel: cf.formLabel
      };
    });
  S.results = {};
  S.activeField = null;
  renderFieldList();
  $("detail-body").innerHTML = "<p class='section-note'>Select a field on the left, or run \"Check all fields\".</p>";
}

// Step 2/3 can browse either CRM fields (against Analytics + CRM functions +
// reports, plus informational Books/Creator name matches) or Creator fields
// (against Analytics + CRM functions directly, since that relationship is
// the one that actually matters and isn't checked anywhere else). Always
// fully rebuilds the picker rather than short-circuiting on an unchanged
// mode, since it's also called after a fresh scan where the underlying
// module/form list may have changed.
function setFieldMode(mode) {
  S.fieldMode = mode;
  document.querySelectorAll("#field-mode-tabs button").forEach(function (b) {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  var pick = $("module-pick");
  pick.innerHTML = "";
  if (mode === "creator") {
    $("field-mode-label").textContent = "Creator app / form";
    creatorFormList().forEach(function (f) {
      var opt = document.createElement("option");
      opt.value = f.key; opt.textContent = f.label;
      pick.appendChild(opt);
    });
    pick.onchange = loadCreatorFieldsForForm;
    loadCreatorFieldsForForm();
  } else {
    $("field-mode-label").textContent = "Module";
    S.modules.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.api_name; opt.textContent = m.plural_label;
      pick.appendChild(opt);
    });
    pick.onchange = loadFields;
    loadFields();
  }
}
document.querySelectorAll("#field-mode-tabs button").forEach(function (b) {
  b.onclick = function () { setFieldMode(b.dataset.mode); };
});

// Columns whose normalized name equals the field's label or API name.
// Tables named like primaryHint are checked first and flagged primary;
// same-named columns in other tables still get checked, labeled by table.
function tableFirstMatches(fieldLabel, fieldApiName, primaryHint) {
  var hintNorm = norm(primaryHint);
  var wanted = {}; wanted[norm(fieldLabel)] = 1; wanted[norm(fieldApiName)] = 1;
  var matches = [];
  S.tables.forEach(function (t) {
    t.columns.forEach(function (c) {
      if (wanted[norm(c.columnName)]) {
        matches.push({ table: t, col: c, primary: norm(t.viewName).indexOf(hintNorm) >= 0 });
      }
    });
  });
  matches.sort(function (a, b) { return (b.primary ? 1 : 0) - (a.primary ? 1 : 0); });
  return matches;
}
function moduleTableFirst(field) {
  return tableFirstMatches(field.label, field.api_name, $("module-pick").selectedOptions[0].textContent);
}
// Creator fields use the same table-matching engine, primary-matched against
// the form name (Creator -> Analytics sync typically names each Analytics
// table after the form, not the app). Unlike CRM, where a same-named column
// in some other table is kept as a soft secondary signal (CRM's data model
// legitimately shows up duplicated across a few Analytics tables), Creator
// field names are often generic ("Name", "Status", "Date"), so a same-named
// column anywhere else in the account is almost always a coincidence, not a
// real relationship. Only the table actually identified as this form's own
// (primary === true) counts; everything else is discarded, not just
// deprioritized, otherwise a "Name" field over-matches every unrelated
// module or app that happens to also have a "Name" column.
function fieldTableMatches(field) {
  if (field.source === "creator") {
    return tableFirstMatches(field.label, field.api_name, field.formLabel)
      .filter(function (m) { return m.primary; });
  }
  return moduleTableFirst(field);
}

function getDependents(m) {
  if (S.depCache[m.col.columnId]) return Promise.resolve(S.depCache[m.col.columnId]);
  return analyticsGet("/workspaces/" + m.table.wsId + "/views/" + m.table.viewId +
    "/columns/" + m.col.columnId + "/dependents").then(function (body) {
    var d = body.data || {};
    var payload = {
      views: d.views || [],
      customFormulas: d.customFormulas || [],
      aggregateFormulas: d.aggregateFormulas || []
    };
    S.depCache[m.col.columnId] = payload;
    return payload;
  });
}

function sqlHits(field) {
  var hits = [];
  [field.label, field.api_name].forEach(function (needle) {
    if (!needle || needle.length < 3) return;
    var re = new RegExp("(^|[^A-Za-z0-9_])" + escRe(needle) + "([^A-Za-z0-9_]|$)", "i");
    S.queryTables.forEach(function (qt) {
      if (qt.sql && re.test(qt.sql) && !hits.some(function (h) { return h.viewId === qt.viewId; })) {
        var m = qt.sql.match(new RegExp(".{0,50}" + escRe(needle) + ".{0,50}", "i"));
        hits.push({ viewId: qt.viewId, viewName: qt.viewName, wsName: qt.wsName, wsId: qt.wsId,
                    snippet: m ? m[0].replace(/\s+/g, " ") : "" });
      }
    });
  });
  return hits;
}

// Best-effort Deluge module scoping for functionHits, so a Contacts-scoped
// First_Name reference doesn't bleed into the Leads audit just because both
// modules have a same-named field. Only field accesses through a variable
// Deluge itself ties to an explicit module can be confidently attributed:
// a getRecordById/getRecords/searchRecords/getRelatedRecords fetch, the
// var = Module[criteria] shorthand, a map later passed to createRecord/
// updateRecord, a raw invokeurl REST call with the module in the URL path
// (.../crm/v8/Deals/...), or a variable unwrapped from one of those via the
// Zoho REST envelope's .get("data"). Everything else (bare input.Field,
// record.get("Field"), or any variable we can't resolve) stays ambiguous
// and keeps today's module-agnostic behavior; this only ever REMOVES false
// positives, it never drops a real hit we can't disprove. The shorthand and
// invokeurl patterns are gated on matching one of this org's actual module
// api_names (via S.modules), specifically to avoid mistaking ordinary
// list/map indexing (someList[0]) or an unrelated URL for a module
// reference.
function extractDelugeModuleVars(code) {
  var vars = {};
  var knownModules = {};
  S.modules.forEach(function (m) { knownModules[norm(m.api_name)] = m.api_name; });
  var fetchRe = /(\w+)\s*=\s*zoho\.crm\.(?:getRecordById|getRecords|searchRecords|getRelatedRecords)\s*\(\s*["']([A-Za-z0-9_]+)["']/gi;
  var writeRe = /zoho\.crm\.(?:createRecord|updateRecord)\s*\(\s*["']([A-Za-z0-9_]+)["']\s*,\s*(?:\S+\s*,\s*)?(\w+)\s*\)/gi;
  var shorthandRe = /(\w+)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*\[/g;
  // Raw REST calls via invokeurl embed the module directly in the URL path
  // (/crm/v{n}/Module[/id]), a very common alternative to the zoho.crm.*
  // built-ins, especially in older/hand-written functions.
  var invokeUrlRe = /(\w+)\s*=\s*invokeurl\s*\[[\s\S]{0,300}?url\s*:\s*["'][^"']*\/crm\/v\d+\/([A-Za-z0-9_]+)/gi;
  // The Zoho REST envelope {"data": [...]} is almost always unwrapped into a
  // second variable before fields are read off it - propagate the tag from
  // the envelope variable to whatever it's unwrapped into.
  var unwrapRe = /(\w+)\s*=\s*(\w+)\s*\.\s*get\(\s*["']data["']\s*\)/gi;
  var m;
  while ((m = fetchRe.exec(code))) vars[m[1]] = knownModules[norm(m[2])] || m[2];
  while ((m = writeRe.exec(code))) vars[m[2]] = knownModules[norm(m[1])] || m[1];
  while ((m = shorthandRe.exec(code))) {
    var known = knownModules[norm(m[2])];
    if (known && !vars[m[1]]) vars[m[1]] = known;
  }
  while ((m = invokeUrlRe.exec(code))) {
    var knownUrl = knownModules[norm(m[2])];
    if (knownUrl) vars[m[1]] = knownUrl;
  }
  while ((m = unwrapRe.exec(code))) {
    if (vars[m[2]] && !vars[m[1]]) vars[m[1]] = vars[m[2]];
  }
  return vars;
}
function delugeModuleVarsFor(fn) {
  if (!fn._moduleVars) fn._moduleVars = extractDelugeModuleVars(fn.code);
  return fn._moduleVars;
}
// True unless every variable-qualified access of this field (var.get(...),
// var.put(...), or the var.Field shorthand) resolves to a module other than
// currentModule - i.e. false only when we can positively show the
// reference belongs elsewhere. A bare/unqualified access, or one through a
// variable we couldn't resolve, always keeps this true (see comment above).
function functionReferencesFieldForModule(code, apiName, currentModule, moduleVars) {
  var qualifiedRe = new RegExp("([A-Za-z_]\\w*)\\s*\\.\\s*(?:get\\(\\s*[\"']" + escRe(apiName) + "[\"']\\s*\\)|" +
    "put\\(\\s*[\"']" + escRe(apiName) + "[\"']|" + escRe(apiName) + "\\b)", "g");
  var sawQualified = false, sawOtherModuleOnly = true;
  var m;
  while ((m = qualifiedRe.exec(code))) {
    sawQualified = true;
    var mod = moduleVars[m[1]];
    if (!mod || mod === currentModule) sawOtherModuleOnly = false;
  }
  return !(sawQualified && sawOtherModuleOnly);
}

// Deluge scripts reference fields by API name (record.get("Stage"),
// input.Stage, criteria strings), so functions are searched on API name only.
function functionHits(field) {
  var hits = [];
  if (!field.api_name || field.api_name.length < 3) return hits;
  var re = new RegExp("(^|[^A-Za-z0-9_])" + escRe(field.api_name) + "([^A-Za-z0-9_]|$)", "i");
  var currentModule = $("module-pick").value;
  S.functions.forEach(function (fn) {
    if (!re.test(fn.code)) return;
    if (!functionReferencesFieldForModule(fn.code, field.api_name, currentModule, delugeModuleVarsFor(fn))) return;
    var count = (fn.code.match(new RegExp(escRe(field.api_name), "gi")) || []).length;
    var m = fn.code.match(new RegExp(".{0,60}" + escRe(field.api_name) + ".{0,60}", "i"));
    hits.push({ name: fn.name, count: count, snippet: m ? m[0].replace(/\s+/g, " ") : "" });
  });
  return hits;
}

// Creator field names are often generic ("Name", "Email", "Status"), so
// searching every CRM function's full text the way functionHits does would
// match on completely unrelated CRM record.get("Name") calls that have
// nothing to do with Creator. Only functions that actually touch Creator's
// Deluge task namespace (zoho.creator.*) are searched at all; a function
// that never calls into Creator can't meaningfully "use" a Creator field.
// This doesn't verify the call targets THIS field's specific app/form, just
// that the function is plausibly Creator-related, still far tighter than
// matching every function in the org.
var CREATOR_NAMESPACE_RE = /zoho\.creator\b/i;
function creatorFunctionHits(field) {
  var hits = [];
  if (!field.api_name || field.api_name.length < 3) return hits;
  var re = new RegExp("(^|[^A-Za-z0-9_])" + escRe(field.api_name) + "([^A-Za-z0-9_]|$)", "i");
  S.functions.forEach(function (fn) {
    if (!CREATOR_NAMESPACE_RE.test(fn.code)) return;
    if (!re.test(fn.code)) return;
    var count = (fn.code.match(new RegExp(escRe(field.api_name), "gi")) || []).length;
    var m = fn.code.match(new RegExp(".{0,60}" + escRe(field.api_name) + ".{0,60}", "i"));
    hits.push({ name: fn.name, count: count, snippet: m ? m[0].replace(/\s+/g, " ") : "" });
  });
  return hits;
}

// Zoho's native CRM-Books sync mapping isn't readable via API, so this is a
// name match against Books custom and standard fields, purely informational
// (see scan.js BOOKS_ENTITIES/STANDARD_BOOKS_FIELDS). Never affects hitCount/categoryOf.
function bookMatches(field) {
  if (!S.booksScanned) return [];
  var wanted = {}; wanted[norm(field.label)] = 1; wanted[norm(field.api_name)] = 1;
  return S.booksFields.filter(function (bf) {
    return wanted[norm(bf.label)] || wanted[norm(bf.apiName)];
  });
}

// Same reasoning as bookMatches: Creator's Deluge scripts aren't readable via
// the API, only form field metadata is, so this is a name match too, purely
// informational (see scan.js scanCreator). Never affects hitCount/categoryOf.
function creatorMatches(field) {
  if (!S.creatorScanned) return [];
  var wanted = {}; wanted[norm(field.label)] = 1; wanted[norm(field.api_name)] = 1;
  return S.creatorFields.filter(function (cf) {
    return wanted[norm(cf.label)] || wanted[norm(cf.apiName)];
  });
}

// A report field reference is either bare ("Achievement", on the report's
// own module), one hop through a join ("Forecast_Name.Group_Id", resolved
// via that report's joins list), or a multi-hop lookup chain
// ("Forecast_Name.Group_Id.Forecast_Group_Name") that can't be resolved to a
// module without extra API calls per intermediate module. Bare and one-hop
// references are verified against the currently checked field's module;
// anything deeper is reported by name only, flagged unverified rather than
// silently treated as equally certain.
function resolveRefModule(report, parts) {
  if (parts.length === 1) return { known: true, moduleApiName: report.moduleApiName };
  if (parts.length === 2) {
    var j = (report.joins || []).filter(function (x) { return x.relation === parts[0]; })[0];
    return j ? { known: true, moduleApiName: j.moduleApiName } : { known: false, moduleApiName: null };
  }
  return { known: false, moduleApiName: null };
}

// Report references are by api_name only, same reasoning as functionHits.
// Counts toward hitCount/categoryOf just like Analytics and function hits,
// per your call that this should behave "just like functions."
function reportHits(field) {
  if (!S.reportsScanned || !field.api_name) return [];
  var currentModule = $("module-pick").value;
  var hits = [];
  S.reports.forEach(function (r) {
    r.refs.forEach(function (ref) {
      var parts = ref.apiName.split(".");
      var tail = parts[parts.length - 1];
      if (norm(tail) !== norm(field.api_name)) return;
      var resolved = resolveRefModule(r, parts);
      if (resolved.known && resolved.moduleApiName !== currentModule) return;
      hits.push({
        reportId: r.id, reportName: r.name, folderName: r.folderName,
        kind: ref.kind, confident: resolved.known
      });
    });
  });
  return hits;
}

// Different CRM automation endpoints can disagree on a module's api_name
// string for the same module (e.g. Deals' own module.api_name comes back as
// "Deals" from Workflow Rules but "Potentials" from Blueprints in some
// orgs, confirmed against a live org, not assumed) - the module id, however,
// is consistent everywhere. All automation matching below keys off id
// instead of api_name for exactly that reason.
function currentModuleId() {
  var apiName = $("module-pick").value;
  var m = S.modules.filter(function (x) { return x.api_name === apiName; })[0];
  return m ? m.id : null;
}

// Field Update actions name their target module + field by api_name/id
// directly (Zoho's Field Update Actions API), so this is an exact match, not
// a name/regex heuristic like functionHits/reportHits. Counts toward
// hitCount/categoryOf just like functions and reports, since an exact match
// is at least as trustworthy as those.
function workflowFieldUpdateHits(field) {
  if (!S.workflowFieldUpdatesScanned || !field.api_name) return [];
  var moduleId = currentModuleId();
  return S.workflowFieldUpdates.filter(function (fu) {
    return fu.moduleId === moduleId && fu.fieldApiName === field.api_name;
  }).map(function (fu) {
    return { id: fu.id, name: fu.name, value: fu.value, valueType: fu.valueType, featureType: fu.featureType };
  });
}

// Workflow rule triggers and firing conditions are also exact module/field
// matches (see scanWorkflowRules/walkCriteriaGroup), so they count toward
// the verdict just like workflow field updates. Kept as two separate hit
// lists rather than merged, since "used as a trigger" and "used in firing
// criteria" are different things to know about a field.
function workflowTriggerHits(field) {
  if (!S.workflowRulesScanned || !field.api_name) return [];
  var moduleId = currentModuleId();
  return S.workflowRules.filter(function (r) {
    return r.moduleId === moduleId && r.triggerFields.indexOf(field.api_name) >= 0;
  }).map(function (r) { return { id: r.id, name: r.name }; });
}
function workflowCriteriaHits(field) {
  if (!S.workflowRulesScanned || !field.api_name) return [];
  var moduleId = currentModuleId();
  return S.workflowRules.filter(function (r) {
    return r.moduleId === moduleId && r.criteriaFields.indexOf(field.api_name) >= 0;
  }).map(function (r) { return { id: r.id, name: r.name }; });
}

// Scoring rules' field_rules criteria are the same exact module/field match
// as workflow triggers/criteria (see extractScoringFieldRefs).
function scoringRuleHits(field) {
  if (!S.scoringRulesScanned || !field.api_name) return [];
  var moduleId = currentModuleId();
  return S.scoringRules.filter(function (r) {
    return r.moduleId === moduleId && r.criteriaFields.indexOf(field.api_name) >= 0;
  }).map(function (r) { return { id: r.id, name: r.name }; });
}

// A blueprint has exactly one governing field (e.g. Status), not a criteria
// list, so this is a direct equality match rather than an array membership
// check like the other workflow hit types.
function blueprintHits(field) {
  if (!S.blueprintFieldsScanned || !field.api_name) return [];
  var moduleId = currentModuleId();
  return S.blueprintFields.filter(function (bp) {
    return bp.moduleId === moduleId && bp.fieldApiName === field.api_name;
  }).map(function (bp) { return { id: bp.id, name: bp.name, pipelineName: bp.pipelineName }; });
}

// Webhook merge-tags name their module as a plain string (see
// extractMergeTagFieldRefs), not an id, so unlike the other automation
// matchers this compares against the module api_name directly - it can't be
// corrected for the Deals/Potentials-style module-naming quirk since
// there's no id inside the tag text to fall back on.
function webhookHits(field) {
  if (!S.webhookActionsScanned || !field.api_name) return [];
  var currentModule = $("module-pick").value;
  return S.webhookActions.filter(function (wh) {
    return wh.fieldRefs.some(function (fr) {
      return fr.moduleApiName === currentModule && fr.fieldApiName === field.api_name;
    });
  }).map(function (wh) { return { id: wh.id, name: wh.name }; });
}

// Connected workflow triggers/criteria reuse the exact same matching as
// regular workflow rules (see scanConnectedWorkflows), just against a
// separate list since they're a distinct automation feature.
function connectedWorkflowTriggerHits(field) {
  if (!S.connectedWorkflowRulesScanned || !field.api_name) return [];
  var moduleId = currentModuleId();
  return S.connectedWorkflowRules.filter(function (r) {
    return r.moduleId === moduleId && r.triggerFields.indexOf(field.api_name) >= 0;
  }).map(function (r) { return { id: r.id, name: r.name }; });
}
function connectedWorkflowCriteriaHits(field) {
  if (!S.connectedWorkflowRulesScanned || !field.api_name) return [];
  var moduleId = currentModuleId();
  return S.connectedWorkflowRules.filter(function (r) {
    return r.moduleId === moduleId && r.criteriaFields.indexOf(field.api_name) >= 0;
  }).map(function (r) { return { id: r.id, name: r.name }; });
}

// Creator fields get the same Analytics-dependents + Deluge-function checks
// as CRM fields (that's the actual point: knowing what breaks downstream),
// just without the CRM-specific Books/Creator-name-match/Reports extras,
// which don't apply to a field that isn't itself a CRM field.
function checkField(field) {
  if (S.results[field.api_name]) return Promise.resolve(S.results[field.api_name]);
  var matches = fieldTableMatches(field);
  var result = field.source === "creator"
    ? { columns: [], sql: sqlHits(field), functions: creatorFunctionHits(field), notSynced: matches.length === 0 }
    : {
        columns: [], sql: sqlHits(field), functions: functionHits(field), books: bookMatches(field),
        creator: creatorMatches(field), reports: reportHits(field), workflows: workflowFieldUpdateHits(field),
        triggers: workflowTriggerHits(field), criteria: workflowCriteriaHits(field),
        scoring: scoringRuleHits(field), blueprint: blueprintHits(field), webhooks: webhookHits(field),
        cwTriggers: connectedWorkflowTriggerHits(field), cwCriteria: connectedWorkflowCriteriaHits(field),
        notSynced: matches.length === 0
      };
  return runQueue(matches, function (m) {
    return getDependents(m).then(function (dep) {
      result.columns.push({
        tableName: m.table.viewName, wsName: m.table.wsName, wsId: m.table.wsId, primary: m.primary,
        columnName: m.col.columnName, dep: dep
      });
    }).catch(function () {
      result.columns.push({ tableName: m.table.viewName, wsName: m.table.wsName, wsId: m.table.wsId,
        primary: m.primary, columnName: m.col.columnName, dep: null, error: true });
    });
  }).then(function () {
    S.results[field.api_name] = result;
    return result;
  });
}

function hitCount(result) {
  return result.columns.reduce(function (n, c) {
    if (!c.dep) return n;
    return n + c.dep.views.length + c.dep.customFormulas.length + c.dep.aggregateFormulas.length;
  }, 0) + result.sql.length + (result.functions || []).length + (result.reports || []).length +
    (result.workflows || []).length + (result.triggers || []).length + (result.criteria || []).length +
    (result.scoring || []).length + (result.blueprint || []).length + (result.webhooks || []).length +
    (result.cwTriggers || []).length + (result.cwCriteria || []).length;
}

// Whether this scan actually checked CRM field usage (Analytics sync, CRM
// functions, reports, or any automation source) rather than just the
// informational Books/Creator name-match sources. notSynced/hitCount only
// mean something against these.
function usageScanned() {
  return S.analyticsScanned || S.functionsScanned || S.reportsScanned ||
    S.workflowFieldUpdatesScanned || S.workflowRulesScanned ||
    S.scoringRulesScanned || S.blueprintFieldsScanned ||
    S.webhookActionsScanned || S.connectedWorkflowRulesScanned;
}

function categoryOf(f) {
  var r = S.results[f.api_name];
  if (!r) return "unchecked";
  if (hitCount(r) > 0) return "used"; // function/report hits count even when not synced to Analytics
  if (!usageScanned()) {
    // Only Books/Creator (informational, name-matched sources) were scanned:
    // there's nothing to say about Analytics sync/CRM usage, so fall back to
    // whether this field matched by name instead of mislabeling it "na".
    if (S.booksScanned || S.creatorScanned) {
      var matched = (r.books && r.books.length) || (r.creator && r.creator.length);
      return matched ? "matched" : "unmatched";
    }
    return "unchecked";
  }
  return r.notSynced ? "na" : "clear";
}

// Two flavors of safe-to-delete: green "unused" = synced to Analytics but
// nothing depends on it; gray "not synced" = absent from Analytics entirely.
// Both imply no CRM function/report/automation references (those force used).
function naLabel() {
  return (S.functionsScanned || S.reportsScanned || S.workflowFieldUpdatesScanned ||
    S.workflowRulesScanned || S.scoringRulesScanned || S.blueprintFieldsScanned ||
    S.webhookActionsScanned || S.connectedWorkflowRulesScanned)
    ? "not synced" : "not in Analytics";
}

// Mirrors naLabel for the Books/Creator-only scan case (see categoryOf).
function unmatchedLabel() {
  var parts = [];
  if (S.booksScanned) parts.push("Books");
  if (S.creatorScanned) parts.push("Creator");
  return "no " + parts.join("/") + " match";
}

function usageCounts(r) {
  var an = r.sql.length, fn = (r.functions || []).length, rpt = (r.reports || []).length,
    wf = (r.workflows || []).length, trig = (r.triggers || []).length, crit = (r.criteria || []).length,
    score = (r.scoring || []).length, bp = (r.blueprint || []).length, wh = (r.webhooks || []).length,
    cwTrig = (r.cwTriggers || []).length, cwCrit = (r.cwCriteria || []).length;
  r.columns.forEach(function (c) {
    if (!c.dep) return;
    an += c.dep.views.length + c.dep.customFormulas.length + c.dep.aggregateFormulas.length;
  });
  return { analytics: an, functions: fn, reports: rpt, workflows: wf, triggers: trig, criteria: crit,
    scoring: score, blueprint: bp, webhooks: wh, cwTriggers: cwTrig, cwCriteria: cwCrit,
    books: (r.books || []).length, creator: (r.creator || []).length };
}
