"use strict";

/* **********************************************************************
 *   Reverse_Analytics_Audit
 ********************************************************************** */

/*
 *   The opposite direction of the main field check. Instead of asking
 *   whether a CRM field has a matching Analytics column, this asks whether
 *   an Analytics column still has a matching CRM field, surfacing columns
 *   left behind by a renamed or deleted field.
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

function getModuleFields(mod) {
  if (S.moduleFieldsCache[mod.api_name]) return Promise.resolve(S.moduleFieldsCache[mod.api_name]);
  return ZOHO.CRM.META.getFields({ Entity: mod.api_name }).then(function (resp) {
    var fields = (resp.fields || []).map(function (f) {
      return { label: f.field_label, api_name: f.api_name };
    });
    S.moduleFieldsCache[mod.api_name] = fields;
    return fields;
  });
}

//==========// A formula column's dataType still reads as its output type, so the
//==========// non-empty formula expression is what marks it as derived rather than
//==========// synced. Derived columns are never orphans.
function isFormulaColumn(c) {
  return !!(c.formula && c.formula.trim());
}

//==========// Analytics adds its own "Id" and "<Module> Owner Name" columns to every
//==========// synced module. Neither is meant to have a CRM field behind it.
function isAlwaysIgnoredColumn(c) {
  var n = norm(c.columnName);
  return n === "id" || /_owner_name$/.test(n);
}

function auditableColumns(table) {
  return table.columns.filter(function (c) { return !isFormulaColumn(c) && !isAlwaysIgnoredColumn(c); });
}

function unmatchedColumns(table, fields) {
  var wanted = {};
  fields.forEach(function (f) {
    wanted[norm(f.label)] = 1;
    wanted[norm(f.api_name)] = 1;
  });
  return auditableColumns(table).filter(function (c) { return !wanted[norm(c.columnName)]; });
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
    var totalUnmatched = verified.reduce(function (n, v) { return n + v.unmatched.length; }, 0);
    var totalSkipped = verified.reduce(function (n, v) { return n + v.skipped.length; }, 0);
    var p = $("scan-progress");
    p.classList.add("done");
    p.innerHTML = "<b>Reverse audit · " + esc(S.scannedAt) + "</b><span class='scan-stats'>" +
      verified.length + " verified table" + (verified.length === 1 ? "" : "s") + " · " +
      totalUnmatched + " unmatched column" + (totalUnmatched === 1 ? "" : "s") +
      (totalSkipped ? " · " + totalSkipped + " same-named table" + (totalSkipped === 1 ? "" : "s") + " skipped" : "") +
      "</span>";
    renderReverseAudit(verified);
  });
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
        c.columnName, v.table.wsName, viewLink(v.table.wsId, v.table.viewId), "");
    }).join("");
  });
  box.innerHTML = html;
  $("btn-reverse-audit-export").classList.remove("hidden");
}

$("btn-reverse-audit-export").onclick = function () {
  if (!S.reverseAuditResults || !S.reverseAuditResults.length) return;
  var rows = [["Analytics Table", "Workspace", "CRM Module", "Column", "Column Type"]];
  S.reverseAuditResults.forEach(function (v) {
    v.unmatched.forEach(function (c) {
      rows.push([v.table.viewName, v.table.wsName, v.module.plural_label, c.columnName, c.dataType || ""]);
    });
  });
  if (rows.length === 1) return;
  downloadCsv(rows, "reverse-analytics-audit.csv");
};
