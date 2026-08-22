"use strict";

/* **********************************************************************
 *   Reverse_Analytics_Audit
 ********************************************************************** */

/*
 *   The opposite direction of the main field check. Instead of asking
 *   whether a CRM field has a matching Analytics column, this asks whether
 *   an Analytics column still has a matching CRM field.
 *
 *   For when a sync has broken and nobody knows which field did it: find
 *   the columns with nothing behind them, then spend a metered call on each
 *   to report what in Analytics is built on it. Naming the damage is the
 *   job; repairing it is the user's call and not something a read-only
 *   widget should attempt.
 *
 *   A false alarm here is worse than silence, because it sends someone
 *   hunting a break that never happened. Every column reported has
 *   survived a field list that includes fields on no layout, all three
 *   names a relabelled field answers to, and the sync's own bookkeeping
 *   columns. See test/reverse-audit.test.js, which pins each of those.
 *
 *   Read-only: it never touches S.results, checkField, or any verdict.
 */

//==========// A table is only a verified CRM data table if its name maps to exactly
//==========// one module. Ambiguous or unmatched tables are skipped, not guessed at.
function matchModuleForTable(table) {
  var tNorm = norm(table.viewName);
  var exact = S.modules.filter(function (m) {
    return norm(m.plural_label) === tNorm || norm(m.singular_label) === tNorm || norm(m.api_name) === tNorm;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  var contains = S.modules.filter(function (m) {
    return tNorm.indexOf(norm(m.plural_label)) >= 0 || tNorm.indexOf(norm(m.singular_label)) >= 0;
  });
  return contains.length === 1 ? contains[0] : null;
}

//==========// Shared with the forward check, so both directions agree on what exists.
//==========// Crucially it includes fields that sit on no layout, which the SDK's
//==========// getFields omits and which used to read here as deleted fields.
function getModuleFields(mod) {
  return fetchModuleFields(mod.api_name);
}

//==========// A formula column's dataType still reads as its output type, so the
//==========// non-empty formula expression is what marks it as derived rather than
//==========// synced. Derived columns are never orphans.
function isFormulaColumn(c) {
  return !!(c.formula && c.formula.trim());
}

//==========// Columns the sync creates for itself, which no field list will ever
//==========// contain. "Id" and "<Module> Owner Name" are its own keys. The conversion
//==========// columns come from the $converted and $converted_detail record properties
//==========// rather than from the module's fields, so they are not fields at all.
var SYNC_OWNED_COLUMNS = {
  id: 1, is_converted: 1, converted_date_time: 1, converted_from_lead: 1
};

function isAlwaysIgnoredColumn(c) {
  var n = norm(c.columnName);
  return !!SYNC_OWNED_COLUMNS[n] || /_owner_name$/.test(n);
}

function auditableColumns(table) {
  return table.columns.filter(function (c) { return !isFormulaColumn(c) && !isAlwaysIgnoredColumn(c); });
}

function unmatchedColumns(table, fields) {
  var wanted = {};
  fields.forEach(function (f) {
    [f.label, f.display, f.api_name].forEach(function (n) {
      var k = norm(n);
      if (k) wanted[k] = 1;
    });
  });
  return auditableColumns(table).filter(function (c) { return !wanted[norm(c.columnName)]; });
}

//==========// Only now, on the few columns that really have nothing behind them, is it
//==========// worth a metered call each to find out what they take down. A healthy org
//==========// has no orphans, so this usually costs nothing at all.
function loadOrphanDependents(verified) {
  var orphans = [];
  verified.forEach(function (v) {
    v.unmatched.forEach(function (c) { orphans.push({ table: v.table, col: c }); });
  });
  if (!orphans.length) return Promise.resolve();
  return runQueue(orphans, function (o) {
    return getDependents(o).then(function (dep) { o.col.dep = dep; })
      .catch(function () { o.col.depError = true; });
  }, function (i, n) {
    $("scan-progress").innerHTML = "Checking what depends on unmatched columns <b>" + i + " / " + n + "</b>";
    showLoader("Checking what depends on unmatched columns " + i + " / " + n, n ? i / n : null);
  });
}

//==========// Names alone are not a reliable disambiguator: one workspace can hold
//==========// both "Accounts" and "Accounts (Zoho CRM)". So candidates are grouped
//==========// by module, then scored on how many columns actually line up with that
//==========// module's fields, and the losers are reported rather than hidden.
function runReverseAudit() {
  showLoader("Matching Analytics tables to CRM modules...");
  var byModule = {};
  S.tables.forEach(function (t) {
    var mod = matchModuleForTable(t);
    if (!mod) return;
    if (!byModule[mod.api_name]) byModule[mod.api_name] = { module: mod, candidates: [] };
    byModule[mod.api_name].candidates.push(t);
  });
  var moduleEntries = Object.keys(byModule).map(function (k) { return byModule[k]; });
  if (!moduleEntries.length) {
    S.reverseAuditResults = [];
    renderReverseAudit([]);
    return Promise.resolve();
  }
  return runQueue(moduleEntries, function (entry) {
    return getModuleFields(entry.module).then(function (fields) {
      entry.scored = entry.candidates.map(function (t) {
        var unmatched = unmatchedColumns(t, fields);
        var total = auditableColumns(t).length;
        var matchedCount = total - unmatched.length;
        return { table: t, unmatched: unmatched, matchRatio: total ? matchedCount / total : 0 };
      }).sort(function (a, b) { return b.matchRatio - a.matchRatio; });
    });
  }, function (i, n, entry) {
    $("scan-progress").innerHTML = "Matching module fields <b>" + i + " / " + n + "</b> - " + esc(entry.module.plural_label);
    showLoader("Matching module fields " + i + " / " + n, n ? i / n : null);
  }).then(function () {
    var verified = moduleEntries.map(function (entry) {
      var best = entry.scored[0];
      return {
        table: best.table, module: entry.module, unmatched: best.unmatched,
        skipped: entry.scored.slice(1).map(function (s) { return s.table; })
      };
    });
    S.reverseAuditResults = verified;
    return loadOrphanDependents(verified).then(function () { summariseReverseAudit(verified); });
  });
}

//==========// A clean org ends here with nothing to report, which is the result that
//==========// says the sync is healthy. Anything listed is a column with no field
//==========// behind it, so the count doubles as the count of suspects.
function summariseReverseAudit(verified) {
  var totalUnmatched = verified.reduce(function (n, v) { return n + v.unmatched.length; }, 0);
  var totalSkipped = verified.reduce(function (n, v) { return n + v.skipped.length; }, 0);
  var totalImpact = 0;
  verified.forEach(function (v) {
    v.unmatched.forEach(function (c) { if (c.dep) totalImpact += dependentCount(c.dep); });
  });
  var p = $("scan-progress");
  p.classList.add("done");
  p.innerHTML = "<b>Reverse audit · " + esc(S.scannedAt) + "</b><span class='scan-stats'>" +
    verified.length + " verified table" + (verified.length === 1 ? "" : "s") + " · " +
    totalUnmatched + " unmatched column" + (totalUnmatched === 1 ? "" : "s") +
    (totalUnmatched ? " · " + totalImpact + " affected Analytics item" + (totalImpact === 1 ? "" : "s") : "") +
    (totalSkipped ? " · " + totalSkipped + " same-named table" + (totalSkipped === 1 ? "" : "s") + " skipped" : "") +
    "</span>";
  renderReverseAudit(verified);
}

//==========// The whole point of the audit: this column has no field behind it, and
//==========// this is what in Analytics goes down with it. Fixing is the user's call,
//==========// so this only reports the blast radius.
function orphanImpact(c, table) {
  if (c.depError) {
    return "<p class='section-note'>Could not read what depends on this column.</p>";
  }
  if (!c.dep) return "";
  var total = dependentCount(c.dep);
  if (!total) {
    return "<p class='section-note'>Nothing else in Analytics is built on this column, " +
      "so removing it costs only the column itself.</p>";
  }
  return "<p class='section-note'>" + total + qty(total, " Analytics item") +
    (total === 1 ? " is" : " are") + " built on this column and " +
    (total === 1 ? "breaks" : "break") + " with it:</p>" +
    dependentCards(c.dep, table.wsName, table.wsId);
}

//==========// Analytics column type to the CRM field type to rebuild as. Once the CRM
//==========// field is gone the Analytics column is the only surviving record of what
//==========// it was, so the type is read off the column. Analytics flattens several
//==========// CRM types into one, so where a column type maps to more than one field
//==========// type the alternatives are named rather than silently guessed at.
//==========//
//==========// This is the whole set: 13 column types across the 3,669 columns of a
//==========// large, messy org, so it is unlikely to meet something new.
var CRM_TYPE_FOR_COLUMN = {
  plain_text: { as: "Single Line", or: "Pick List, Phone or Multi-Select" },
  number: { as: "Number", or: "Long Integer or a Lookup to another module" },
  positive_number: { as: "Number", or: "Long Integer or Auto-Number" },
  decimal_number: { as: "Decimal" },
  currency: { as: "Currency" },
  percentage: { as: "Percent" },
  date: { as: "Date", or: "Date/Time" },
  multi_line_text: { as: "Multi-Line" },
  yes_no_decision: { as: "Checkbox" },
  url: { as: "URL" },
  e_mail: { as: "Email" },
  auto_number: { as: "Auto-Number" },
  geo_column: { as: "Address", or: "one component of an Address field" }
};

function crmTypeForColumn(dataType) {
  return CRM_TYPE_FOR_COLUMN[norm(dataType)] || null;
}

//==========// Both routes out, in the order that loses least. Rebuilding is the one
//==========// confirmed against a live org: the sync recovered and the dependent query
//==========// survived untouched. Clearing the dependents is Zoho's own advice, which
//==========// works but discards whatever they were showing. Matching the name is what
//==========// restores the sync; matching the type is what keeps formulas and query
//==========// casts from breaking quietly afterwards.
function orphanFix(c, table, module) {
  var name = "<b>" + esc(c.columnName) + "</b>";
  var t = crmTypeForColumn(c.dataType);
  var rebuild = "rebuild it on <b>" + esc(module.plural_label) + "</b> with the exact name " +
    name + (t ? " as a <b>" + t.as + "</b> field" : "") + ", then re-sync";
  //==========// only where the column type genuinely cannot tell them apart
  var caveat = (t && t.or) ? " Analytics stores this as <b>" + esc(c.dataType) +
    "</b>, which also covers " + t.or + ", so check which it was." : "";
  var n = c.dep ? dependentCount(c.dep) : 0;
  if (n) {
    return "<p class='section-note'><b>To fix, either:</b><br>" +
      "&bull; remove " + name + " from the " + n + qty(n, " item") + " above, which is " +
      "Zoho's own advice and loses what they showed<br>" +
      "&bull; or " + rebuild + ", which keeps them." + caveat + "</p>";
  }
  return "<p class='section-note'><b>To fix:</b> " + rebuild +
    ". Or let the sync drop the column, since nothing is built on it." + caveat + "</p>";
}


function renderReverseAudit(verified) {
  var box = $("reverse-audit-results");
  if (!verified.length) {
    box.innerHTML = "<p class='section-note'>No scanned Analytics table's name matched a CRM module, " +
      "so there's nothing to audit. Make sure the Analytics workspace with your CRM-synced tables was included.</p>";
    $("btn-reverse-audit-export").classList.add("hidden");
    return;
  }
  var html = "";
  //==========// nothing found is the healthy answer, not an empty screen
  if (!verified.some(function (v) { return v.unmatched.length; })) {
    html += "<p class='section-note'>Every column in all " + verified.length +
      " matched " + qty(verified.length, "table") + " has a CRM field behind it, " +
      "so nothing here points at a broken sync.</p>";
  } else {
    //==========// the wording Analytics itself uses, so the two screens connect
    html += "<p class='section-note'>If Analytics is refusing to sync with <i>one or " +
      "more selected fields/modules are not synchronized from Zoho CRM</i>, the " +
      "columns below are why. Each one needs either its CRM field back or its " +
      "Analytics dependents cleared before the sync will run again.</p>";
  }
  verified.forEach(function (v) {
    html += "<h3 class='usage-group'>" + esc(v.table.viewName) + " &rarr; " + esc(v.module.plural_label) +
      " <span class='gcount'>" + v.unmatched.length +
      (v.unmatched.length === 1 ? " unmatched column" : " unmatched columns") + "</span></h3>";
    if (v.skipped.length) {
      html += "<p class='section-note'>Also name-matched but scored lower on how many columns line up with " +
        esc(v.module.plural_label) + " fields, likely a different app's table with a similar name: " +
        v.skipped.map(function (t) { return esc(t.viewName); }).join(", ") + ".</p>";
    }
    if (!v.unmatched.length) {
      html += "<p class='section-note'>Every column in this table matches a CRM field.</p>";
      return;
    }
    html += v.unmatched.map(function (c) {
      return usageCard("Analytics table column" + (c.dataType ? " (" + c.dataType + ")" : ""),
        c.columnName, v.table.wsName, viewLink(v.table.wsId, v.table.viewId), "") +
        orphanImpact(c, v.table) + orphanFix(c, v.table, v.module);
    }).join("");
  });
  box.innerHTML = html;
  $("btn-reverse-audit-export").classList.remove("hidden");
}

$("btn-reverse-audit-export").onclick = function () {
  if (!S.reverseAuditResults || !S.reverseAuditResults.length) return;
  var rows = [["Analytics Table", "Workspace", "CRM Module", "Column", "Column Type",
    "Affected Analytics Items"]];
  S.reverseAuditResults.forEach(function (v) {
    v.unmatched.forEach(function (c) {
      rows.push([v.table.viewName, v.table.wsName, v.module.plural_label, c.columnName,
        c.dataType || "", c.dep ? String(dependentCount(c.dep)) : ""]);
    });
  });
  if (rows.length === 1) return;
  downloadCsv(rows, "reverse-analytics-audit.csv");
};
