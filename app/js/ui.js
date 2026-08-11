"use strict";

// Rendering: type icons, field chips, filters, the field list, the usage
// detail panel, CSV export, and the recheck action.

// Small type icons echoing Zoho Analytics' visual language
function svgIcon(inner) {
  return "<svg width='18' height='18' viewBox='0 0 20 20' aria-hidden='true'>" + inner + "</svg>";
}
function iconFor(vtype) {
  var t = String(vtype || "").toLowerCase();
  if (t.indexOf("function") >= 0)
    return svgIcon("<rect x='1' y='1' width='18' height='18' rx='4' fill='#8b5cf6'/><text x='10' y='14.5' font-size='11' font-style='italic' font-family='Georgia,serif' fill='#fff' text-anchor='middle'>fx</text>");
  if (t.indexOf("aggregate") >= 0)
    return svgIcon("<text x='10' y='16' font-size='16' font-weight='bold' font-family='Georgia,serif' fill='#8b5cf6' text-anchor='middle'>&#931;</text>");
  if (t.indexOf("formula") >= 0)
    return svgIcon("<rect x='1' y='1' width='18' height='18' rx='4' fill='#0d9488'/><text x='10' y='14.5' font-size='11' font-style='italic' font-family='Georgia,serif' fill='#fff' text-anchor='middle'>=x</text>");
  if (t.indexOf("query") >= 0)
    return svgIcon("<ellipse cx='10' cy='4.8' rx='7' ry='2.8' fill='#3b82f6'/><path d='M3 4.8v10.4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V4.8' fill='none' stroke='#3b82f6' stroke-width='1.8'/><path d='M3 10c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8' fill='none' stroke='#3b82f6' stroke-width='1.8'/>");
  if (t.indexOf("pivot") >= 0)
    return svgIcon("<path d='M4.5 15.5L14 6' stroke='#22a565' stroke-width='2.2' stroke-linecap='round'/><path d='M8.5 5.5H15V12' fill='none' stroke='#22a565' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/>");
  if (t.indexOf("summary") >= 0)
    return svgIcon("<text x='10' y='16' font-size='16' font-weight='bold' font-family='Georgia,serif' fill='#0ea5e9' text-anchor='middle'>&#931;</text>");
  if (t.indexOf("chart") >= 0)
    return svgIcon("<rect x='2' y='11' width='4' height='7' rx='1' fill='#f59e0b'/><rect x='8' y='5' width='4' height='13' rx='1' fill='#e4576a'/><rect x='14' y='8' width='4' height='10' rx='1' fill='#3b82f6'/>");
  if (t.indexOf("dashboard") >= 0)
    return svgIcon("<rect x='2' y='2' width='7' height='7' rx='1.5' fill='#e4576a'/><rect x='11' y='2' width='7' height='7' rx='1.5' fill='#f59e0b'/><rect x='2' y='11' width='7' height='7' rx='1.5' fill='#3b82f6'/><rect x='11' y='11' width='7' height='7' rx='1.5' fill='#22a565'/>");
  if (t.indexOf("report") >= 0)
    return svgIcon("<rect x='2' y='1' width='16' height='18' rx='2' fill='none' stroke='#0891b2' stroke-width='1.6'/><path d='M5 6h10M5 10h10M5 14h6' stroke='#0891b2' stroke-width='1.6' stroke-linecap='round'/>");
  if (t.indexOf("workflow") >= 0)
    return svgIcon("<circle cx='10' cy='10' r='3.2' fill='none' stroke='#f97316' stroke-width='1.8'/><path d='M10 1.7v2.8M10 15.5v2.8M1.7 10h2.8M15.5 10h2.8M4.1 4.1l2 2M13.9 13.9l2 2M15.9 4.1l-2 2M6.1 13.9l-2 2' stroke='#f97316' stroke-width='1.8' stroke-linecap='round'/>");
  if (t.indexOf("trigger") >= 0)
    return svgIcon("<path d='M11 1 3 11h5l-1 8 8-10h-5z' fill='#eab308'/>");
  if (t.indexOf("criteria") >= 0)
    return svgIcon("<path d='M2 3h16l-6.5 7.5V16l-3 1.6v-7.1z' fill='none' stroke='#6366f1' stroke-width='1.6' stroke-linejoin='round'/>");
  if (t.indexOf("scoring") >= 0)
    return svgIcon("<path d='M10 1.3l2.5 5.5 5.8.6-4.4 4 1.3 5.8L10 14.2l-5.2 3-1.3.9.9-5.9-4.4-4 5.8-.6z' fill='#e11d48'/>");
  if (t.indexOf("blueprint") >= 0)
    return svgIcon("<rect x='1.5' y='2.5' width='6' height='5' rx='1.2' fill='none' stroke='#0284c7' stroke-width='1.6'/><rect x='12.5' y='12.5' width='6' height='5' rx='1.2' fill='none' stroke='#0284c7' stroke-width='1.6'/><path d='M7.5 5h3a2 2 0 0 1 2 2v5.5' fill='none' stroke='#0284c7' stroke-width='1.6'/>");
  if (t.indexOf("webhook") >= 0)
    return svgIcon("<circle cx='6' cy='14' r='3' fill='none' stroke='#059669' stroke-width='1.8'/><circle cx='14' cy='6' r='3' fill='none' stroke='#059669' stroke-width='1.8'/><path d='M8.1 11.9l3.8-3.8' stroke='#059669' stroke-width='1.8' stroke-linecap='round'/>");
  if (t.indexOf("tabular") >= 0 || t.indexOf("table") >= 0)
    return svgIcon("<rect x='2' y='3' width='16' height='14' rx='1.5' fill='none' stroke='#64748b' stroke-width='1.6'/><rect x='2' y='3' width='16' height='4.5' fill='#64748b'/><path d='M2 12h16M8 7.5v9.5M13 7.5v9.5' stroke='#64748b' stroke-width='1.6'/>");
  return svgIcon("<rect x='4' y='2' width='12' height='16' rx='2' fill='none' stroke='#64748b' stroke-width='1.6'/><path d='M7 7h6M7 10.5h6M7 14h4' stroke='#64748b' stroke-width='1.6' stroke-linecap='round'/>");
}

function chipFor(f) {
  var cat = categoryOf(f);
  var out;
  if (cat === "unchecked") {
    out = "<span class='chip unchecked'>&mdash;</span>";
  } else if (cat === "na") {
    out = "<span class='chip na' title='No matching column exists in the scanned Analytics workspaces" +
      (S.functionsScanned ? ", no CRM function references it" : "") +
      (S.reportsScanned ? ", no CRM report references it" : "") +
      (S.workflowFieldUpdatesScanned ? ", no workflow field update references it" : "") +
      (S.workflowRulesScanned ? ", no workflow rule trigger/criteria references it" : "") +
      (S.scoringRulesScanned ? ", no scoring rule references it" : "") +
      (S.blueprintFieldsScanned ? ", doesn't govern a blueprint" : "") + "'>" + naLabel() + "</span>";
  } else if (cat === "clear") {
    out = "<span class='chip clear' title='Synced to Analytics, but nothing depends on the column" +
      (S.functionsScanned ? ", no CRM function references it" : "") +
      (S.reportsScanned ? ", no CRM report references it" : "") +
      (S.workflowFieldUpdatesScanned ? ", no workflow field update references it" : "") +
      (S.workflowRulesScanned ? ", no workflow rule trigger/criteria references it" : "") +
      (S.scoringRulesScanned ? ", no scoring rule references it" : "") +
      (S.blueprintFieldsScanned ? ", doesn't govern a blueprint" : "") + "'>unused</span>";
  } else {
    var u = usageCounts(S.results[f.api_name]);
    out = "";
    if (u.analytics > 0) {
      out += "<span class='chip src-an' title='" + u.analytics + " Analytics usage" +
        (u.analytics > 1 ? "s" : "") + "'>" + iconFor("chart") + u.analytics + "</span>";
    }
    if (u.functions > 0) {
      out += "<span class='chip src-fn' title='" + u.functions + " CRM function reference" +
        (u.functions > 1 ? "s" : "") + "'>" + iconFor("function") + u.functions + "</span>";
    }
    if (u.reports > 0) {
      out += "<span class='chip src-rpt' title='" + u.reports + " CRM report reference" +
        (u.reports > 1 ? "s" : "") + "'>" + iconFor("report") + u.reports + "</span>";
    }
    if (u.workflows > 0) {
      out += "<span class='chip src-wf' title='" + u.workflows + " workflow field update reference" +
        (u.workflows > 1 ? "s" : "") + "'>" + iconFor("workflow") + u.workflows + "</span>";
    }
    if (u.triggers > 0) {
      out += "<span class='chip src-trig' title='used as a trigger in " + u.triggers + " workflow rule" +
        (u.triggers > 1 ? "s" : "") + "'>" + iconFor("trigger") + u.triggers + "</span>";
    }
    if (u.criteria > 0) {
      out += "<span class='chip src-crit' title='used in firing criteria for " + u.criteria + " workflow rule" +
        (u.criteria > 1 ? "s" : "") + "'>" + iconFor("criteria") + u.criteria + "</span>";
    }
    if (u.scoring > 0) {
      out += "<span class='chip src-score' title='used in scoring criteria for " + u.scoring + " scoring rule" +
        (u.scoring > 1 ? "s" : "") + "'>" + iconFor("scoring") + u.scoring + "</span>";
    }
    if (u.blueprint > 0) {
      out += "<span class='chip src-blueprint' title='governs " + u.blueprint + " blueprint" +
        (u.blueprint > 1 ? "s" : "") + "'>" + iconFor("blueprint") + u.blueprint + "</span>";
    }
    if (u.webhooks > 0) {
      out += "<span class='chip src-webhook' title='referenced in " + u.webhooks + " webhook" +
        (u.webhooks > 1 ? "s" : "") + "'>" + iconFor("webhook") + u.webhooks + "</span>";
    }
    if (u.cwTriggers > 0) {
      out += "<span class='chip src-cwtrig' title='used as a trigger in " + u.cwTriggers + " connected workflow rule" +
        (u.cwTriggers > 1 ? "s" : "") + "'>" + iconFor("trigger") + u.cwTriggers + "</span>";
    }
    if (u.cwCriteria > 0) {
      out += "<span class='chip src-cwcrit' title='used in firing criteria for " + u.cwCriteria + " connected workflow rule" +
        (u.cwCriteria > 1 ? "s" : "") + "'>" + iconFor("criteria") + u.cwCriteria + "</span>";
    }
  }
  return "<span class='chips'>" + out + "</span>";
}

var FILTERS = [
  { key: "all", label: "All" }, { key: "used", label: "In use" },
  { key: "clear", label: "Unused" }, { key: "na", label: "Not in Analytics" },
  { key: "unchecked", label: "Unchecked" }
];
function renderFilters() {
  var counts = { all: S.fields.length, used: 0, clear: 0, na: 0, unchecked: 0 };
  S.fields.forEach(function (f) { counts[categoryOf(f)]++; });
  $("field-filters").innerHTML = FILTERS.map(function (fl) {
    if (fl.key !== "all" && !counts[fl.key]) return "";
    var label = fl.key === "na" ? naLabel() : fl.label;
    return "<button data-f='" + fl.key + "' class='" + (S.filter === fl.key ? "active" : "") + "'>" +
      label + " (" + counts[fl.key] + ")</button>";
  }).join("");
  Array.prototype.forEach.call($("field-filters").children, function (b) {
    b.onclick = function () { S.filter = b.getAttribute("data-f"); renderFieldList(); };
  });
}

function renderFieldList() {
  renderFilters();
  var q = $("field-search").value.toLowerCase();
  var list = $("field-list");
  list.innerHTML = "";
  S.fields.filter(function (f) {
    if (S.filter !== "all" && categoryOf(f) !== S.filter) return false;
    return !q || f.label.toLowerCase().indexOf(q) >= 0 || f.api_name.toLowerCase().indexOf(q) >= 0;
  }).forEach(function (f) {
    var row = document.createElement("div");
    row.className = "field-row" + (S.activeField === f.api_name ? " active" : "");
    row.innerHTML = "<div class='fname'>" + esc(f.label) +
      "<small>" + esc(f.api_name) + " &middot; " + esc(f.type) + (f.custom ? " &middot; custom" : "") +
      "</small></div>" + chipFor(f);
    row.onclick = function () {
      S.activeField = f.api_name;
      renderFieldList();
      $("detail-title").innerHTML = "<span class='step'>3</span>Usage: " + esc(f.label);
      $("detail-body").innerHTML = "<p class='section-note'>Checking dependencies&hellip;</p>";
      checkField(f).then(function () { renderFieldList(); renderDetail(f); });
    };
    list.appendChild(row);
  });
}
$("field-search").oninput = renderFieldList;

$("btn-check-all").onclick = function () {
  if (S.checking) return;
  S.checking = true;
  $("btn-check-all").disabled = true;
  showMini("Checking 0 / " + S.fields.length, 0);
  runQueue(S.fields, function (f) {
    return checkField(f).then(renderFieldList);
  }, function (i, n, f) {
    $("check-progress").innerHTML = "Checking <b>" + i + " / " + n + "</b> &mdash; " + esc(f.label);
    showMini("Checking " + i + " / " + n, n ? i / n : null);
  }).then(function () {
    hideMini();
    S.checking = false;
    $("btn-check-all").disabled = false;
    var used = 0, rest = 0;
    S.fields.forEach(function (f) { if (categoryOf(f) === "used") used++; else rest++; });
    $("check-progress").innerHTML = "All fields checked: <b>" + used + "</b> in use, <b>" +
      rest + "</b> safe or not synced.";
    renderFieldList();
  });
};

$("btn-export").onclick = function () {
  var mod = $("module-pick").selectedOptions[0].textContent;
  var rows = [["Module", "Field", "API Name", "Type", "Custom", "Verdict", "Hits", "Used In"]];
  S.fields.forEach(function (f) {
    var cat = categoryOf(f);
    if (cat === "unchecked") return;
    var r = S.results[f.api_name];
    var uses = [];
    r.columns.forEach(function (c) {
      if (!c.dep) return;
      c.dep.views.forEach(function (v) { uses.push((v.reportType || "view") + ": " + v.viewName); });
      c.dep.customFormulas.forEach(function (cf) { uses.push("formula column: " + cf.columnName); });
      c.dep.aggregateFormulas.forEach(function (af) { uses.push("aggregate: " + af.formulaName + " in " + af.parentViewName); });
    });
    r.sql.forEach(function (h) { uses.push("query table SQL: " + h.viewName); });
    (r.functions || []).forEach(function (h) { uses.push("function: " + h.name); });
    (r.reports || []).forEach(function (h) {
      uses.push("report " + h.kind + (h.confident ? "" : " (unverified)") + ": " + h.reportName);
    });
    (r.workflows || []).forEach(function (h) { uses.push("workflow field update: " + h.name); });
    (r.triggers || []).forEach(function (h) { uses.push("workflow rule trigger: " + h.name); });
    (r.criteria || []).forEach(function (h) { uses.push("workflow rule criteria: " + h.name); });
    (r.scoring || []).forEach(function (h) { uses.push("scoring rule: " + h.name); });
    (r.blueprint || []).forEach(function (h) {
      uses.push("blueprint: " + h.name + (h.pipelineName ? " (pipeline: " + h.pipelineName + ")" : ""));
    });
    (r.webhooks || []).forEach(function (h) { uses.push("webhook: " + h.name); });
    (r.cwTriggers || []).forEach(function (h) { uses.push("connected workflow trigger: " + h.name); });
    (r.cwCriteria || []).forEach(function (h) { uses.push("connected workflow criteria: " + h.name); });
    var verdict = cat === "used" ? "In use"
      : cat === "na" ? (S.functionsScanned ? "Not synced (absent from Analytics, no function references)" : "Not in Analytics")
      : "Unused (synced to Analytics, nothing depends on it)";
    rows.push([mod, f.label, f.api_name, f.type, f.custom ? "yes" : "no",
      verdict, String(cat === "used" ? hitCount(r) : 0), uses.join("; ")]);
  });
  if (rows.length === 1) { $("check-progress").textContent = "Nothing to export yet: check some fields first."; return; }
  var csv = rows.map(function (r) {
    return r.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(",");
  }).join("\r\n");
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "fieldcheck-" + norm(mod) + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
};

function usageCard(vtype, name, wsName, link, snippet, linkLabel) {
  return "<div class='usage'><div class='icon'>" + iconFor(vtype) + "</div><div class='meta'>" +
    "<div class='vtype'>" + esc(vtype) + (wsName ? " &middot; " + esc(wsName) : "") + "</div>" +
    "<div class='vname'>" + esc(name) + "</div>" +
    (snippet ? "<div class='snippet'>" + esc(snippet) + "</div>" : "") +
    "</div>" + (link ? "<a href='" + link + "' target='_blank' rel='noopener'>" +
      (linkLabel || "Open in Analytics &rarr;") + "</a>" : "") +
    "</div>";
}

function renderDetail(f) {
  var r = S.results[f.api_name];
  var html = "";
  var n = hitCount(r);
  var scope = S.tables.length + " tables / " + S.queryTables.length + " query tables" +
    (S.functionsScanned ? " / " + S.functions.length + " functions" : "") +
    (S.reportsScanned ? " / " + S.reports.length + " reports" : "") +
    (S.workflowFieldUpdatesScanned ? " / " + S.workflowFieldUpdates.length + " workflow field updates" : "") +
    (S.workflowRulesScanned ? " / " + S.workflowRules.length + " workflow rules" : "") +
    (S.scoringRulesScanned ? " / " + S.scoringRules.length + " scoring rules" : "") +
    (S.blueprintFieldsScanned ? " / " + S.blueprintFields.length + " blueprints" : "") +
    (S.webhookActionsScanned ? " / " + S.webhookActions.length + " webhooks" : "") +
    (S.connectedWorkflowRulesScanned ? " / " + S.connectedWorkflowRules.length + " connected workflow rules" : "") +
    " scanned on " + S.scannedAt;
  if (n > 0) {
    var depViews = 0, cfCount = 0, afCount = 0;
    r.columns.forEach(function (c) {
      if (!c.dep) return;
      depViews += c.dep.views.length;
      cfCount += c.dep.customFormulas.length;
      afCount += c.dep.aggregateFormulas.length;
    });
    var breakdown = [
      { n: depViews, label: "Analytics views", icon: "chart", target: "section-analytics" },
      { n: cfCount, label: "formula columns", icon: "formula", target: "section-analytics" },
      { n: afCount, label: "aggregate formulas", icon: "aggregate", target: "section-analytics" },
      { n: r.sql.length, label: "query table SQL", icon: "query", target: "section-sql" },
      { n: (r.functions || []).length, label: "CRM functions", icon: "function", target: "section-functions" },
      { n: (r.reports || []).length, label: "CRM reports", icon: "report", target: "section-reports" },
      { n: (r.workflows || []).length, label: "workflow field updates", icon: "workflow", target: "section-workflows" },
      { n: (r.triggers || []).length, label: "workflow rule triggers", icon: "trigger", target: "section-wf-triggers" },
      { n: (r.criteria || []).length, label: "workflow rule criteria", icon: "criteria", target: "section-wf-criteria" },
      { n: (r.scoring || []).length, label: "scoring rules", icon: "scoring", target: "section-scoring" },
      { n: (r.blueprint || []).length, label: "blueprints", icon: "blueprint", target: "section-blueprint" },
      { n: (r.webhooks || []).length, label: "webhooks", icon: "webhook", target: "section-webhooks" },
      { n: (r.cwTriggers || []).length, label: "connected workflow triggers", icon: "trigger", target: "section-cw-triggers" },
      { n: (r.cwCriteria || []).length, label: "connected workflow criteria", icon: "criteria", target: "section-cw-criteria" }
    ].filter(function (b) { return b.n > 0; }).map(function (b) {
      return "<span class='vb vb-link' onclick=\"__jumpTo('" + b.target + "')\">" +
        iconFor(b.icon) + "<b>" + b.n + "</b>&nbsp;" + b.label + "</span>";
    }).join("");
    html += "<div class='verdict used'><div class='vnum'>" + n + "</div>" +
      "<div class='vmain'><b>place" + (n > 1 ? "s" : "") + " use this field</b>" +
      "<small>" + (r.notSynced ? "Not synced to Analytics; found in CRM Deluge code only. " : "") +
      "Update or retire these before deleting. Scope: " + scope + ".</small></div>" +
      "<div class='verdict-breakdown'>" + breakdown + "</div></div>";
  } else if (r.notSynced) {
    html += "<div class='verdict na'><b>Not found in Analytics" +
      (S.functionsScanned ? " or CRM Deluge functions" : "") +
      (S.reportsScanned ? " or CRM reports" : "") +
      (S.workflowFieldUpdatesScanned ? " or workflow field updates" : "") +
      (S.workflowRulesScanned ? " or workflow rule triggers/criteria" : "") +
      (S.scoringRulesScanned ? " or scoring rules" : "") +
      (S.blueprintFieldsScanned ? " or blueprints" : "") + ".</b><small>No synced column named like &ldquo;" +
      esc(f.label) + "&rdquo; / " + esc(f.api_name) + " exists in the scanned workspaces" +
      (S.functionsScanned ? " and no function references it" : "") +
      (S.reportsScanned ? " and no report references it" : "") +
      (S.workflowFieldUpdatesScanned ? " and no workflow field update references it" : "") +
      (S.workflowRulesScanned ? " and no workflow rule trigger/criteria references it" : "") +
      (S.scoringRulesScanned ? " and no scoring rule references it" : "") +
      (S.blueprintFieldsScanned ? " and doesn't govern a blueprint" : "") + ". Scope: " + scope + ".</small></div>";
  } else {
    html += "<div class='verdict clear'><b>Safe to delete</b> as far as Analytics" +
      (S.functionsScanned ? " and CRM Deluge functions" : "") +
      (S.reportsScanned ? " and CRM reports" : "") +
      (S.workflowFieldUpdatesScanned ? " and workflow field updates" : "") +
      (S.workflowRulesScanned ? " and workflow rule triggers/criteria" : "") +
      (S.scoringRulesScanned ? " and scoring rules" : "") +
      (S.blueprintFieldsScanned ? " and blueprints" : "") + " are concerned." +
      "<small>Zoho's dependency engine reports nothing depending on the matched column(s)" +
      (S.functionsScanned ? ", and no function code references the API name" : "") +
      (S.reportsScanned ? ", and no report references it" : "") +
      (S.workflowFieldUpdatesScanned ? ", and no workflow field update references it" : "") +
      (S.workflowRulesScanned ? ", and no workflow rule trigger/criteria references it" : "") +
      (S.scoringRulesScanned ? ", and no scoring rule references it" : "") +
      (S.blueprintFieldsScanned ? ", and doesn't govern a blueprint" : "") +
      ". Scope: " + scope + ".</small></div>";
  }
  html += "<div id='section-analytics'>";
  r.columns.forEach(function (c) {
    var where = c.tableName + (c.primary ? "" : " (different table, same column name)");
    if (c.error) {
      html += "<h3 class='usage-group'>" + esc(where) + "</h3><p class='section-note'>Could not read dependents for this column.</p>";
      return;
    }
    var total = c.dep.views.length + c.dep.customFormulas.length + c.dep.aggregateFormulas.length;
    if (!total) return;
    html += "<h3 class='usage-group'>Column &ldquo;" + esc(c.columnName) + "&rdquo; in " + esc(where) +
      " <span class='gcount'>" + total + (total > 1 ? " items" : " item") + "</span></h3>";
    // Dashboard KPI widgets come back as bare numeric IDs; collapse them
    // into a count instead of showing meaningless rows.
    var named = c.dep.views.filter(function (v) {
      return !/widget/i.test(String(v.reportType || "")) && !/^\d+$/.test(String(v.viewName || ""));
    });
    var widgetCount = c.dep.views.length - named.length;
    html += named.map(function (v) {
      return usageCard(v.reportType || "view", v.viewName, c.wsName, viewLink(c.wsId, v.viewId), "");
    }).join("");
    if (widgetCount > 0) {
      html += "<p class='section-note'>Plus " + widgetCount + " dashboard KPI widget" +
        (widgetCount > 1 ? "s" : "") + " built on this column (unnamed components inside dashboards).</p>";
    }
    html += c.dep.customFormulas.map(function (cf) {
      return usageCard("formula column", cf.columnName, c.wsName, null, "");
    }).join("");
    html += c.dep.aggregateFormulas.map(function (af) {
      return usageCard("aggregate formula", af.formulaName + " (in " + af.parentViewName + ")",
        c.wsName, af.parentViewId ? viewLink(c.wsId, af.parentViewId) : null, "");
    }).join("");
  });
  html += "</div>";
  if (r.sql.length) {
    html += "<h3 class='usage-group' id='section-sql'>Query table SQL matches <span class='gcount'>" + r.sql.length + "</span></h3>";
    html += r.sql.map(function (h) {
      return usageCard("QueryTable", h.viewName, h.wsName, viewLink(h.wsId, h.viewId), h.snippet);
    }).join("");
  }
  if ((r.functions || []).length) {
    html += "<h3 class='usage-group' id='section-functions'>CRM Deluge functions referencing " + esc(f.api_name) +
      " <span class='gcount'>" + r.functions.length + (r.functions.length > 1 ? " functions" : " function") + "</span></h3>";
    html += r.functions.map(function (h) {
      return usageCard("function" + (h.count > 1 ? " (" + h.count + " references)" : ""),
        h.name, null, functionsPageUrl(), h.snippet, "Open Functions page &rarr;");
    }).join("");
  }
  if ((r.reports || []).length) {
    html += "<h3 class='usage-group' id='section-reports'>CRM reports referencing " + esc(f.api_name) +
      " <span class='gcount'>" + r.reports.length + (r.reports.length > 1 ? " reports" : " report") + "</span></h3>";
    html += r.reports.map(function (h) {
      var vtype = "report " + h.kind + (h.confident ? "" : " - unverified match");
      return usageCard(vtype, h.reportName, h.folderName, reportPageUrl(h.reportId), "", "Open report &rarr;");
    }).join("");
  }
  if ((r.workflows || []).length) {
    html += "<h3 class='usage-group' id='section-workflows'>Workflow field updates referencing " + esc(f.api_name) +
      " <span class='gcount'>" + r.workflows.length + (r.workflows.length > 1 ? " field updates" : " field update") + "</span></h3>";
    html += r.workflows.map(function (h) {
      var val = Array.isArray(h.value) ? h.value.join(", ") : h.value;
      return usageCard("workflow field update", h.name, h.featureType || null, fieldUpdatePageUrl(h.id),
        val ? "sets to: " + val : "", "Open field update &rarr;");
    }).join("");
  }
  if ((r.triggers || []).length) {
    html += "<h3 class='usage-group' id='section-wf-triggers'>Workflow rules triggered off " + esc(f.api_name) +
      " <span class='gcount'>" + r.triggers.length + (r.triggers.length > 1 ? " rules" : " rule") + "</span></h3>";
    html += r.triggers.map(function (h) {
      return usageCard("rule trigger", h.name, null, workflowRulePageUrl(h.id), "", "Open workflow rule &rarr;");
    }).join("");
  }
  if ((r.criteria || []).length) {
    html += "<h3 class='usage-group' id='section-wf-criteria'>Workflow rules with firing criteria on " + esc(f.api_name) +
      " <span class='gcount'>" + r.criteria.length + (r.criteria.length > 1 ? " rules" : " rule") + "</span></h3>";
    html += r.criteria.map(function (h) {
      return usageCard("rule criteria", h.name, null, workflowRulePageUrl(h.id), "", "Open workflow rule &rarr;");
    }).join("");
  }
  if ((r.scoring || []).length) {
    html += "<h3 class='usage-group' id='section-scoring'>Scoring rules referencing " + esc(f.api_name) +
      " <span class='gcount'>" + r.scoring.length + (r.scoring.length > 1 ? " rules" : " rule") + "</span></h3>";
    html += r.scoring.map(function (h) {
      return usageCard("scoring rule", h.name, null, scoringRulePageUrl(h.id), "", "Open scoring rule &rarr;");
    }).join("");
  }
  if ((r.blueprint || []).length) {
    html += "<h3 class='usage-group' id='section-blueprint'>Blueprints governed by " + esc(f.api_name) +
      " <span class='gcount'>" + r.blueprint.length + "</span></h3>";
    html += r.blueprint.map(function (h) {
      return usageCard("blueprint", h.name, h.pipelineName || null, blueprintPageUrl(h.id, $("module-pick").value), "",
        "Open blueprint &rarr;");
    }).join("");
  }
  if ((r.webhooks || []).length) {
    html += "<h3 class='usage-group' id='section-webhooks'>Webhooks referencing " + esc(f.api_name) +
      " <span class='gcount'>" + r.webhooks.length + (r.webhooks.length > 1 ? " webhooks" : " webhook") + "</span></h3>";
    html += r.webhooks.map(function (h) {
      return usageCard("webhook", h.name, null, null, "");
    }).join("");
  }
  if ((r.cwTriggers || []).length) {
    html += "<h3 class='usage-group' id='section-cw-triggers'>Connected workflow rules triggered off " + esc(f.api_name) +
      " <span class='gcount'>" + r.cwTriggers.length + (r.cwTriggers.length > 1 ? " rules" : " rule") + "</span></h3>";
    html += r.cwTriggers.map(function (h) {
      return usageCard("connected automation trigger", h.name, null, null, "");
    }).join("");
  }
  if ((r.cwCriteria || []).length) {
    html += "<h3 class='usage-group' id='section-cw-criteria'>Connected workflow rules with firing criteria on " +
      esc(f.api_name) + " <span class='gcount'>" + r.cwCriteria.length + (r.cwCriteria.length > 1 ? " rules" : " rule") + "</span></h3>";
    html += r.cwCriteria.map(function (h) {
      return usageCard("connected automation criteria", h.name, null, null, "");
    }).join("");
  }
  $("detail-body").innerHTML = html + detailFooter(f);
}

function detailFooter(f) {
  return "<p class='section-note'><button class='link' onclick='__recheck(\"" + f.api_name + "\")'>Recheck this field</button></p>";
}
window.__jumpTo = function (id) {
  var el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
};
window.__recheck = function (apiName) {
  var f = S.fields.filter(function (x) { return x.api_name === apiName; })[0];
  if (!f) return;
  delete S.results[apiName];
  // Invalidate dependents cache for this field's columns so the recheck is real
  moduleTableFirst(f).forEach(function (m) { delete S.depCache[m.col.columnId]; });
  S.activeField = apiName;
  renderFieldList();
  $("detail-body").innerHTML = "<p class='section-note'>Rechecking&hellip;</p>";
  checkField(f).then(function () { renderFieldList(); renderDetail(f); });
};
