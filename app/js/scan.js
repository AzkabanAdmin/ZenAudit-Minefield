"use strict";

// The scan pipeline: connect to Analytics, walk workspaces and views, capture
// table columns and query table SQL, and optionally pull CRM Deluge function
// code. Results land in S and are cached in localStorage.

function loadOrgs() {
  clearError();
  S.orgId = null;
  var pick = $("org-pick");
  pick.disabled = true;
  pick.innerHTML = "<option>loading orgs&hellip;</option>";
  return analyticsGet("/orgs").then(function (body) {
    var orgs = (body.data && body.data.orgs) || [];
    pick.innerHTML = "";
    orgs.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.orgId; opt.textContent = o.orgName + " (" + o.orgId + ")";
      pick.appendChild(opt);
    });
    pick.disabled = false;
    saveSettings();
    if (orgs.length) return loadWorkspaces();
  }).catch(function (err) {
    showError("Could not reach Zoho Analytics through connection \"" +
      $("conn-analytics").value + "\". Check the connection link name and that it is authorized.\n" +
      String(err && err.message || err));
  });
}
$("org-pick").onchange = function () { loadWorkspaces(); };

function loadWorkspaces() {
  clearError();
  S.orgId = $("org-pick").value;
  return analyticsGet("/workspaces").then(function (body) {
    var all = ((body.data && body.data.ownedWorkspaces) || [])
      .concat((body.data && body.data.sharedWorkspaces) || []);
    S.workspaces = all.map(function (w) {
      return { workspaceId: w.workspaceId, workspaceName: w.workspaceName, selected: true };
    });
    var box = $("ws-list");
    box.innerHTML = "";
    S.workspaces.forEach(function (w, i) {
      var lab = document.createElement("label");
      lab.className = "ws-pill on";
      var cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = true;
      cb.onchange = function () {
        S.workspaces[i].selected = cb.checked;
        lab.classList.toggle("on", cb.checked);
        updateScanButton();
        renderFolderList();
      };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(w.workspaceName));
      box.appendChild(lab);
    });
    updateScanButton();
    updateSelectorVisibility();
    return loadFolders();
  }).catch(function (err) { showError(String(err && err.message || err)); });
}

// The workspace/folder pickers only matter for the reverse audit (that's
// where a mixed workspace's cross-app noise actually causes problems), so
// they stay hidden otherwise to keep the normal scan card uncluttered. A
// normal scan just covers every folder, as it always has — see
// scanAnalytics's filterByFolder.
// Selection state itself isn't reset when hidden, it still governs
// scanAnalytics() either way.
function updateSelectorVisibility() {
  var show = $("include-reverse-audit").checked;
  $("ws-section").classList.toggle("hidden", !show || !S.workspaces.length);
  renderFolderList();
}

// One workspace can mix tables from several apps (e.g. a consolidated "Zoho
// One" workspace), which confuses the reverse audit's name matching (that's
// the only place folder selection is actually applied, see scanAnalytics).
// Best-effort: if a workspace's folders can't be read, scanning it stays
// unfiltered rather than silently excluding everything. Default to only the
// CRM data folder selected, since that's the one real signal to trust
// automatically; everything else needs an explicit opt-in.
function loadFolders() {
  S.folders = [];
  return runQueue(S.workspaces, function (w) {
    return analyticsGet("/workspaces/" + w.workspaceId + "/folders").then(function (body) {
      var folders = (body.data && body.data.folders) || [];
      folders.forEach(function (f) {
        S.folders.push({
          folderId: f.folderId, folderName: f.folderName,
          wsId: w.workspaceId, wsName: w.workspaceName,
          selected: f.folderName.toLowerCase().indexOf("zoho crm modules (data)") >= 0
        });
      });
    }).catch(function () { /* best-effort; that workspace just scans unfiltered */ });
  }).then(renderFolderList);
}

function renderFolderList() {
  var section = $("folder-section");
  var show = $("include-reverse-audit").checked;
  var visible = S.folders.filter(function (f) {
    var ws = S.workspaces.filter(function (w) { return w.workspaceId === f.wsId; })[0];
    return ws && ws.selected;
  }).sort(function (a, b) { return (b.selected ? 1 : 0) - (a.selected ? 1 : 0); });
  if (!show || !visible.length) { section.classList.add("hidden"); return; }
  section.classList.remove("hidden");
  var box = $("folder-list");
  box.innerHTML = "";
  visible.forEach(function (f) {
    var lab = document.createElement("label");
    lab.className = "ws-pill" + (f.selected ? " on" : "");
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = f.selected;
    cb.onchange = function () {
      f.selected = cb.checked;
      lab.classList.toggle("on", cb.checked);
      renderFolderList();
    };
    lab.appendChild(cb);
    lab.appendChild(document.createTextNode(f.wsName + " / " + f.folderName));
    box.appendChild(lab);
  });
}

// Only filters a workspace's views if we actually have folder data for it;
// an unread folder list or an unrecognized folderId never blocks scanning.
function folderAllowed(wsId, folderId) {
  var wsFolders = S.folders.filter(function (f) { return f.wsId === wsId; });
  if (!wsFolders.length) return true;
  var match = wsFolders.filter(function (f) { return f.folderId === folderId; })[0];
  return match ? match.selected : true;
}

function selectedWorkspaces() {
  return S.workspaces.filter(function (w) { return w.selected; });
}

// Source toggle tiles: keep the tile styling in sync and refresh the button
["include-an", "include-fns", "include-reports", "include-workflows"].forEach(function (id) {
  var cb = $(id);
  cb.onchange = function () {
    cb.closest(".src-tile").classList.toggle("on", cb.checked);
    updateScanButton();
  };
});

// The reverse audit is a different operation (Analytics -> CRM instead of
// CRM -> Analytics) that runs standalone; selecting it locks out the normal
// scan sources rather than combining with them.
$("include-reverse-audit").onchange = function () {
  var cb = $("include-reverse-audit");
  var exclusive = cb.checked;
  ["include-an", "include-fns", "include-reports", "include-workflows"].forEach(function (id) {
    var other = $(id);
    other.disabled = exclusive;
    other.closest(".src-tile").classList.toggle("disabled-tile", exclusive);
    if (exclusive && other.checked) {
      other.checked = false;
      other.dispatchEvent(new Event("change"));
    }
  });
  cb.closest(".src-tile").classList.toggle("on", cb.checked);
  updateScanButton();
  updateSelectorVisibility();
};

// The scan button reads as "Scan 2 sources · 4 workspaces" and stays
// disabled until at least one runnable source is ready. In reverse-audit
// mode it reads "Run reverse audit · N workspaces" instead.
function updateScanButton() {
  var btn = $("btn-scan");
  var ws = selectedWorkspaces().length;
  if ($("include-reverse-audit").checked) {
    btn.textContent = "Run reverse audit" + (ws ? " · " + ws + (ws === 1 ? " workspace" : " workspaces") : "");
    btn.disabled = !!(S.scanning || !S.sdkReady || !ws);
    return;
  }
  var an = $("include-an").checked, fns = $("include-fns").checked,
    reports = $("include-reports").checked, workflows = $("include-workflows").checked;
  var srcs = (an ? 1 : 0) + (fns ? 1 : 0) + (reports ? 1 : 0) + (workflows ? 1 : 0);
  var label = "Scan " + srcs + (srcs === 1 ? " source" : " sources");
  if (an) label += " · " + ws + (ws === 1 ? " workspace" : " workspaces");
  btn.textContent = srcs ? label : "Scan";
  btn.disabled = !!(S.scanning || !S.sdkReady || !srcs || (an && !ws));
}

// The scan only needs deep details for Tables (their columns carry the
// columnIds used by the dependents API) and Query Tables (their SQL).
// Everything else is reached through Zoho's own dependency engine.
$("btn-scan").onclick = function () {
  clearError();

  if ($("include-reverse-audit").checked) {
    var wsTargets = selectedWorkspaces();
    if (!wsTargets.length) { showError("Select at least one workspace."); return; }
    S.scanning = true;
    $("btn-scan").disabled = true;
    $("scan-progress").classList.remove("done");
    S.tables = []; S.queryTables = []; S.viewCount = 0; S.depCache = {};
    scanAnalytics(wsTargets, true).then(function () {
      S.scannedAt = new Date().toLocaleString();
      return runReverseAudit();
    }).then(function () {
      S.scanning = false;
      hideLoader();
      updateScanButton();
      $("setup-card").classList.add("collapsed");
      var t = $("btn-toggle-setup");
      t.classList.remove("hidden");
      t.textContent = "Settings";
      $("results").classList.add("hidden");
      $("reverse-audit-card").classList.remove("hidden");
    }).catch(function (err) {
      S.scanning = false;
      hideLoader();
      updateScanButton();
      showError(String(err && err.message || err));
    });
    return;
  }

  var doAn = $("include-an").checked, doFns = $("include-fns").checked,
    doReports = $("include-reports").checked, doWorkflows = $("include-workflows").checked;
  if (!doAn && !doFns && !doReports && !doWorkflows) { showError("Turn on at least one scan source."); return; }
  var targets = doAn ? selectedWorkspaces() : [];
  if (doAn && !targets.length) { showError("Select at least one workspace."); return; }
  S.scanning = true;
  S.analyticsScanned = doAn;
  $("btn-scan").disabled = true;
  $("scan-progress").classList.remove("done");
  S.tables = []; S.queryTables = []; S.viewCount = 0; S.depCache = {}; S.results = {};

  (doAn ? scanAnalytics(targets) : Promise.resolve()).then(function () {
    return doFns ? scanFunctions() : null;
  }).then(function () {
    return doReports ? scanReports() : null;
  }).then(function () {
    return doWorkflows ? scanWorkflowFieldUpdates() : null;
  }).then(function () {
    return doWorkflows ? scanWorkflowRules() : null;
  }).then(function () {
    return doWorkflows ? scanScoringRules() : null;
  }).then(function () {
    return doWorkflows ? scanBlueprints() : null;
  }).then(function () {
    return doWorkflows ? scanWebhooks() : null;
  }).then(function () {
    return doWorkflows ? scanConnectedWorkflows() : null;
  }).then(function () {
    S.scannedAt = new Date().toLocaleString();
    try {
      localStorage.setItem(SCAN_KEY, JSON.stringify({
        at: S.scannedAt, orgId: S.orgId, dc: $("dc").value,
        tables: S.tables, queryTables: S.queryTables, viewCount: S.viewCount, analyticsScanned: S.analyticsScanned,
        functions: S.functions, functionsScanned: S.functionsScanned,
        reports: S.reports, reportsScanned: S.reportsScanned, reportsSkippedStale: S.reportsSkippedStale,
        workflowFieldUpdates: S.workflowFieldUpdates, workflowFieldUpdatesScanned: S.workflowFieldUpdatesScanned,
        workflowRules: S.workflowRules, workflowRulesScanned: S.workflowRulesScanned,
        scoringRules: S.scoringRules, scoringRulesScanned: S.scoringRulesScanned,
        blueprintFields: S.blueprintFields, blueprintFieldsScanned: S.blueprintFieldsScanned,
        webhookActions: S.webhookActions, webhookActionsScanned: S.webhookActionsScanned,
        connectedWorkflowRules: S.connectedWorkflowRules, connectedWorkflowRulesScanned: S.connectedWorkflowRulesScanned
      }));
    } catch (e) { /* cache is best-effort */ }
    finishScan();
  }).catch(function (err) {
    S.scanning = false;
    hideLoader();
    updateScanButton();
    showError(String(err && err.message || err));
  });
};

// A year's worth of unused reports can be hundreds of detail calls, so this
// filters to recently-accessed ones before fetching detail at all, not after.
// Confirmed against a real list response: every report carries last_run_date,
// null when it's never been run. If it has been run, that's the real signal
// (within the past year). If it's never been run, fall back to created_time:
// a never-run report created over 6 months ago is treated as stale and
// skipped, a newer never-run one still gets a look since it just hasn't had
// time to be run yet. If neither date is usable at all, there's nothing to
// judge recency by, so it's skipped too.
var REPORT_RECENCY_DAYS = 365;
var REPORT_NEW_GRACE_DAYS = 180;
function withinDays(dateStr, days) {
  if (!dateStr) return null;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) <= days * 24 * 60 * 60 * 1000;
}
function wasRecentlyAccessed(r) {
  var ranRecently = withinDays(r.last_run_date, REPORT_RECENCY_DAYS);
  if (ranRecently !== null) return ranRecently;
  var createdRecently = withinDays(r.created_time, REPORT_NEW_GRACE_DAYS);
  if (createdRecently !== null) return createdRecently;
  return false;
}

// The list endpoint below (/crm/v8/Reports) is a best-effort guess, only the
// detail endpoint (/crm/v8/Reports/{id}) has been confirmed from a real
// network capture. If this comes back empty on a real org, check the
// network tab for the actual list call and fix the path here.
function scanReports() {
  S.reports = []; S.reportsScanned = false;
  $("scan-progress").innerHTML = "Listing CRM reports&hellip;";
  showLoader("Listing CRM reports...");
  var failures = 0;
  return crmGet("/Reports").then(function (body) {
    var all = (body && (body.reports || body.Reports)) || [];
    var list = all.filter(wasRecentlyAccessed);
    var listed = list.length;
    S.reportsSkippedStale = all.length - list.length;
    return runQueue(list, function (r) {
      return crmGet("/Reports/" + r.id).then(function (detail) {
        var full = (detail && detail.Reports && detail.Reports[0]) || detail;
        if (!full) { failures++; return; }
        S.reports.push({
          id: full.id, name: full.name,
          folderName: (full.folder && full.folder.name) || "",
          moduleApiName: full.module && full.module.api_name,
          joins: (full.joins || []).map(function (j) {
            return { relation: j.relation, moduleApiName: j.module && j.module.api_name };
          }),
          refs: extractReportFieldRefs(full)
        });
      }).catch(function () { failures++; });
    }, function (i, n, r) {
      $("scan-progress").innerHTML = "Reading report <b>" + i + " / " + n + "</b> - " + esc(r.display_name || r.name || "");
      showLoader("Reading report " + i + " / " + n, n ? i / n : null);
    }).then(function () {
      S.reportsScanned = true;
      if (failures > 0) {
        showError("Read " + S.reports.length + " of " + listed + " CRM reports." +
          (S.reports.length === 0 ? " None were readable, so report matching is inactive." : ""));
      }
    });
  }).catch(function (err) {
    showError("Reports scan failed. Check the \"" + $("conn-crm").value +
      "\" connection and its ZohoCRM.settings.reports.READ scope.\n" + String(err && err.message || err));
  });
}

// Walks a report's columns and filters (recursively through nested filter
// groups, plus the separate date_filter) collecting every field reference.
// Scoped to columns + filters only, by design; group_by/sort_by/aggregate
// functions/territory_filter aren't included.
function extractReportFieldRefs(report) {
  var refs = [];
  (report.columns || []).forEach(function (c) {
    if (c.field && c.field.api_name) refs.push({ apiName: c.field.api_name, kind: "column" });
  });
  function walkFilter(f, kind) {
    if (!f) return;
    if (f.group && f.group.length) { f.group.forEach(function (g) { walkFilter(g, kind); }); return; }
    if (f.field && f.field.api_name) refs.push({ apiName: f.field.api_name, kind: kind });
  }
  walkFilter(report.filters, "filter");
  walkFilter(report.date_filter, "date filter");
  return refs;
}

// Zoho's criteria tree (used for both a rule's trigger criteria and its
// firing conditions, see config-workflow.html) nests as {group_operator,
// group: [...]}, bottoming out at {field: {api_name}, comparator, value}.
// The Edit trigger's "specific fields" checkbox list (vs. a real value
// comparison) reuses this exact same tree, just with comparator/value set to
// the sentinel "${ANYVALUE}" - confirmed against a live rule, not guessed -
// so no separate handling is needed for it. relational_criteria (comparing
// against another module's field rather than a literal value) isn't walked,
// same deliberate scoping choice as extractReportFieldRefs skipping
// group_by/aggregate.
function walkCriteriaGroup(node, refs) {
  if (!node) return;
  if (node.group && node.group.length) { node.group.forEach(function (g) { walkCriteriaGroup(g, refs); }); return; }
  if (node.field && node.field.api_name) refs.push(node.field.api_name);
}

// A rule's own criteria for firing (execute_when.details.criteria) is
// distinct from the module-wide "when to fire" condition list (conditions[]
// .criteria_details.criteria) - kept as two separate reference lists so a
// field can be flagged as "used as a trigger" separately from "used in
// firing criteria," per your call.
function extractTriggerFieldRefs(rule) {
  var refs = [];
  walkCriteriaGroup(rule.execute_when && rule.execute_when.details && rule.execute_when.details.criteria, refs);
  return refs;
}
function extractConditionFieldRefs(rule) {
  var refs = [];
  (rule.conditions || []).forEach(function (c) {
    walkCriteriaGroup(c.criteria_details && c.criteria_details.criteria, refs);
  });
  return refs;
}

function scanWorkflowRules() {
  S.workflowRules = []; S.workflowRulesScanned = false;
  $("scan-progress").innerHTML = "Listing CRM workflow rules&hellip;";
  showLoader("Listing CRM workflow rules...");
  var failures = 0;
  function listPage(page, all) {
    return crmGet("/settings/automation/workflow_rules?page=" + page + "&per_page=200").then(function (body) {
      all = all.concat((body && body.workflow_rules) || []);
      var info = body && body.info;
      return (info && info.more_records) ? listPage(page + 1, all) : all;
    });
  }
  return listPage(1, []).then(function (list) {
    var listed = list.length;
    return runQueue(list, function (rule) {
      return crmGet("/settings/automation/workflow_rules/" + rule.id).then(function (detail) {
        var full = (detail && detail.workflow_rules && detail.workflow_rules[0]) || detail;
        if (!full || !full.module) { failures++; return; }
        S.workflowRules.push({
          id: full.id, name: full.name, moduleApiName: full.module.api_name, moduleId: full.module.id,
          triggerFields: extractTriggerFieldRefs(full),
          criteriaFields: extractConditionFieldRefs(full)
        });
      }).catch(function () { failures++; });
    }, function (i, n, rule) {
      $("scan-progress").innerHTML = "Reading workflow rule <b>" + i + " / " + n + "</b> - " + esc(rule.name || "");
      showLoader("Reading workflow rule " + i + " / " + n, n ? i / n : null);
    }).then(function () {
      S.workflowRulesScanned = true;
      if (failures > 0) {
        showError("Read " + S.workflowRules.length + " of " + listed + " workflow rules." +
          (S.workflowRules.length === 0 ? " None were readable, so workflow trigger/criteria matching is inactive." : ""));
      }
    });
  }).catch(function (err) {
    showError("Workflow rules scan failed (field update matching is unaffected). Check the \"" + $("conn-crm").value +
      "\" connection and its ZohoCRM.settings.workflow_rules.READ scope.\n" + String(err && err.message || err));
  });
}

// Unlike workflow rules, the scoring rules LIST endpoint already embeds each
// rule's full field_rules[].criteria tree, so no per-rule detail fetch is
// needed here. signal_rules (email opens/clicks) are a parallel, non-field
// scoring mechanism and are intentionally not extracted.
function extractScoringFieldRefs(rule) {
  var refs = [];
  (rule.field_rules || []).forEach(function (fr) { walkCriteriaGroup(fr.criteria, refs); });
  return refs;
}
function scanScoringRules() {
  S.scoringRules = []; S.scoringRulesScanned = false;
  $("scan-progress").innerHTML = "Listing CRM scoring rules&hellip;";
  showLoader("Listing CRM scoring rules...");
  function listPage(page, all) {
    return crmGet("/settings/automation/scoring_rules?page=" + page + "&per_page=200").then(function (body) {
      ((body && body.scoring_rules) || []).forEach(function (rule) {
        if (!rule.module) return;
        all.push({
          id: rule.id, name: rule.name, moduleApiName: rule.module.api_name, moduleId: rule.module.id,
          criteriaFields: extractScoringFieldRefs(rule)
        });
      });
      var info = body && body.info;
      return (info && info.more_records) ? listPage(page + 1, all) : all;
    });
  }
  return listPage(1, []).then(function (all) {
    S.scoringRules = all;
    S.scoringRulesScanned = true;
  }).catch(function (err) {
    showError("Scoring rules scan failed (other automation matching is unaffected). Check the \"" + $("conn-crm").value +
      "\" connection and its ZohoCRM.settings.scoring_rules.READ scope.\n" + String(err && err.message || err));
  });
}

// The Blueprints list endpoint gives each blueprint's single governing
// process field directly (e.g. the "Status" picklist driving the flow), no
// per-blueprint detail fetch needed. Per-transition mandatory fields
// (during_inputs) and per-transition criteria aren't included here: that API
// requires already knowing transition IDs with no documented way to
// enumerate them, so that finer-grained piece isn't buildable right now.
function scanBlueprints() {
  S.blueprintFields = []; S.blueprintFieldsScanned = false;
  $("scan-progress").innerHTML = "Listing CRM blueprints&hellip;";
  showLoader("Listing CRM blueprints...");
  function listPage(page, all) {
    return crmGet("/settings/blueprints?page=" + page + "&per_page=200").then(function (body) {
      ((body && body.blueprints) || []).forEach(function (bp) {
        if (!bp.module || !bp.field) return;
        all.push({
          id: bp.id, name: bp.name, moduleApiName: bp.module.api_name, moduleId: bp.module.id,
          fieldApiName: bp.field.api_name, pipelineName: (bp.pipeline && bp.pipeline.name) || null
        });
      });
      var info = body && body.info;
      return (info && info.more_records) ? listPage(page + 1, all) : all;
    });
  }
  return listPage(1, []).then(function (all) {
    S.blueprintFields = all;
    S.blueprintFieldsScanned = true;
  }).catch(function (err) {
    showError("Blueprints scan failed (other automation matching is unaffected). Check the \"" + $("conn-crm").value +
      "\" connection and its ZohoCRM.settings.blueprint.READ scope.\n" + String(err && err.message || err));
  });
}

// Webhook parameter values embed fields as Zoho's self-describing merge-tag
// syntax ${!Module.Field}, naming both module and field explicitly, unlike a
// bare Deluge function search there's no cross-module ambiguity to guard
// against. Walks every string value anywhere in the webhook object rather
// than hardcoding each parameter location (headers, body.form_data_content,
// url, url_parameters can all carry these, confirmed against the docs), so
// nothing gets missed. Note: the module name embedded in the tag is
// whatever string Zoho's merge-tag engine renders, which can differ from a
// module's api_name for legacy-renamed modules (the same Deals/Potentials
// quirk fixed elsewhere) - there's no module id inside the tag text to
// correct for that here.
var MERGE_TAG_RE = /\$\{!([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\}/g;
function extractMergeTagFieldRefs(obj) {
  var refs = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (typeof v === "string") {
        var m;
        MERGE_TAG_RE.lastIndex = 0;
        while ((m = MERGE_TAG_RE.exec(v))) refs.push({ moduleApiName: m[1], fieldApiName: m[2] });
      } else if (v && typeof v === "object") {
        walk(v);
      }
    });
  })(obj);
  return refs;
}
function scanWebhooks() {
  S.webhookActions = []; S.webhookActionsScanned = false;
  $("scan-progress").innerHTML = "Listing CRM webhooks&hellip;";
  showLoader("Listing CRM webhooks...");
  function listPage(page, all) {
    return crmGet("/settings/automation/webhooks?page=" + page + "&per_page=200").then(function (body) {
      ((body && body.webhooks) || []).forEach(function (wh) {
        if (!wh.module) return;
        all.push({ id: wh.id, name: wh.name, moduleApiName: wh.module.api_name, fieldRefs: extractMergeTagFieldRefs(wh) });
      });
      var info = body && body.info;
      return (info && info.more_records) ? listPage(page + 1, all) : all;
    });
  }
  return listPage(1, []).then(function (all) {
    S.webhookActions = all;
    S.webhookActionsScanned = true;
  }).catch(function (err) {
    showError("Webhooks scan failed (other automation matching is unaffected). Check the \"" + $("conn-crm").value +
      "\" connection and its ZohoCRM.settings.automation_actions.READ scope.\n" + String(err && err.message || err));
  });
}

// Connected Workflows (Zoho Flow-triggered rules) use the identical
// execute_when/conditions criteria tree as regular Workflow Rules (confirmed
// against the docs), so the same walkCriteriaGroup-based extraction applies
// directly. Three-level fetch: list connected workflows, then each one's
// rules (gives trigger criteria inline, per the docs), then each rule's own
// detail (needed for firing conditions, which the rules-list response does
// not include). A rule has no name of its own, only an id, so it's labeled
// by its parent connected workflow's name (plus a rule index when a
// workflow has more than one rule).
function scanConnectedWorkflows() {
  S.connectedWorkflowRules = []; S.connectedWorkflowRulesScanned = false;
  $("scan-progress").innerHTML = "Listing connected workflows&hellip;";
  showLoader("Listing connected workflows...");
  var failures = 0;
  function listWorkflows(page, all) {
    return crmGet("/settings/connected_workflows?page=" + page + "&per_page=200").then(function (body) {
      all = all.concat((body && body.connected_workflows) || []);
      var info = body && body.info;
      return (info && info.more_records) ? listWorkflows(page + 1, all) : all;
    });
  }
  return listWorkflows(1, []).then(function (workflows) {
    return runQueue(workflows, function (cw) {
      return crmGet("/settings/connected_workflows/" + cw.id + "/rules").then(function (body) {
        var rules = (body && body.rules) || [];
        return runQueue(rules, function (rule) {
          return crmGet("/settings/connected_workflows/" + cw.id + "/rules/" + rule.id).then(function (detail) {
            var full = (detail && detail.rules && detail.rules[0]) || detail;
            var moduleObj = full && full.module;
            if (!full || !moduleObj) { failures++; return; }
            S.connectedWorkflowRules.push({
              id: full.id, name: cw.name + (rules.length > 1 ? " (rule " + (rules.indexOf(rule) + 1) + ")" : ""),
              moduleApiName: moduleObj.api_name, moduleId: moduleObj.id,
              triggerFields: extractTriggerFieldRefs(full),
              criteriaFields: extractConditionFieldRefs(full)
            });
          }).catch(function () { failures++; });
        });
      }).catch(function () { failures++; });
    }, function (i, n, cw) {
      $("scan-progress").innerHTML = "Reading connected workflow <b>" + i + " / " + n + "</b> - " + esc(cw.name || "");
      showLoader("Reading connected workflow " + i + " / " + n, n ? i / n : null);
    });
  }).then(function () {
    S.connectedWorkflowRulesScanned = true;
    if (failures > 0) {
      showError("Some connected workflow rules could not be read (other automation matching is unaffected).");
    }
  }).catch(function (err) {
    showError("Connected workflows scan failed. Check the \"" + $("conn-crm").value +
      "\" connection and its ZohoCRM.settings.connected_workflows.READ scope.\n" + String(err && err.message || err));
  });
}

// filterByFolder is only ever true for the reverse audit, which is the one
// case that actually needs it (narrowing a mixed workspace so its Analytics
// -> CRM name matching doesn't drown in unrelated apps' tables). A normal
// scan covers every folder, same as it always has: field-name matching
// doesn't care what folder a table lives in, only the reverse audit's blind
// "every column" sweep does.
function scanAnalytics(targets, filterByFolder) {
  showLoader("Listing Analytics views…");
  var detailTargets = [];
  return runQueue(targets, function (w) {
    $("scan-progress").innerHTML = "Listing views in <b>" + esc(w.workspaceName) + "</b>&hellip;";
    showLoader("Listing views in “" + w.workspaceName + "”…");
    return analyticsGet("/workspaces/" + w.workspaceId + "/views", { noOfResult: 1000 })
      .then(function (body) {
        var views = (body.data && body.data.views) || [];
        views.forEach(function (v) {
          if (filterByFolder && !folderAllowed(w.workspaceId, v.folderId)) return;
          S.viewCount++;
          if (v.viewType === "Table" || v.viewType === "QueryTable") {
            detailTargets.push({ ws: w, view: v });
          }
        });
      });
  }).then(function () {
    return runQueue(detailTargets, function (t) {
      return analyticsGet("/views/" + t.view.viewId, { withInvolvedMetaInfo: true })
        .then(function (body) {
          var d = (body.data && body.data.views) || {};
          if (t.view.viewType === "Table") {
            S.tables.push({
              wsId: t.ws.workspaceId, wsName: t.ws.workspaceName,
              viewId: t.view.viewId, viewName: t.view.viewName,
              columns: (d.columns || []).map(function (c) {
                return {
                  columnId: c.columnId, columnName: c.columnName,
                  dataType: c.dataTypeName || c.dataType || null,
                  formula: c.formulaDisplayName || ""
                };
              })
            });
          } else {
            // SQL key name is plan-dependent; take any long string under a sql/query key
            var sql = "";
            (function walk(o) {
              if (!o || typeof o !== "object") return;
              Object.keys(o).forEach(function (k) {
                if (typeof o[k] === "string" && /sql|query/i.test(k) && o[k].length > 10) sql += o[k] + "\n";
                else if (typeof o[k] === "object") walk(o[k]);
              });
            })(d);
            S.queryTables.push({
              wsId: t.ws.workspaceId, wsName: t.ws.workspaceName,
              viewId: t.view.viewId, viewName: t.view.viewName, sql: sql
            });
          }
        })
        .catch(function () { /* skip unreadable views; surfaced in totals */ });
    }, function (i, n, t) {
      $("scan-progress").innerHTML = "Reading structure <b>" + i + " / " + n + "</b> &mdash; " + esc(t.view.viewName);
      showLoader("Reading structure " + i + " / " + n, n ? i / n : null);
    });
  });
}

// Invoke without the JSON-failure check: /code returns raw file content
// whose shape through CONNECTION.invoke is not a normal JSON body.
function invokeRaw(connName, url) {
  var req = { url: url, method: "GET", param_type: 1, parameters: {}, headers: {} };
  return ZOHO.CRM.CONNECTION.invoke(connName, req);
}

// Pull script text out of whatever shape the response takes: a raw text
// body, a JSON string, or an object with the code nested under some key.
function extractCode(x) {
  if (!x) return null;
  if (typeof x === "string") {
    var t = x.trim();
    if (!t) return null;
    if (t[0] === "{" || t[0] === "[") {
      try { return extractCode(JSON.parse(t)); } catch (e) { return t; }
    }
    return t;
  }
  if (typeof x !== "object") return null;
  // Error payloads: {"code":"INVALID_TOKEN","message":...} must not pass as script
  if (x.status === "failure" || (typeof x.code === "string" && x.message)) return null;
  var keyed = [], other = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    Object.keys(o).forEach(function (k) {
      var v = o[k];
      if (typeof v === "string") {
        if (/script|code|workflow|content|response|body|file|data/i.test(k) && v.length >= 20) keyed.push(v);
        else if (v.length >= 60) other.push(v);
      } else if (typeof v === "object") walk(v);
    });
  })(x);
  var pool = keyed.length ? keyed : other;
  if (!pool.length) return null;
  return pool.sort(function (a, b) { return b.length - a.length; })[0];
}

function fetchFunctionCode(fn) {
  var conn = $("conn-crm").value.trim();
  var base = crmApiBase() + "/crm/v8/settings/functions/" + fn.id;
  return invokeRaw(conn, base + "/code").then(function (resp) {
    //==========// file downloads resolve as raw text, JSON APIs as {details:{statusMessage}}
    var payload = (resp && resp.details) ? (resp.details.statusMessage || resp.details) : resp;
    var code = extractCode(payload);
    if (code) return code;
    //==========// fall back to the single-function endpoint, whose JSON can also carry the script
    return invokeRaw(conn, base + "?source=crm").then(function (r2) {
      return extractCode(r2 && r2.details && r2.details.statusMessage) || extractCode(r2 && r2.details);
    });
  });
}

function scanFunctions() {
  S.functions = []; S.functionsScanned = false;
  $("scan-progress").innerHTML = "Listing CRM Deluge functions&hellip;";
  showLoader("Listing CRM Deluge functions…");
  var failures = 0;
  return crmGet("/settings/functions").then(function (body) {
    var fns = (body && body.functions) || [];
    var listed = fns.length;
    return runQueue(fns, function (fn) {
      return fetchFunctionCode(fn).then(function (code) {
        if (code) S.functions.push({ id: fn.id, name: fn.display_name || fn.name, code: code });
        else failures++;
      }).catch(function () { failures++; });
    }, function (i, n, fn) {
      $("scan-progress").innerHTML = "Reading function code <b>" + i + " / " + n + "</b> &mdash; " +
        esc(fn.display_name || fn.name);
      showLoader("Reading function code " + i + " / " + n, n ? i / n : null);
    }).then(function () {
      S.functionsScanned = true;
      if (failures > 0) {
        showError("Read code for " + S.functions.length + " of " + listed + " functions." +
          (S.functions.length === 0 ? " None were readable, so function matching is inactive." : ""));
      }
    });
  }).catch(function (err) {
    showError("Functions scan failed (Analytics results are unaffected). Check the \"" +
      $("conn-crm").value + "\" connection and its ZohoCRM.settings.functions.READ scope.\n" +
      String(err && err.message || err));
  });
}

// Field Update actions name their target module + field by api_name directly
// (see get-field-update.html), so unlike functionHits/reportHits this needs
// no text search, and matching by module.api_name rules out cross-module
// false positives entirely. Paginated since an org can have 200+ of these.
function scanWorkflowFieldUpdates() {
  S.workflowFieldUpdates = []; S.workflowFieldUpdatesScanned = false;
  $("scan-progress").innerHTML = "Listing CRM workflow field updates&hellip;";
  showLoader("Listing CRM workflow field updates...");
  function fetchPage(page) {
    $("scan-progress").innerHTML = "Listing CRM workflow field updates &mdash; page <b>" + page + "</b>&hellip;";
    showLoader("Listing CRM workflow field updates — page " + page + "...");
    return crmGet("/settings/automation/field_updates?page=" + page + "&per_page=200").then(function (body) {
      ((body && body.field_updates) || []).forEach(function (fu) {
        if (!fu.module || !fu.field) return;
        S.workflowFieldUpdates.push({
          id: fu.id, name: fu.name,
          moduleApiName: fu.module.api_name, moduleId: fu.module.id, fieldApiName: fu.field.api_name,
          value: fu.value, valueType: fu.type, featureType: fu.feature_type
        });
      });
      var info = body && body.info;
      if (info && info.more_records) return fetchPage(page + 1);
    });
  }
  return fetchPage(1).then(function () {
    S.workflowFieldUpdatesScanned = true;
  }).catch(function (err) {
    showError("Workflow field updates scan failed. Check the \"" + $("conn-crm").value +
      "\" connection and its ZohoCRM.settings.automation_actions.READ scope.\n" + String(err && err.message || err));
  });
}

$("btn-cache").onclick = function () {
  var c = JSON.parse(localStorage.getItem(SCAN_KEY));
  S.tables = c.tables; S.queryTables = c.queryTables; S.viewCount = c.viewCount;
  S.analyticsScanned = c.analyticsScanned != null ? !!c.analyticsScanned : (c.tables || []).length > 0;
  S.functions = c.functions || []; S.functionsScanned = !!c.functionsScanned;
  S.reports = c.reports || []; S.reportsScanned = !!c.reportsScanned;
  S.reportsSkippedStale = c.reportsSkippedStale || 0;
  S.workflowFieldUpdates = c.workflowFieldUpdates || []; S.workflowFieldUpdatesScanned = !!c.workflowFieldUpdatesScanned;
  S.workflowRules = c.workflowRules || []; S.workflowRulesScanned = !!c.workflowRulesScanned;
  S.scoringRules = c.scoringRules || []; S.scoringRulesScanned = !!c.scoringRulesScanned;
  S.blueprintFields = c.blueprintFields || []; S.blueprintFieldsScanned = !!c.blueprintFieldsScanned;
  S.webhookActions = c.webhookActions || []; S.webhookActionsScanned = !!c.webhookActionsScanned;
  S.connectedWorkflowRules = c.connectedWorkflowRules || []; S.connectedWorkflowRulesScanned = !!c.connectedWorkflowRulesScanned;
  S.orgId = c.orgId; S.scannedAt = c.at; $("dc").value = c.dc;
  finishScan();
};

function finishScan() {
  S.scanning = false;
  hideLoader();
  var colCount = S.tables.reduce(function (n, t) { return n + t.columns.length; }, 0);
  var stats = [
    "<b>" + S.viewCount + "</b> views",
    "<b>" + S.tables.length + "</b> tables (" + colCount + " columns)",
    "<b>" + S.queryTables.length + "</b> query " + (S.queryTables.length === 1 ? "table" : "tables")
  ];
  if (S.functionsScanned) stats.push("<b>" + S.functions.length + "</b> functions");
  if (S.reportsScanned) {
    stats.push("<b>" + S.reports.length + "</b> reports" +
      (S.reportsSkippedStale ? " (" + S.reportsSkippedStale + " skipped, not accessed in the past year)" : ""));
  }
  if (S.workflowFieldUpdatesScanned) stats.push("<b>" + S.workflowFieldUpdates.length + "</b> workflow field updates");
  if (S.workflowRulesScanned) stats.push("<b>" + S.workflowRules.length + "</b> workflow rules");
  if (S.scoringRulesScanned) stats.push("<b>" + S.scoringRules.length + "</b> scoring rules");
  if (S.blueprintFieldsScanned) stats.push("<b>" + S.blueprintFields.length + "</b> blueprints");
  if (S.webhookActionsScanned) stats.push("<b>" + S.webhookActions.length + "</b> webhooks");
  if (S.connectedWorkflowRulesScanned) stats.push("<b>" + S.connectedWorkflowRules.length + "</b> connected workflow rules");
  var p = $("scan-progress");
  p.classList.add("done");
  p.innerHTML = "<b>Last scan · " + esc(S.scannedAt) + "</b>" +
    "<span class='scan-stats'>" + stats.join(" · ") + "</span>";
  updateScanButton();
  $("results").classList.remove("hidden");
  $("reverse-audit-card").classList.add("hidden");
  $("setup-card").classList.add("collapsed");
  var t = $("btn-toggle-setup");
  t.classList.remove("hidden");
  t.textContent = "Settings";
  loadFields();
}
