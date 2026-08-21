"use strict";

/* **********************************************************************
 *   Field_Loading
 ********************************************************************** */

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
      return { api_name: f.api_name, label: f.field_label, type: f.data_type, custom: !!f.custom_field };
    });
    S.results = {};
    S.activeField = null;
    renderFieldList();
    $("detail-body").innerHTML = "<p class='section-note'>Select a field on the left, or run \"Check all fields\".</p>";
  });
}

/* **********************************************************************
 *   Current_Module
 ********************************************************************** */

//==========// Endpoints disagree on a module's api_name string (Deals reports as
//==========// "Potentials" from Blueprints in some orgs), but the id is consistent
//==========// everywhere, so automation matching keys off the id.
function currentModuleId() {
  var apiName = $("module-pick").value;
  var m = S.modules.filter(function (x) { return x.api_name === apiName; })[0];
  return m ? m.id : null;
}

/* **********************************************************************
 *   Analytics_Matching
 ********************************************************************** */

//==========// Columns whose normalized name equals the field's label or API name.
//==========// Tables named like primaryHint sort first and are flagged primary;
//==========// same-named columns elsewhere still get checked, labeled by table.
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

//==========// Zoho's own dependency engine, the same one behind Analytics' delete warnings
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

/* **********************************************************************
 *   Deluge_Function_Matching
 *
 *   The only heuristic source. Deluge has no dependency API, so this is a
 *   word-boundary search on the field's API name, narrowed by inferring
 *   which module each variable in the script belongs to.
 ********************************************************************** */

//==========// Tag variables Deluge itself ties to an explicit module, so a
//==========// Contacts-scoped First_Name doesn't bleed into a Leads audit. The
//==========// shorthand and invokeurl patterns are gated on this org's real module
//==========// names so ordinary list indexing (someList[0]) isn't mistaken for one.
function extractDelugeModuleVars(code) {
  var vars = {};
  var knownModules = {};
  S.modules.forEach(function (m) { knownModules[norm(m.api_name)] = m.api_name; });
  var fetchRe = /(\w+)\s*=\s*zoho\.crm\.(?:getRecordById|getRecords|searchRecords|getRelatedRecords)\s*\(\s*["']([A-Za-z0-9_]+)["']/gi;
  var writeRe = /zoho\.crm\.(?:createRecord|updateRecord)\s*\(\s*["']([A-Za-z0-9_]+)["']\s*,\s*(?:\S+\s*,\s*)?(\w+)\s*\)/gi;
  var shorthandRe = /(\w+)\s*=\s*([A-Za-z][A-Za-z0-9_]*)\s*\[/g;
  //==========// raw REST calls carry the module in the URL path: /crm/v{n}/Module
  var invokeUrlRe = /(\w+)\s*=\s*invokeurl\s*\[[\s\S]{0,300}?url\s*:\s*["'][^"']*\/crm\/v\d+\/([A-Za-z0-9_]+)/gi;
  //==========// the {"data":[...]} envelope is usually unwrapped before fields are
  //==========// read off it, so propagate the tag to whatever it unwraps into
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
  if (!fn._moduleVars) fn._moduleVars = extractDelugeModuleVars(searchableCode(fn));
  return fn._moduleVars;
}

//==========// Comments are prose, not references. A field named Name otherwise
//==========// matches every "// Name (required)" note in the org's scripts. Quoted
//==========// strings are left alone, since get("Name") and criteria strings are
//==========// both real references and both live inside quotes.
function stripDelugeComments(code) {
  var out = "", i = 0, quote = null;
  while (i < code.length) {
    var c = code[i], next = code[i + 1];
    if (quote) {
      //==========// keep the string verbatim, honouring backslash escapes
      out += c;
      if (c === "\\" && next != null) { out += next; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      //==========// leave a space so tokens either side don't fuse together
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

//==========// comment-free source, computed once per function
function searchableCode(fn) {
  if (fn._searchable == null) fn._searchable = stripDelugeComments(fn.code);
  return fn._searchable;
}

//==========// Deluge names fields by API name only: record.get("Stage"), input.Stage.
//==========// Case-sensitive on purpose: Deluge field access is, so a lowercase
//==========// get("name") provably is not a reference to a field named Name.
function fieldRefRegex(apiName, flags) {
  return new RegExp("(^|[^A-Za-z0-9_])" + escRe(apiName) + "([^A-Za-z0-9_]|$)", flags);
}

/*
 *   How strict to be depends on the field.
 *
 *   The goal is to find every occurrence of a field, so the default is to
 *   search loosely. The one thing that makes that unsafe is a generic API
 *   name, and generic names are almost entirely a standard-field problem:
 *   Name, Owner, Email, Phone. A custom field's API name is org-specific
 *   and distinctive, so GDrive_ID or Shared_Google_Folder can be searched
 *   for anywhere without dragging in prose.
 *
 *   So custom fields are searched loosely, and standard fields carry one
 *   extra requirement: the module has to be anchored somewhere in the
 *   function. A CRM API call is where a module has to be named, so that is
 *   the anchor, whether it is a zoho.crm.* call or an invokeurl REST path.
 *
 *   Either way an occurrence has to look like a name rather than prose.
 *   Deluge names a field with a complete quoted string, and that string is
 *   routinely held in a config variable before use:
 *
 *       CRM_GDrive_ID = "GDrive_ID";
 *       Update_Map.put(CRM_GDrive_ID, Folder_ID);
 *
 *   so the whole literal has to equal the API name. "Name: " and
 *   "Folder Name" are prose. Criteria clauses and the input.Stage form
 *   count as names too.
 *
 *   An occurrence is still dropped when it provably belongs to another
 *   module, such as a get through a variable tied to a different one.
 */

//==========// is the module named anywhere in a CRM API context?
function functionTouchesModule(code, currentModule, moduleVars) {
  for (var v in moduleVars) {
    if (moduleVars[v] === currentModule) return true;
  }
  if (new RegExp("zoho\\.crm\\.\\w+\\s*\\(\\s*[\"']" + escRe(currentModule) + "[\"']").test(code)) return true;
  //==========// raw REST calls carry the module in the URL path
  if (new RegExp("/crm/v\\d+/" + escRe(currentModule) + "(?![A-Za-z0-9_])").test(code)) return true;
  return false;
}

//==========// occurrences reached through a variable tied to a different module
function disprovenRefs(code, apiName, currentModule, moduleVars) {
  var out = {};
  function scan(re) {
    var m;
    while ((m = re.exec(code))) {
      var mod = moduleVars[m[1]];
      if (mod && mod !== currentModule) out[m.index + m[0].lastIndexOf(apiName)] = 1;
    }
  }
  scan(new RegExp("([A-Za-z_]\\w*)\\s*\\.\\s*(?:get|put)\\s*\\(\\s*[\"']" + escRe(apiName) + "[\"']", "g"));
  scan(new RegExp("([A-Za-z_]\\w*)\\s*\\.\\s*" + escRe(apiName) + "(?![A-Za-z0-9_])", "g"));
  return out;
}

function attributedRefs(code, field, currentModule, moduleVars) {
  var apiName = field.api_name;
  //==========// a standard field's generic name needs the module anchored first
  if (!field.custom && !functionTouchesModule(code, currentModule, moduleVars)) return [];

  var disproven = disprovenRefs(code, apiName, currentModule, moduleVars);
  var refs = [], seen = {}, m;
  function add(at) {
    if (!disproven[at] && !seen[at]) { seen[at] = 1; refs.push(at); }
  }

  //==========// a complete quoted literal equal to the API name
  var litRe = new RegExp("[\"']" + escRe(apiName) + "[\"']", "g");
  while ((m = litRe.exec(code))) add(m.index + 1);

  //==========// the unquoted dot form, input.Stage
  var dotRe = new RegExp("([A-Za-z_]\\w*)\\s*\\.\\s*" + escRe(apiName) + "(?![A-Za-z0-9_])", "g");
  while ((m = dotRe.exec(code))) add(m.index + m[0].lastIndexOf(apiName));

  //==========// a criteria clause, "(Stage:equals:Closed Won)". The colon has to be
  //==========// followed straight away by a value, which is what separates a
  //==========// criteria clause from prose like "Name: ".
  var critRe = new RegExp("[\"'(,]" + escRe(apiName) + ":(?=[^\\s:])", "g");
  while ((m = critRe.exec(code))) add(m.index + 1);

  //==========// A distinctive custom name is worth finding as a bare identifier too,
  //==========// which catches it being passed around as a variable. Standard names
  //==========// are far too common for this to be safe.
  if (field.custom) {
    var bareRe = new RegExp("(^|[^A-Za-z0-9_\.\"'])" + escRe(apiName) + "(?![A-Za-z0-9_])", "g");
    while ((m = bareRe.exec(code))) add(m.index + m[0].lastIndexOf(apiName));
  }

  refs.sort(function (a, b) { return a - b; });
  return refs;
}

function functionHits(field) {
  var hits = [];
  if (!field.api_name || field.api_name.length < 3) return hits;
  var currentModule = $("module-pick").value;
  S.functions.forEach(function (fn) {
    var code = searchableCode(fn);
    //==========// a cheap reject before the attribution work
    if (!fieldRefRegex(field.api_name, "").test(code)) return;
    var refs = attributedRefs(code, field, currentModule, delugeModuleVarsFor(fn));
    if (!refs.length) return;
    //==========// the count and snippet describe the attributed refs, nothing else
    var at = refs[0];
    hits.push({
      name: fn.name, count: refs.length,
      snippet: code.slice(Math.max(0, at - 60), at + field.api_name.length + 60).replace(/\s+/g, " ").trim()
    });
  });
  return hits;
}

/* **********************************************************************
 *   Report_Matching
 ********************************************************************** */

//==========// A ref is bare ("Achievement"), one hop through a join
//==========// ("Forecast_Name.Group_Id"), or a deeper lookup chain that can't be
//==========// resolved without a call per intermediate module. Bare and one-hop
//==========// refs are verified against the field's module; deeper ones are
//==========// reported by name and flagged unverified rather than assumed certain.
function resolveRefModule(report, parts) {
  if (parts.length === 1) return { known: true, moduleApiName: report.moduleApiName };
  if (parts.length === 2) {
    var j = (report.joins || []).filter(function (x) { return x.relation === parts[0]; })[0];
    return j ? { known: true, moduleApiName: j.moduleApiName } : { known: false, moduleApiName: null };
  }
  return { known: false, moduleApiName: null };
}

function reportHits(field) {
  if (!S.reportsScanned || !field.api_name) return [];
  var currentModule = $("module-pick").value;
  var hits = [];
  S.reports.forEach(function (r) {
    r.refs.forEach(function (ref) {
      var parts = ref.apiName.split(".");
      if (norm(parts[parts.length - 1]) !== norm(field.api_name)) return;
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

/* **********************************************************************
 *   Automation_Matching
 *
 *   Every automation source names its module and field outright, so these
 *   are exact matches rather than text searches. Two shapes cover all of
 *   them: a criteria list to search, or a single governing field.
 ********************************************************************** */

//==========// module id + membership in a criteria array (workflow, scoring, connected rules)
function criteriaMatcher(store, flag, arrayKey, map) {
  return function (field) {
    if (!S[flag] || !field.api_name) return [];
    var moduleId = currentModuleId();
    return S[store].filter(function (r) {
      return r.moduleId === moduleId && r[arrayKey].indexOf(field.api_name) >= 0;
    }).map(map);
  };
}

//==========// module id + one named field (field updates, blueprints)
function namedFieldMatcher(store, flag, map) {
  return function (field) {
    if (!S[flag] || !field.api_name) return [];
    var moduleId = currentModuleId();
    return S[store].filter(function (r) {
      return r.moduleId === moduleId && r.fieldApiName === field.api_name;
    }).map(map);
  };
}

function byIdAndName(r) { return { id: r.id, name: r.name }; }

var workflowFieldUpdateHits = namedFieldMatcher("workflowFieldUpdates", "workflowFieldUpdatesScanned",
  function (fu) {
    return { id: fu.id, name: fu.name, value: fu.value, valueType: fu.valueType, featureType: fu.featureType };
  });

var blueprintHits = namedFieldMatcher("blueprintFields", "blueprintFieldsScanned",
  function (bp) { return { id: bp.id, name: bp.name, pipelineName: bp.pipelineName }; });

var workflowTriggerHits = criteriaMatcher("workflowRules", "workflowRulesScanned", "triggerFields", byIdAndName);
var workflowCriteriaHits = criteriaMatcher("workflowRules", "workflowRulesScanned", "criteriaFields", byIdAndName);
var scoringRuleHits = criteriaMatcher("scoringRules", "scoringRulesScanned", "criteriaFields", byIdAndName);
var connectedWorkflowTriggerHits = criteriaMatcher("connectedWorkflowRules", "connectedWorkflowRulesScanned",
  "triggerFields", byIdAndName);
var connectedWorkflowCriteriaHits = criteriaMatcher("connectedWorkflowRules", "connectedWorkflowRulesScanned",
  "criteriaFields", byIdAndName);

//==========// Merge tags name the module as plain text with no id alongside, so this
//==========// is the one automation source matched on api_name instead.
function webhookHits(field) {
  if (!S.webhookActionsScanned || !field.api_name) return [];
  var currentModule = $("module-pick").value;
  return S.webhookActions.filter(function (wh) {
    return wh.fieldRefs.some(function (fr) {
      return fr.moduleApiName === currentModule && fr.fieldApiName === field.api_name;
    });
  }).map(byIdAndName);
}

//==========// matcher per SOURCES key, resolved when checkField runs
var MATCHERS = {
  functions: functionHits,
  reports: reportHits,
  workflows: workflowFieldUpdateHits,
  triggers: workflowTriggerHits,
  criteria: workflowCriteriaHits,
  scoring: scoringRuleHits,
  blueprint: blueprintHits,
  webhooks: webhookHits,
  cwTriggers: connectedWorkflowTriggerHits,
  cwCriteria: connectedWorkflowCriteriaHits
};

/* **********************************************************************
 *   Verdicts
 ********************************************************************** */

function checkField(field) {
  if (S.results[field.api_name]) return Promise.resolve(S.results[field.api_name]);
  var matches = moduleTableFirst(field);
  var result = { columns: [], sql: sqlHits(field), notSynced: matches.length === 0 };
  SOURCES.forEach(function (src) { result[src.key] = MATCHERS[src.key](field); });
  return runQueue(matches, function (m) {
    var base = { tableName: m.table.viewName, wsName: m.table.wsName, wsId: m.table.wsId,
      primary: m.primary, columnName: m.col.columnName };
    return getDependents(m).then(function (dep) {
      base.dep = dep;
      result.columns.push(base);
    }).catch(function () {
      base.dep = null; base.error = true;
      result.columns.push(base);
    });
  }).then(function () {
    S.results[field.api_name] = result;
    return result;
  });
}

function analyticsHitCount(result) {
  return result.columns.reduce(function (n, c) {
    if (!c.dep) return n;
    return n + c.dep.views.length + c.dep.customFormulas.length + c.dep.aggregateFormulas.length;
  }, 0);
}

//==========// per-source counts behind a verdict, in SOURCES order
function usageCounts(r) {
  var counts = { analytics: analyticsHitCount(r) + r.sql.length };
  SOURCES.forEach(function (src) { counts[src.key] = hitsFor(r, src).length; });
  return counts;
}

function hitCount(result) {
  return SOURCES.reduce(function (n, src) {
    return n + hitsFor(result, src).length;
  }, analyticsHitCount(result) + result.sql.length);
}

//==========// false only before anything has been scanned, when notSynced and
//==========// hitCount carry no meaning yet
function usageScanned() {
  return S.analyticsScanned || ranScans().length > 0;
}

function categoryOf(f) {
  var r = S.results[f.api_name];
  if (!r) return "unchecked";
  //==========// a CRM reference counts even when the field never reached Analytics
  if (hitCount(r) > 0) return "used";
  if (!usageScanned()) return "unchecked";
  return r.notSynced ? "na" : "clear";
}

//==========// Two flavors of safe to delete: "unused" is synced to Analytics with
//==========// nothing depending on it, "not synced" is absent from Analytics
//==========// entirely. Both already imply no CRM references, which force "used".
function naLabel() {
  return ranScans().length ? "not synced" : "not in Analytics";
}
