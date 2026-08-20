"use strict";

/* **********************************************************************
 *   Type_Icons
 *
 *   Small inline SVGs echoing Zoho Analytics' own visual language. First
 *   matching substring wins, so more specific names precede generic ones.
 ********************************************************************** */

function svgIcon(inner) {
  return "<svg width='18' height='18' viewBox='0 0 20 20' aria-hidden='true'>" + inner + "</svg>";
}

var ICONS = [
  ["function", "<rect x='1' y='1' width='18' height='18' rx='4' fill='#8b5cf6'/><text x='10' y='14.5' font-size='11' font-style='italic' font-family='Georgia,serif' fill='#fff' text-anchor='middle'>fx</text>"],
  ["aggregate", "<text x='10' y='16' font-size='16' font-weight='bold' font-family='Georgia,serif' fill='#8b5cf6' text-anchor='middle'>&#931;</text>"],
  ["formula", "<rect x='1' y='1' width='18' height='18' rx='4' fill='#0d9488'/><text x='10' y='14.5' font-size='11' font-style='italic' font-family='Georgia,serif' fill='#fff' text-anchor='middle'>=x</text>"],
  ["query", "<ellipse cx='10' cy='4.8' rx='7' ry='2.8' fill='#3b82f6'/><path d='M3 4.8v10.4c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V4.8' fill='none' stroke='#3b82f6' stroke-width='1.8'/><path d='M3 10c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8' fill='none' stroke='#3b82f6' stroke-width='1.8'/>"],
  ["pivot", "<path d='M4.5 15.5L14 6' stroke='#22a565' stroke-width='2.2' stroke-linecap='round'/><path d='M8.5 5.5H15V12' fill='none' stroke='#22a565' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/>"],
  ["summary", "<path d='M3 4h14M3 8h14M3 12h9M3 16h6' stroke='#22a565' stroke-width='1.8' stroke-linecap='round'/>"],
  ["chart", "<rect x='2.5' y='11' width='4' height='6.5' rx='1' fill='#22a565'/><rect x='8' y='7' width='4' height='10.5' rx='1' fill='#22a565'/><rect x='13.5' y='3' width='4' height='14.5' rx='1' fill='#22a565'/>"],
  ["dashboard", "<rect x='2' y='2' width='7' height='7' rx='1.5' fill='#6366f1'/><rect x='11' y='2' width='7' height='7' rx='1.5' fill='#6366f1' opacity='.55'/><rect x='2' y='11' width='7' height='7' rx='1.5' fill='#6366f1' opacity='.55'/><rect x='11' y='11' width='7' height='7' rx='1.5' fill='#6366f1'/>"],
  ["report", "<rect x='3.5' y='2' width='13' height='16' rx='1.8' fill='none' stroke='#0891b2' stroke-width='1.6'/><path d='M6.5 6h7M6.5 9.5h7M6.5 13h4' stroke='#0891b2' stroke-width='1.5' stroke-linecap='round'/>"],
  ["workflow", "<circle cx='10' cy='10' r='3.2' fill='none' stroke='#f97316' stroke-width='1.8'/><path d='M10 1.7v2.8M10 15.5v2.8M1.7 10h2.8M15.5 10h2.8M4.1 4.1l2 2M13.9 13.9l2 2M15.9 4.1l-2 2M6.1 13.9l-2 2' stroke='#f97316' stroke-width='1.8' stroke-linecap='round'/>"],
  ["trigger", "<path d='M11 1 3 11h5l-1 8 8-10h-5z' fill='#eab308'/>"],
  ["criteria", "<path d='M2 3h16l-6.5 7.5V16l-3 1.6v-7.1z' fill='none' stroke='#6366f1' stroke-width='1.6' stroke-linejoin='round'/>"],
  ["scoring", "<path d='M10 1.3l2.5 5.5 5.8.6-4.4 4 1.3 5.8L10 14.2l-5.2 3-1.3.9.9-5.9-4.4-4 5.8-.6z' fill='#e11d48'/>"],
  ["blueprint", "<rect x='1.5' y='2.5' width='6' height='5' rx='1.2' fill='none' stroke='#0284c7' stroke-width='1.6'/><rect x='12.5' y='12.5' width='6' height='5' rx='1.2' fill='none' stroke='#0284c7' stroke-width='1.6'/><path d='M7.5 5h3a2 2 0 0 1 2 2v5.5' fill='none' stroke='#0284c7' stroke-width='1.6'/>"],
  ["webhook", "<circle cx='6' cy='14' r='3' fill='none' stroke='#059669' stroke-width='1.8'/><circle cx='14' cy='6' r='3' fill='none' stroke='#059669' stroke-width='1.8'/><path d='M8.1 11.9l3.8-3.8' stroke='#059669' stroke-width='1.8' stroke-linecap='round'/>"],
  ["tabular", "<rect x='2' y='3' width='16' height='14' rx='1.5' fill='none' stroke='#64748b' stroke-width='1.6'/><rect x='2' y='3' width='16' height='4.5' fill='#64748b'/><path d='M2 12h16M8 7.5v9.5M13 7.5v9.5' stroke='#64748b' stroke-width='1.6'/>"],
  ["table", "<rect x='2' y='3' width='16' height='14' rx='1.5' fill='none' stroke='#64748b' stroke-width='1.6'/><rect x='2' y='3' width='16' height='4.5' fill='#64748b'/><path d='M2 12h16M8 7.5v9.5M13 7.5v9.5' stroke='#64748b' stroke-width='1.6'/>"]
];

var FALLBACK_ICON = "<rect x='4' y='2' width='12' height='16' rx='2' fill='none' stroke='#64748b' stroke-width='1.6'/><path d='M7 7h6M7 10.5h6M7 14h4' stroke='#64748b' stroke-width='1.6' stroke-linecap='round'/>";

function iconFor(vtype) {
  var t = String(vtype || "").toLowerCase();
  for (var i = 0; i < ICONS.length; i++) {
    if (t.indexOf(ICONS[i][0]) >= 0) return svgIcon(ICONS[i][1]);
  }
  return svgIcon(FALLBACK_ICON);
}

/* **********************************************************************
 *   Verdict_Prose
 *
 *   The wording shared by the field chips and the detail panel, built
 *   from whichever scans actually ran so a verdict never claims more
 *   coverage than it has.
 ********************************************************************** */

//==========// ", and no CRM report references it, and it doesn't govern a blueprint"
function absenceClause(lead) {
  var parts = ranScanAbsences();
  return parts.length ? lead + joinPhrases(parts, "and") : "";
}

//==========// what the current scan actually covered, shown under every verdict
function scopeSummary() {
  var parts = [
    S.tables.length + qty(S.tables.length, " table"),
    S.queryTables.length + qty(S.queryTables.length, " query table")
  ];
  ranScans().forEach(function (sc) { parts.push(S[sc.store].length + qty(S[sc.store].length, " " + sc.unit)); });
  return parts.join(" / ") + " scanned on " + S.scannedAt;
}

/* **********************************************************************
 *   Field_Chips
 ********************************************************************** */

function chipFor(f) {
  var cat = categoryOf(f);
  var out;
  if (cat === "unchecked") {
    out = "<span class='chip unchecked'>&mdash;</span>";
  } else if (cat === "na") {
    out = "<span class='chip na' title='No matching column exists in the scanned Analytics workspaces" +
      absenceClause(", and ") + "'>" + naLabel() + "</span>";
  } else if (cat === "clear") {
    out = "<span class='chip clear' title='Synced to Analytics, but nothing depends on the column" +
      absenceClause(", and ") + "'>unused</span>";
  } else {
    var u = usageCounts(S.results[f.api_name]);
    out = "";
    if (u.analytics > 0) {
      out += "<span class='chip src-an' title='" + u.analytics + qty(u.analytics, " Analytics usage") + "'>" +
        iconFor("chart") + u.analytics + "</span>";
    }
    SOURCES.forEach(function (src) {
      var n = u[src.key];
      if (n > 0) {
        out += "<span class='chip " + src.chip + "' title='" + sourceTip(src, n) + "'>" +
          iconFor(src.icon) + n + "</span>";
      }
    });
  }
  return "<span class='chips'>" + out + "</span>";
}

/* **********************************************************************
 *   Field_List
 ********************************************************************** */

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

function openField(f) {
  S.activeField = f.api_name;
  renderFieldList();
  $("detail-title").innerHTML = "<span class='step'>3</span>Usage: " + esc(f.label);
  $("detail-body").innerHTML = "<p class='section-note'>Checking dependencies&hellip;</p>";
  checkField(f).then(function () { renderFieldList(); renderDetail(f); });
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
    row.onclick = function () { openField(f); };
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

/* **********************************************************************
 *   CSV_Export
 ********************************************************************** */

function csvText(rows) {
  return rows.map(function (r) {
    return r.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(",");
  }).join("\r\n");
}

function downloadCsv(rows, filename) {
  var a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csvText(rows)], { type: "text/csv" }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

//==========// every place one field is used, flattened into one cell
function usageList(r) {
  var uses = [];
  r.columns.forEach(function (c) {
    if (!c.dep) return;
    c.dep.views.forEach(function (v) { uses.push((v.reportType || "view") + ": " + v.viewName); });
    c.dep.customFormulas.forEach(function (cf) { uses.push("formula column: " + cf.columnName); });
    c.dep.aggregateFormulas.forEach(function (af) {
      uses.push("aggregate: " + af.formulaName + " in " + af.parentViewName);
    });
  });
  r.sql.forEach(function (h) { uses.push("query table SQL: " + h.viewName); });
  SOURCES.forEach(function (src) {
    hitsFor(r, src).forEach(function (h) { uses.push(src.csv(h)); });
  });
  return uses;
}

function verdictText(cat) {
  if (cat === "used") return "In use";
  if (cat === "na") return ranScans().length ? "Not synced (absent from Analytics, no CRM references)" : "Not in Analytics";
  return "Unused (synced to Analytics, nothing depends on it)";
}

$("btn-export").onclick = function () {
  var mod = $("module-pick").selectedOptions[0].textContent;
  var rows = [["Module", "Field", "API Name", "Type", "Custom", "Verdict", "Hits", "Used In"]];
  S.fields.forEach(function (f) {
    var cat = categoryOf(f);
    if (cat === "unchecked") return;
    var r = S.results[f.api_name];
    rows.push([mod, f.label, f.api_name, f.type, f.custom ? "yes" : "no",
      verdictText(cat), String(cat === "used" ? hitCount(r) : 0), usageList(r).join("; ")]);
  });
  if (rows.length === 1) { $("check-progress").textContent = "Nothing to export yet: check some fields first."; return; }
  downloadCsv(rows, "zenaudit-" + norm(mod) + ".csv");
};

/* **********************************************************************
 *   Usage_Detail_Panel
 ********************************************************************** */

function usageCard(vtype, name, wsName, link, snippet, linkLabel) {
  return "<div class='usage'><div class='icon'>" + iconFor(vtype) + "</div><div class='meta'>" +
    "<div class='vtype'>" + esc(vtype) + (wsName ? " &middot; " + esc(wsName) : "") + "</div>" +
    "<div class='vname'>" + esc(name) + "</div>" +
    (snippet ? "<div class='snippet'>" + esc(snippet) + "</div>" : "") +
    "</div>" + (link ? "<a href='" + link + "' target='_blank' rel='noopener'>" +
      (linkLabel || "Open in Analytics &rarr;") + "</a>" : "") +
    "</div>";
}

function groupHeading(title, count, unit, sectionId) {
  return "<h3 class='usage-group'" + (sectionId ? " id='" + sectionId + "'" : "") + ">" + title +
    " <span class='gcount'>" + count + (unit ? " " + qty(count, unit) : "") + "</span></h3>";
}

//==========// clickable count tiles that scroll to their own detail section
function verdictBreakdown(r) {
  var analytics = { views: 0, formulas: 0, aggregates: 0 };
  r.columns.forEach(function (c) {
    if (!c.dep) return;
    analytics.views += c.dep.views.length;
    analytics.formulas += c.dep.customFormulas.length;
    analytics.aggregates += c.dep.aggregateFormulas.length;
  });
  var tiles = [
    { n: analytics.views, label: "Analytics views", icon: "chart", target: "section-analytics" },
    { n: analytics.formulas, label: "formula columns", icon: "formula", target: "section-analytics" },
    { n: analytics.aggregates, label: "aggregate formulas", icon: "aggregate", target: "section-analytics" },
    { n: r.sql.length, label: "query table SQL", icon: "query", target: "section-sql" }
  ];
  SOURCES.forEach(function (src) {
    tiles.push({ n: hitsFor(r, src).length, label: src.label || src.unit + "s",
      icon: src.icon, target: "section-" + src.key });
  });
  return tiles.filter(function (t) { return t.n > 0; }).map(function (t) {
    return "<span class='vb vb-link' data-jump='" + t.target + "'>" +
      iconFor(t.icon) + "<b>" + t.n + "</b>&nbsp;" + t.label + "</span>";
  }).join("");
}

function verdictBanner(f, r, n) {
  var scope = scopeSummary();
  if (n > 0) {
    return "<div class='verdict used'><div class='vnum'>" + n + "</div>" +
      "<div class='vmain'><b>" + qty(n, "place") + " use this field</b>" +
      "<small>" + (r.notSynced ? "Not synced to Analytics; found in CRM only. " : "") +
      "Update or retire these before deleting. Scope: " + scope + ".</small></div>" +
      "<div class='verdict-breakdown'>" + verdictBreakdown(r) + "</div></div>";
  }
  if (r.notSynced) {
    return "<div class='verdict na'><b>Not found in " +
      joinPhrases(["Analytics"].concat(ranScanNouns()), "or") + ".</b>" +
      "<small>No synced column named like &ldquo;" + esc(f.label) + "&rdquo; / " + esc(f.api_name) +
      " exists in the scanned workspaces" + absenceClause(", and ") + ". Scope: " + scope + ".</small></div>";
  }
  return "<div class='verdict clear'><b>Safe to delete</b> as far as " +
    joinPhrases(["Analytics"].concat(ranScanNouns()), "and") + " are concerned." +
    "<small>Zoho's dependency engine reports nothing depending on the matched column(s)" +
    absenceClause(", and ") + ". Scope: " + scope + ".</small></div>";
}

//==========// Analytics results come from the dependents API, so they render from
//==========// the matched columns rather than from a SOURCES entry.
function analyticsSections(r) {
  var html = "<div id='section-analytics'>";
  r.columns.forEach(function (c) {
    var where = c.tableName + (c.primary ? "" : " (different table, same column name)");
    if (c.error) {
      html += "<h3 class='usage-group'>" + esc(where) + "</h3>" +
        "<p class='section-note'>Could not read dependents for this column.</p>";
      return;
    }
    var total = c.dep.views.length + c.dep.customFormulas.length + c.dep.aggregateFormulas.length;
    if (!total) return;
    html += groupHeading("Column &ldquo;" + esc(c.columnName) + "&rdquo; in " + esc(where), total, "item");
    //==========// dashboard KPI widgets arrive as bare numeric ids, so they are
    //==========// collapsed into a count rather than shown as meaningless rows
    var named = c.dep.views.filter(function (v) {
      return !/widget/i.test(String(v.reportType || "")) && !/^\d+$/.test(String(v.viewName || ""));
    });
    var widgetCount = c.dep.views.length - named.length;
    html += named.map(function (v) {
      return usageCard(v.reportType || "view", v.viewName, c.wsName, viewLink(c.wsId, v.viewId), "");
    }).join("");
    if (widgetCount > 0) {
      html += "<p class='section-note'>Plus " + widgetCount + qty(widgetCount, " dashboard KPI widget") +
        " built on this column (unnamed components inside dashboards).</p>";
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
    html += groupHeading("Query table SQL matches", r.sql.length, "", "section-sql");
    html += r.sql.map(function (h) {
      return usageCard("QueryTable", h.viewName, h.wsName, viewLink(h.wsId, h.viewId), h.snippet);
    }).join("");
  }
  return html;
}

function renderDetail(f) {
  var r = S.results[f.api_name];
  var html = verdictBanner(f, r, hitCount(r)) + analyticsSections(r);
  SOURCES.forEach(function (src) {
    var hits = hitsFor(r, src);
    if (!hits.length) return;
    html += groupHeading(src.heading(f), hits.length, src.countUnit, "section-" + src.key);
    html += hits.map(src.card).join("");
  });
  html += "<p class='section-note'><button class='link' data-recheck='" + esc(f.api_name) +
    "'>Recheck this field</button></p>";
  $("detail-body").innerHTML = html;
}

//==========// One delegated listener for both in-panel actions, so the rendered
//==========// HTML carries data attributes instead of interpolated inline handlers.
$("detail-body").addEventListener("click", function (e) {
  var jump = e.target.closest("[data-jump]");
  if (jump) {
    var section = document.getElementById(jump.getAttribute("data-jump"));
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  var recheck = e.target.closest("[data-recheck]");
  if (!recheck) return;
  var apiName = recheck.getAttribute("data-recheck");
  var f = S.fields.filter(function (x) { return x.api_name === apiName; })[0];
  if (!f) return;
  delete S.results[apiName];
  //==========// drop the cached dependents too, or the recheck just replays them
  moduleTableFirst(f).forEach(function (m) { delete S.depCache[m.col.columnId]; });
  S.activeField = apiName;
  renderFieldList();
  $("detail-body").innerHTML = "<p class='section-note'>Rechecking&hellip;</p>";
  checkField(f).then(function () { renderFieldList(); renderDetail(f); });
});
