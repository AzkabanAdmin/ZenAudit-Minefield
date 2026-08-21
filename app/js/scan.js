"use strict";

/* **********************************************************************
 *   Scan_Pipeline
 *
 *   Connects to Analytics, walks workspaces and views, captures table
 *   columns and query table SQL, then pulls whichever CRM sources are
 *   toggled on. Everything lands in S and is cached to localStorage.
 ********************************************************************** */

/* **********************************************************************
 *   Orgs_Workspaces_And_Folders
 ********************************************************************** */

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

//==========// Only the reverse audit needs the workspace and folder pickers, so
//==========// they stay hidden otherwise. Hiding does not reset the selection.
function updateSelectorVisibility() {
  $("ws-section").classList.toggle("hidden", !S.workspaces.length);
  renderFolderList();
}

//==========// Folder pills are only shown for the reverse audit, where the list is
//==========// already narrowed to the CRM data folder. For a normal scan there can
//==========// be dozens, so the scan plan does that job instead: same folders, with
//==========// a table count and a time against each.
function foldersArePickable() {
  return $("include-reverse-audit").checked;
}

//==========// A consolidated workspace mixes several apps' tables, which confuses
//==========// the reverse audit's name matching, so the CRM data folder is the only
//==========// one selected by default. An unreadable folder list scans unfiltered
//==========// rather than silently excluding everything.
function loadFolders() {
  S.folders = [];
  return runQueue(S.workspaces, function (w) {
    return analyticsGet("/workspaces/" + w.workspaceId + "/folders").then(function (body) {
      var folders = (body.data && body.data.folders) || [];
      folders.forEach(function (f) {
        S.folders.push({
          folderId: f.folderId, folderName: f.folderName,
          wsId: w.workspaceId, wsName: w.workspaceName,
          //==========// everything is in scope until someone narrows it deliberately
          selected: true,
          //==========// the folder Zoho syncs CRM data into, which is the one the
          //==========// reverse audit wants on its own
          isCrmData: f.folderName.toLowerCase().indexOf("zoho crm modules (data)") >= 0
        });
      });
    }).catch(function () { /* best-effort; that workspace just scans unfiltered */ });
  }).then(renderFolderList);
}

function renderFolderList() {
  var section = $("folder-section");
  if (!foldersArePickable()) { section.classList.add("hidden"); return; }
  var visible = S.folders.filter(function (f) {
    var ws = S.workspaces.filter(function (w) { return w.workspaceId === f.wsId; })[0];
    return ws && ws.selected;
  }).sort(function (a, b) { return (b.selected ? 1 : 0) - (a.selected ? 1 : 0); });
  if (!visible.length) { section.classList.add("hidden"); return; }
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

//==========// an unread folder list or unknown folderId never blocks scanning
function folderAllowed(wsId, folderId) {
  var wsFolders = S.folders.filter(function (f) { return f.wsId === wsId; });
  if (!wsFolders.length) return true;
  var match = wsFolders.filter(function (f) { return f.folderId === folderId; })[0];
  return match ? match.selected : true;
}

function selectedWorkspaces() {
  return S.workspaces.filter(function (w) { return w.selected; });
}

/* **********************************************************************
 *   Scan_Errors
 ********************************************************************** */

//==========// One message for every scan failure. The scope is named as the most
//==========// likely cause rather than the certain one: a scope that is already
//==========// granted sends people hunting the wrong problem, so the underlying
//==========// error is always shown alongside it.
function scanFailed(what, scope, unaffected, err) {
  showError(what + " scan failed" + (unaffected ? " (" + unaffected + " unaffected)" : "") + ". " +
    "Most often this is the \"" + $("conn-crm").value + "\" connection missing its " + scope +
    " scope, but check the error below before changing anything.\n" +
    String(err && err.message || err));
}

/* **********************************************************************
 *   Paging
 *
 *   CRM list endpoints return at most 200 rows and flag the rest through
 *   info.more_records. Every list call goes through here so no source can
 *   silently truncate a large org.
 ********************************************************************** */

function listAllPages(path, key) {
  function page(n, all) {
    var sep = path.indexOf("?") < 0 ? "?" : "&";
    return crmGet(path + sep + "page=" + n + "&per_page=200").then(function (body) {
      all = all.concat((body && body[key]) || []);
      return (body && body.info && body.info.more_records) ? page(n + 1, all) : all;
    });
  }
  return page(1, []);
}

//==========// A few settings endpoints reject page and per_page outright with
//==========// INVALID_REQUEST, so they are fetched in a single unparameterized call.
function listOnePage(path, key) {
  return crmGet(path).then(function (body) { return (body && body[key]) || []; });
}

/* **********************************************************************
 *   Source_Toggles
 ********************************************************************** */

//==========// keep each tile's styling in sync with its checkbox
["include-an", "include-crm", "include-reports"].forEach(function (id) {
  var cb = $(id);
  cb.onchange = function () {
    cb.closest(".src-tile").classList.toggle("on", cb.checked);
    updateScanButton();
  };
});

//==========// The reverse audit runs the opposite direction and runs standalone,
//==========// so selecting it locks out the normal sources instead of combining.
//==========// the reverse audit sweeps every column, so unrelated apps' tables are
//==========// pure noise for it; narrow to the CRM data folder when it is switched on
function applyCrmDataFolderPreset() {
  var anyCrmData = S.folders.some(function (f) { return f.isCrmData; });
  if (!anyCrmData) return;
  S.folders.forEach(function (f) { f.selected = !!f.isCrmData; });
}

$("include-reverse-audit").onchange = function () {
  var cb = $("include-reverse-audit");
  var exclusive = cb.checked;
  if (exclusive) applyCrmDataFolderPreset();
  else S.folders.forEach(function (f) { f.selected = true; });
  ["include-an", "include-crm", "include-reports"].forEach(function (id) {
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

//==========// reads "Scan 2 sources - 4 workspaces", disabled until a source is ready
function updateScanButton() {
  var btn = $("btn-scan");
  var ws = selectedWorkspaces().length;
  if ($("include-reverse-audit").checked) {
    btn.textContent = "Run reverse audit" + (ws ? " · " + ws + (ws === 1 ? " workspace" : " workspaces") : "");
    btn.disabled = !!(S.scanning || !S.sdkReady || !ws);
    return;
  }
  var an = $("include-an").checked, crm = $("include-crm").checked,
    reports = $("include-reports").checked;
  var srcs = (an ? 1 : 0) + (crm ? 1 : 0) + (reports ? 1 : 0);
  var label = "Scan " + srcs + (srcs === 1 ? " source" : " sources");
  if (an) label += " · " + ws + (ws === 1 ? " workspace" : " workspaces");
  btn.textContent = srcs ? label : "Scan";
  btn.disabled = !!(S.scanning || !S.sdkReady || !srcs || (an && !ws));
}

/* **********************************************************************
 *   Scan_Plan
 *
 *   Listing what exists is cheap, about a dozen calls. Reading the detail
 *   is not: one metered call per Analytics table, per function, and per
 *   rule, which is thousands of calls and minutes of waiting in a real
 *   org. So the plan runs the listing on its own first and shows what a
 *   scan would cost, broken down far enough to act on.
 *
 *   Folders are the useful lever. A consolidated workspace mixes several
 *   apps, and for a CRM field audit most of those tables are noise, so
 *   dropping a folder can take minutes off the run.
 ********************************************************************** */

//==========// per-folder table counts, which is the granularity worth choosing at
function planAnalytics() {
  var targets = selectedWorkspaces();
  if (!$("include-an").checked || !targets.length) return Promise.resolve([]);
  var rows = [];
  return runQueue(targets, function (w) {
    $("scan-progress").innerHTML = "Listing views in <b>" + esc(w.workspaceName) + "</b>&hellip;";
    return analyticsGet("/workspaces/" + w.workspaceId + "/views", { noOfResult: 1000 })
      .then(function (body) {
        var byFolder = {};
        ((body.data && body.data.views) || []).forEach(function (v) {
          if (v.viewType !== "Table" && v.viewType !== "QueryTable") return;
          var key = v.folderId == null ? "" : String(v.folderId);
          byFolder[key] = (byFolder[key] || 0) + 1;
        });
        Object.keys(byFolder).forEach(function (folderId) {
          var folder = S.folders.filter(function (f) {
            return f.wsId === w.workspaceId && String(f.folderId) === folderId;
          })[0];
          rows.push({
            wsId: w.workspaceId, wsName: w.workspaceName,
            folderId: folderId, folderName: folder ? folder.folderName : "(unfiled)",
            tables: byFolder[folderId], folder: folder
          });
        });
      })
      .catch(function () { /* a workspace we cannot list simply contributes nothing */ });
  }).then(function () {
    rows.sort(function (a, b) { return b.tables - a.tables; });
    return rows;
  });
}

//==========// one list call per CRM source, which is where the counts come from
function planCrm() {
  if (!$("include-crm").checked) return Promise.resolve([]);
  var rows = [];
  function count(label, path, key, detailPerItem) {
    $("scan-progress").innerHTML = "Listing " + esc(label) + "&hellip;";
    return listAllPages(path, key).then(function (items) {
      rows.push({ label: label, items: items.length, calls: detailPerItem ? items.length : 0 });
    }).catch(function () { rows.push({ label: label, items: null, calls: 0 }); });
  }
  return count("Deluge functions", "/settings/functions", "functions", true)
    .then(function () { return count("workflow rules", "/settings/automation/workflow_rules", "workflow_rules", true); })
    .then(function () { return count("field updates", "/settings/automation/field_updates", "field_updates", false); })
    .then(function () { return count("scoring rules", "/settings/automation/scoring_rules", "scoring_rules", false); })
    .then(function () { return count("blueprints", "/settings/blueprints", "blueprints", false); })
    .then(function () { return count("webhooks", "/settings/automation/webhooks", "webhooks", false); })
    .then(function () { return rows; });
}

function planReports() {
  if (!$("include-reports").checked) return Promise.resolve(null);
  $("scan-progress").innerHTML = "Listing CRM reports&hellip;";
  return crmGet("/Reports").then(function (body) {
    var all = (body && (body.reports || body.Reports)) || [];
    var fresh = all.filter(wasRecentlyAccessed);
    return { items: fresh.length, skipped: all.length - fresh.length, calls: fresh.length };
  }).catch(function () { return null; });
}

$("btn-plan").onclick = function () {
  clearError();
  var btn = $("btn-plan");
  btn.disabled = true;
  btn.textContent = "Checking…";
  showLoader("Listing what is there…");
  planAnalytics().then(function (analytics) {
    return planCrm().then(function (crm) {
      return planReports().then(function (reports) {
        S.plan = { analytics: analytics, crm: crm, reports: reports };
        renderPlan();
      });
    });
  }).catch(function (err) {
    showError(String(err && err.message || err));
  }).then(function () {
    hideLoader();
    btn.disabled = false;
    btn.textContent = "Re-check scan size";
    $("scan-progress").innerHTML = "";
    updateScanButton();
  });
};

//==========// seconds the current selection would cost, so the total tracks ticking
//==========// a folder on or off without re-listing anything
function planSeconds() {
  if (!S.plan) return null;
  var secs = 0;
  S.plan.analytics.forEach(function (r) {
    if (!r.folder || r.folder.selected) secs += estimateSeconds(r.tables, LIMITS.analytics);
  });
  S.plan.crm.forEach(function (r) { secs += estimateSeconds(r.calls, LIMITS.crm); });
  if (S.plan.reports) secs += estimateSeconds(S.plan.reports.calls, LIMITS.crm);
  return secs;
}

function planRow(label, detail, secs, checkbox) {
  return "<div class='plan-row'>" +
    "<span class='plan-check'>" + (checkbox || "") + "</span>" +
    "<span class='plan-label'>" + label + "</span>" +
    "<span class='plan-count'>" + detail + "</span>" +
    "<span class='plan-time'>" + (secs == null ? "" : describeDuration(secs)) + "</span>" +
    "</div>";
}

function renderPlan() {
  var plan = S.plan;
  if (!plan) return;
  var html = "";

  if (plan.analytics.length) {
    html += "<div class='plan-group'>Zoho Analytics tables</div>";
    plan.analytics.forEach(function (r, i) {
      var on = !r.folder || r.folder.selected;
      var box = r.folder
        ? "<input type='checkbox' data-plan-folder='" + i + "'" + (on ? " checked" : "") + ">"
        : "<span class='plan-fixed' title='no folder information, always scanned'>&bull;</span>";
      html += planRow(esc(r.folderName) + " <small>" + esc(r.wsName) + "</small>",
        r.tables + " " + qty(r.tables, "table"),
        estimateSeconds(r.tables, LIMITS.analytics), box);
    });
  }

  if (plan.crm.length) {
    html += "<div class='plan-group'>CRM functions and automations</div>";
    plan.crm.forEach(function (r) {
      var detail = r.items == null ? "could not list" : r.items + " found";
      html += planRow(esc(r.label), detail,
        r.calls ? estimateSeconds(r.calls, LIMITS.crm) : 0, "");
    });
  }

  if (plan.reports) {
    html += "<div class='plan-group'>CRM reports</div>";
    html += planRow("reports to read",
      plan.reports.items + " recent" +
      (plan.reports.skipped ? ", " + plan.reports.skipped + " stale and skipped" : ""),
      estimateSeconds(plan.reports.calls, LIMITS.crm), "");
  }

  $("plan-body").innerHTML = html || "<p class='section-note'>Nothing selected to scan.</p>";
  $("plan").classList.remove("hidden");
  refreshPlanTotal();

  //==========// unticking a folder drops it from the scan and from the total
  Array.prototype.forEach.call($("plan-body").querySelectorAll("[data-plan-folder]"), function (cb) {
    cb.onchange = function () {
      var row = S.plan.analytics[Number(cb.getAttribute("data-plan-folder"))];
      if (row && row.folder) row.folder.selected = cb.checked;
      refreshPlanTotal();
      renderFolderList();
      updateScanButton();
    };
  });
}

function refreshPlanTotal() {
  var secs = planSeconds();
  $("plan-total").textContent = secs == null ? "" : describeDuration(secs) + " to scan";
}

/* **********************************************************************
 *   Running_A_Scan
 *
 *   Two independent runs share the Scan button: the normal CRM to Analytics
 *   field scan, and the standalone reverse audit. Only Tables and Query
 *   Tables need deep detail fetches; every other Analytics view type is
 *   reached later through Zoho's own dependency engine.
 ********************************************************************** */

//==========// The seven sub-scans behind the single CRM toggle. Deluge code and
//==========// the automations run together on purpose: a rule's action list is what
//==========// tells us which module a thin automation function belongs to, so
//==========// scanning code without them would quietly weaken every function
//==========// verdict (see wiredModulesFor in fields.js).
var CRM_SCANS = [
  scanFunctions, scanWorkflowFieldUpdates, scanWorkflowRules, scanScoringRules,
  scanBlueprints, scanWebhooks, scanConnectedWorkflows
];

function beginScan() {
  resetLoaderCaption();
  S.scanning = true;
  $("btn-scan").disabled = true;
  $("scan-progress").classList.remove("done");
  S.tables = []; S.queryTables = []; S.viewCount = 0; S.depCache = {};
}

function failScan(err) {
  S.scanning = false;
  hideLoader();
  resetLoaderCaption();
  updateScanButton();
  showError(String(err && err.message || err));
}

//==========// collapse the setup card and reveal whichever results panel applies
function showResultsPanel(id) {
  S.scanning = false;
  hideLoader();
  updateScanButton();
  $("setup-card").classList.add("collapsed");
  var toggle = $("btn-toggle-setup");
  toggle.classList.remove("hidden");
  toggle.textContent = "Settings";
  $("results").classList.toggle("hidden", id !== "results");
  $("reverse-audit-card").classList.toggle("hidden", id !== "reverse-audit-card");
}

function runReverseAuditScan() {
  var targets = selectedWorkspaces();
  if (!targets.length) { showError("Select at least one workspace."); return; }
  beginScan();
  scanAnalytics(targets, true).then(function () {
    S.scannedAt = new Date().toLocaleString();
    return runReverseAudit();
  }).then(function () {
    showResultsPanel("reverse-audit-card");
  }).catch(failScan);
}

function runFieldScan() {
  var doAn = $("include-an").checked, doCrm = $("include-crm").checked,
    doReports = $("include-reports").checked;
  if (!doAn && !doCrm && !doReports) { showError("Turn on at least one scan source."); return; }
  var targets = doAn ? selectedWorkspaces() : [];
  if (doAn && !targets.length) { showError("Select at least one workspace."); return; }
  beginScan();
  S.analyticsScanned = doAn;
  S.results = {};

  //==========// sources run one after another to stay inside API rate limits
  var steps = [];
  if (doAn) steps.push(function () { return scanAnalytics(targets, true); });
  if (doReports) steps.push(scanReports);
  if (doCrm) CRM_SCANS.forEach(function (fn) { steps.push(fn); });

  runQueue(steps, function (step) { return step(); }).then(function () {
    S.scannedAt = new Date().toLocaleString();
    cacheScan();
    finishScan();
  }).catch(failScan);
}

$("btn-scan").onclick = function () {
  clearError();
  if ($("include-reverse-audit").checked) runReverseAuditScan();
  else runFieldScan();
};

/* **********************************************************************
 *   Report_Recency
 *
 *   A year of unused reports is hundreds of detail calls, so stale reports
 *   are filtered out before any detail is fetched. last_run_date is the
 *   real signal; a report that has never run falls back to created_time,
 *   giving a genuinely new report a grace period before it counts as
 *   stale. No usable date either way means it is skipped.
 ********************************************************************** */

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

/* **********************************************************************
 *   Reports
 ********************************************************************** */

//==========// the list response key casing varies by org, so accept either
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
    scanFailed("Reports", "ZohoCRM.settings.reports.READ", null, err);
  });
}

//==========// Columns and filters only, by design: group_by, sort_by, aggregate
//==========// functions and territory_filter are deliberately out of scope.
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

/* **********************************************************************
 *   Criteria_Trees
 ********************************************************************** */

/*
 *   Zoho nests criteria as {group_operator, group: [...]}, bottoming out
 *   at {field: {api_name}, comparator, value}. Workflow rules, scoring
 *   rules and connected workflows all reuse this shape, so one walker
 *   serves all three.
 *
 *   The Edit trigger's "specific fields" checkbox list reuses the same
 *   tree with comparator and value set to the sentinel ${ANYVALUE}, so it
 *   needs no special handling. relational_criteria, which compares against
 *   another module's field, is deliberately not walked.
 */

function walkCriteriaGroup(node, refs) {
  if (!node) return;
  if (node.group && node.group.length) { node.group.forEach(function (g) { walkCriteriaGroup(g, refs); }); return; }
  if (node.field && node.field.api_name) refs.push(node.field.api_name);
}

//==========// Kept as two lists, not merged: "fires the rule" and "filters the
//==========// rule" are different facts about a field.
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

/* **********************************************************************
 *   Automations
 ********************************************************************** */

//==========// A rule's actions are nested per condition, split across instant and
//==========// scheduled. Only entries typed "functions" name a Deluge function.
function extractFunctionActions(rule) {
  var out = [], seen = {};
  (rule.conditions || []).forEach(function (c) {
    [c.instant_actions, c.scheduled_actions].forEach(function (bucket) {
      ((bucket && bucket.actions) || []).forEach(function (a) {
        if (!a || a.type !== "functions" || !a.name) return;
        var key = norm(a.name);
        if (seen[key]) return;
        seen[key] = 1;
        out.push({ name: a.name, id: a.id });
      });
    });
  });
  return out;
}

function scanWorkflowRules() {
  S.workflowRules = []; S.workflowRulesScanned = false;
  $("scan-progress").innerHTML = "Listing CRM workflow rules&hellip;";
  showLoader("Listing CRM workflow rules...");
  var failures = 0;
  return listAllPages("/settings/automation/workflow_rules", "workflow_rules").then(function (list) {
    var listed = list.length;
    return runQueue(list, function (rule) {
      return crmGet("/settings/automation/workflow_rules/" + rule.id).then(function (detail) {
        var full = (detail && detail.workflow_rules && detail.workflow_rules[0]) || detail;
        if (!full || !full.module) { failures++; return; }
        S.workflowRules.push({
          id: full.id, name: full.name, moduleApiName: full.module.api_name, moduleId: full.module.id,
          triggerFields: extractTriggerFieldRefs(full),
          criteriaFields: extractConditionFieldRefs(full),
          functionActions: extractFunctionActions(full)
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
    scanFailed("Workflow rules", "ZohoCRM.settings.workflow_rules.READ", "field update matching is", err);
  });
}

//==========// The scoring list endpoint embeds each criteria tree already, so no
//==========// per-rule fetch. signal_rules are not field-based and are skipped.
function extractScoringFieldRefs(rule) {
  var refs = [];
  (rule.field_rules || []).forEach(function (fr) { walkCriteriaGroup(fr.criteria, refs); });
  return refs;
}
function scanScoringRules() {
  S.scoringRules = []; S.scoringRulesScanned = false;
  $("scan-progress").innerHTML = "Listing CRM scoring rules&hellip;";
  showLoader("Listing CRM scoring rules...");
  return listAllPages("/settings/automation/scoring_rules", "scoring_rules").then(function (rules) {
    S.scoringRules = rules.filter(function (rule) { return !!rule.module; }).map(function (rule) {
      return {
        id: rule.id, name: rule.name, moduleApiName: rule.module.api_name, moduleId: rule.module.id,
        criteriaFields: extractScoringFieldRefs(rule)
      };
    });
    S.scoringRulesScanned = true;
  }).catch(function (err) {
    scanFailed("Scoring rules", "ZohoCRM.settings.scoring_rules.READ", "other automation matching is", err);
  });
}

//==========// The list endpoint names each blueprint's single governing field, so no
//==========// per-blueprint fetch. Per-transition fields need transition ids, which
//==========// have no documented way to enumerate, so they are out of reach.
function scanBlueprints() {
  S.blueprintFields = []; S.blueprintFieldsScanned = false;
  $("scan-progress").innerHTML = "Listing CRM blueprints&hellip;";
  showLoader("Listing CRM blueprints...");
  return listAllPages("/settings/blueprints", "blueprints").then(function (blueprints) {
    S.blueprintFields = blueprints.filter(function (bp) { return bp.module && bp.field; }).map(function (bp) {
      return {
        id: bp.id, name: bp.name, moduleApiName: bp.module.api_name, moduleId: bp.module.id,
        fieldApiName: bp.field.api_name, pipelineName: (bp.pipeline && bp.pipeline.name) || null
      };
    });
    S.blueprintFieldsScanned = true;
  }).catch(function (err) {
    scanFailed("Blueprints", "ZohoCRM.settings.blueprint.READ", "other automation matching is", err);
  });
}

//==========// Merge tags name both module and field: ${!Module.Field}. Every string
//==========// value in the webhook is walked, since headers, body, url and url
//==========// parameters can all carry them. The module name is whatever Zoho's
//==========// merge-tag engine renders, and carries no id to correct it by.
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
  return listAllPages("/settings/automation/webhooks", "webhooks").then(function (webhooks) {
    S.webhookActions = webhooks.filter(function (wh) { return !!wh.module; }).map(function (wh) {
      return {
        id: wh.id, name: wh.name, moduleApiName: wh.module.api_name,
        fieldRefs: extractMergeTagFieldRefs(wh)
      };
    });
    S.webhookActionsScanned = true;
  }).catch(function (err) {
    scanFailed("Webhooks", "ZohoCRM.settings.automation_actions.READ", "other automation matching is", err);
  });
}

//==========// Zoho Flow-triggered rules reuse the workflow criteria tree exactly.
//==========// Three-level fetch: workflows, then their rules, then each rule's
//==========// detail, which is the only place firing conditions appear. Rules have
//==========// no name of their own, so they borrow their workflow's.
function scanConnectedWorkflows() {
  S.connectedWorkflowRules = []; S.connectedWorkflowRulesScanned = false;
  $("scan-progress").innerHTML = "Listing connected workflows&hellip;";
  showLoader("Listing connected workflows...");
  var failures = 0;
  return listOnePage("/settings/connected_workflows", "connected_workflows").then(function (workflows) {
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
    scanFailed("Connected workflows", "ZohoCRM.settings.connected_workflows.READ",
      "other automation matching is", err);
  });
}

/* **********************************************************************
 *   Analytics_Views
 ********************************************************************** */

//==========// filterByFolder is only true for the reverse audit, whose blind
//==========// every-column sweep is the one thing folder noise can drown. Field-name
//==========// matching does not care what folder a table lives in.
//==========// Warns before a long run, since Analytics metering makes a big org
//==========// take minutes and a silent progress bar looks like a hang.
//==========// The view listing tells us how many tables there are before any of
//==========// the metered detail reads begin, so the estimate can be given up front
//==========// rather than leaving someone watching a bar creep for five minutes.
//==========// three minutes, not two: a short wait does not need a coffee, and the
//==========// otter earning one should mean something
var LONG_SCAN_MINUTES = 3;

function noteLongScan(tableCount) {
  var mins = estimateMinutes(tableCount, LIMITS.analytics);
  if (mins < LONG_SCAN_MINUTES) return;
  var p = $("scan-progress");
  p.classList.remove("done");
  p.innerHTML = "<b>Large environment</b><span class='scan-stats'>" + tableCount +
    " tables to read. Zoho Analytics allows 60 of these a minute, so this takes about " +
    mins + " minutes.</span>";
  //==========// the loader covers the card, so say it where they are looking, and
  //==========// hand the otter a coffee while they wait
  var caption = document.querySelector(".loader-caption");
  if (caption) caption.textContent = "large environment · about " + mins + " minutes · grab a coffee";
  $("loader").classList.add("long-run");
}

//==========// remaining time for a metered run, phrased loosely because it is an
//==========// estimate: "about 4 minutes left"
function remainingLabel(done, total, limit) {
  var left = Math.max(0, total - done);
  var secs = Math.round((left * limit.minIntervalMs) / 1000);
  if (secs < 45) return "almost done";
  if (secs < 90) return "about a minute left";
  return "about " + Math.round(secs / 60) + " minutes left";
}

function scanAnalytics(targets, filterByFolder) {
  showLoader("Listing Analytics views…");
  S.viewsUnreadable = 0;
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
    noteLongScan(detailTargets.length);
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
            //==========// the SQL key name is plan-dependent, so take any long
            //==========// string living under a sql or query key
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
        .catch(function () { S.viewsUnreadable++; });
    }, function (i, n, t) {
      $("scan-progress").innerHTML = "Reading structure <b>" + i + " / " + n + "</b> &middot; " + esc(t.view.viewName);
      var suffix = n >= 60 ? " · " + remainingLabel(i, n, LIMITS.analytics) : "";
      showLoader("Reading structure " + i + " / " + n + suffix, n ? i / n : null);
    });
  });
}

/* **********************************************************************
 *   Deluge_Function_Code
 ********************************************************************** */

//==========// skips invokeConn's JSON check: /code returns a raw file body
function invokeRaw(connName, url) {
  var req = { url: url, method: "GET", param_type: 1, parameters: {}, headers: {} };
  return ZOHO.CRM.CONNECTION.invoke(connName, req);
}

//==========// the response can be raw text, a JSON string, or an object with the
//==========// code nested under any of several keys
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
  //==========// an error payload like {"code":"INVALID_TOKEN"} must not pass as script
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
  return listAllPages("/settings/functions", "functions").then(function (fns) {
    var listed = fns.length;
    return runQueue(fns, function (fn) {
      return fetchFunctionCode(fn).then(function (code) {
        if (code) S.functions.push({ id: fn.id, name: fn.display_name || fn.name, code: code });
        else failures++;
      }).catch(function () { failures++; });
    }, function (i, n, fn) {
      $("scan-progress").innerHTML = "Reading function code <b>" + i + " / " + n + "</b> &middot; " +
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
    scanFailed("Functions", "ZohoCRM.settings.functions.READ", "Analytics results are", err);
  });
}

//==========// Field updates name their module and field outright, so this needs no
//==========// text search at all. Paginated: an org can have 200+ of these.
function scanWorkflowFieldUpdates() {
  S.workflowFieldUpdates = []; S.workflowFieldUpdatesScanned = false;
  $("scan-progress").innerHTML = "Listing CRM workflow field updates&hellip;";
  showLoader("Listing CRM workflow field updates...");
  return listAllPages("/settings/automation/field_updates", "field_updates").then(function (updates) {
    S.workflowFieldUpdates = updates.filter(function (fu) { return fu.module && fu.field; }).map(function (fu) {
      return {
        id: fu.id, name: fu.name, moduleApiName: fu.module.api_name, moduleId: fu.module.id,
        fieldApiName: fu.field.api_name,
        value: fu.value, valueType: fu.type, featureType: fu.feature_type
      };
    });
    S.workflowFieldUpdatesScanned = true;
  }).catch(function (err) {
    scanFailed("Workflow field updates", "ZohoCRM.settings.automation_actions.READ",
      "other automation matching is", err);
  });
}

/* **********************************************************************
 *   Scan_Cache
 *
 *   The whole scan result is written to localStorage so reopening the tab
 *   can skip a re-scan. Both directions walk SCANS, so a new source is
 *   cached and restored without touching this section.
 ********************************************************************** */

function cacheScan() {
  var payload = {
    //==========// crmZgid is what keys the cache to an org. localStorage is shared
    //==========// across every org on crm.zoho.com, so without it switching orgs
    //==========// offers you the previous client's scan.
    crmZgid: S.crmZgid,
    at: S.scannedAt, orgId: S.orgId, dc: $("dc").value,
    tables: S.tables, queryTables: S.queryTables, viewCount: S.viewCount,
    analyticsScanned: S.analyticsScanned, reportsSkippedStale: S.reportsSkippedStale
  };
  SCANS.forEach(function (sc) {
    payload[sc.store] = S[sc.store];
    payload[sc.flag] = S[sc.flag];
  });
  try {
    localStorage.setItem(SCAN_KEY, JSON.stringify(payload));
    offerCachedScan();
  } catch (e) { /* best-effort */ }
}

function restoreScan(c) {
  S.tables = c.tables; S.queryTables = c.queryTables; S.viewCount = c.viewCount;
  //==========// older caches predate the analyticsScanned flag; infer it from the data
  S.analyticsScanned = c.analyticsScanned != null ? !!c.analyticsScanned : (c.tables || []).length > 0;
  S.reportsSkippedStale = c.reportsSkippedStale || 0;
  SCANS.forEach(function (sc) {
    S[sc.store] = c[sc.store] || [];
    S[sc.flag] = !!c[sc.flag];
  });
  S.orgId = c.orgId; S.scannedAt = c.at; $("dc").value = c.dc;
}

//==========// A cache from another org is worse than no cache: the verdicts would
//==========// look real while describing a different client's data.
function offerCachedScan() {
  var c = cachedScanForThisOrg();
  var b = $("btn-cache");
  if (!c) { b.classList.add("hidden"); return; }
  b.classList.remove("hidden");
  b.textContent = "Use cached scan · " + c.at;
}

function cachedScanForThisOrg() {
  var raw = localStorage.getItem(SCAN_KEY);
  if (!raw) return null;
  try {
    var c = JSON.parse(raw);
    if (!c || !c.crmZgid || !S.crmZgid || c.crmZgid !== S.crmZgid) return null;
    return c;
  } catch (e) { return null; }
}

$("btn-cache").onclick = function () {
  var c = cachedScanForThisOrg();
  if (!c) { showError("That cached scan belongs to a different org. Run a fresh scan."); return; }
  restoreScan(c);
  finishScan();
};

/* **********************************************************************
 *   Scan_Summary
 ********************************************************************** */

function scanStats() {
  var colCount = S.tables.reduce(function (n, t) { return n + t.columns.length; }, 0);
  var stats = [
    "<b>" + S.viewCount + "</b> views",
    "<b>" + S.tables.length + "</b> " + qty(S.tables.length, "table") + " (" + colCount + " columns)",
    "<b>" + S.queryTables.length + "</b> query " + qty(S.queryTables.length, "table")
  ];
  //==========// an unread table is a hole in every verdict, so it leads the stats
  if (S.viewsUnreadable) {
    stats.splice(1, 0, "<b>" + S.viewsUnreadable + "</b> " +
      qty(S.viewsUnreadable, "table") + " could not be read");
  }
  ranScans().forEach(function (sc) {
    var n = S[sc.store].length;
    stats.push("<b>" + n + "</b> " + qty(n, sc.unit) +
      (sc.flag === "reportsScanned" && S.reportsSkippedStale
        ? " (" + S.reportsSkippedStale + " skipped, not accessed in the past year)" : ""));
  });
  return stats;
}

var LOADER_CAPTION = "making field cleanup safer";

function resetLoaderCaption() {
  var caption = document.querySelector(".loader-caption");
  if (caption) caption.textContent = LOADER_CAPTION;
  $("loader").classList.remove("long-run");
}

function finishScan() {
  S.scanning = false;
  hideLoader();
  resetLoaderCaption();
  var stats = scanStats();
  var p = $("scan-progress");
  p.classList.add("done");
  p.innerHTML = "<b>Last scan · " + esc(S.scannedAt) + "</b>" +
    "<span class='scan-stats'>" + stats.join(" · ") + "</span>";
  if (S.viewsUnreadable) {
    showError(S.viewsUnreadable + " of " + (S.viewsUnreadable + S.tables.length + S.queryTables.length) +
      " Analytics tables could not be read, so verdicts below only cover the rest. " +
      "This is usually Zoho's 60-per-minute metadata limit under load. Re-run the scan to pick up the remainder.");
  }
  updateScanButton();
  $("results").classList.remove("hidden");
  $("reverse-audit-card").classList.add("hidden");
  $("setup-card").classList.add("collapsed");
  var t = $("btn-toggle-setup");
  t.classList.remove("hidden");
  t.textContent = "Settings";
  loadFields();
}
