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
 *   columns, Activities' included. A table where nothing lines up at all
 *   is reported as unverifiable rather than as wholesale deletion. See
 *   test/reverse-audit.test.js, which pins each of those.
 *
 *   Read-only: it never touches S.results, checkField, or any verdict.
 */

//==========// A table is only a verified CRM data table if its name maps to exactly
//==========// one module. Ambiguous or unmatched tables are skipped, not guessed at.
//==========//
//==========// The connector names a table "<Module> (Zoho CRM)", so that suffix is
//==========// dropped before the exact comparison. Without it "Contractor Bids (Zoho
//==========// CRM)" fell through to the loose pass, where "Contractor" also fits.
function reverseModuleList() {
  return (S.reverseModules && S.reverseModules.length) ? S.reverseModules : S.modules;
}

function matchModuleForTable(table) {
  var modules = reverseModuleList();
  var tNorm = norm(table.viewName);
  var bare = tNorm.replace(/_zoho_crm$/, "");
  var exact = modules.filter(function (m) {
    return [m.plural_label, m.singular_label, m.api_name].some(function (n) {
      var k = norm(n);
      return !!k && (k === tNorm || k === bare);
    });
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  var contains = modules.filter(function (m) {
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
//==========// SEMODULE is the same kind of thing in Calls, Tasks and Meetings: the
//==========// $se_module record property naming which module "Related To" points
//==========// at. It is in every Activities table and can never be deleted.
var SYNC_OWNED_COLUMNS = {
  id: 1, is_converted: 1, converted_date_time: 1, converted_from_lead: 1,
  semodule: 1, se_module: 1
};

function isAlwaysIgnoredColumn(c) {
  var n = norm(c.columnName);
  return !!SYNC_OWNED_COLUMNS[n] || /_owner_name$/.test(n);
}

//==========// An activity's "Related To" can point at a record in any module, and the
//==========// sync spreads it out into one id column per parent module: Account ID,
//==========// Contact ID, Deal ID, and the same for custom modules. None of them is a
//==========// field, so none can be deleted. Only Activities get this pass, and only
//==========// for a name that really is some module's name plus "id", so a deleted
//==========// custom "Gate ID" in Meetings, or an "Account ID" in Leads, still shows.
var ACTIVITY_MODULES = { Events: 1, Calls: 1, Tasks: 1 };

function isActivityParentIdColumn(c, module) {
  if (!module || !ACTIVITY_MODULES[module.api_name]) return false;
  var m = /^(.+?)_?id$/.exec(norm(c.columnName));
  if (!m) return false;
  return S.modules.some(function (mod) {
    return [mod.singular_label, mod.plural_label, mod.api_name].some(function (n) {
      return !!norm(n) && norm(n) === m[1];
    });
  });
}

//==========// module is optional; without it only the module-blind rules apply
function auditableColumns(table, module) {
  return table.columns.filter(function (c) {
    return !isFormulaColumn(c) && !isAlwaysIgnoredColumn(c) && !isActivityParentIdColumn(c, module);
  });
}

//==========// The sync adds one "<owner label> Name" column per module, named after
//==========// whatever the owner field is called. The _owner_name rule above only
//==========// catches the default label, and Meetings calls its owner "Host", so its
//==========// column is "Host Name". Read off the field list, a relabelled owner is
//==========// covered too. Other lookups get no such column, so they get no pass.
function ownerCompanionKeys(f) {
  if (f.type !== "ownerlookup" && f.api_name !== "Owner") return [];
  return [f.label, f.display].map(function (n) { return norm(n) ? norm(n) + "_name" : ""; });
}

//==========// every name a field can arrive under in Analytics
function fieldKeys(fields) {
  var wanted = {};
  fields.forEach(function (f) {
    [f.label, f.display, f.api_name].concat(ownerCompanionKeys(f)).forEach(function (n) {
      var k = norm(n);
      if (k) wanted[k] = 1;
    });
  });
  return wanted;
}

function unmatchedColumns(table, fields, module) {
  var wanted = fieldKeys(fields);
  return auditableColumns(table, module).filter(function (c) { return !wanted[norm(c.columnName)]; });
}

//==========// Standard fields every module carries, so a column matching one of them
//==========// proves nothing about which module a table belongs to. Keyed by api_name.
//==========// The email trio is in every new custom module by default, which is how a
//==========// "Contractor Bids" table once matched the Contractors module on Email.
var SHARED_SYSTEM_FIELDS = {
  Created_Time: 1, Modified_Time: 1, Created_By: 1, Modified_By: 1, Owner: 1, Tag: 1,
  Last_Activity_Time: 1, Layout: 1, Record_Image: 1, Currency: 1, Exchange_Rate: 1,
  Locked__s: 1, Record_Status__s: 1, Unsubscribed_Mode: 1, Unsubscribed_Time: 1,
  Email: 1, Secondary_Email: 1, Email_Opt_Out: 1
};

//==========// How many columns match a field that belongs to this module in particular.
//==========// Every module has a primary field that cannot be deleted (Last Name,
//==========// Subject, "<Module> Name"), so a table that really is this module's
//==========// sync always scores at least one.
function moduleSpecificMatches(table, fields, module) {
  var specific = fieldKeys(fields.filter(function (f) { return !SHARED_SYSTEM_FIELDS[f.api_name]; }));
  return auditableColumns(table, module).filter(function (c) { return specific[norm(c.columnName)]; }).length;
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

//==========// Every real synced table matches at least one live field, because Created
//==========// Time and Modified Time cannot be deleted. So a table that matches nothing
//==========// says the field list could not be read, or the name match landed on the
//==========// wrong module, never that every field was deleted. Reporting all of its
//==========// columns as orphans is exactly the false alarm this audit must not raise,
//==========// so it is shown as unverifiable instead. A table with no auditable columns
//==========// has nothing to flag either way and is left as it was.
//==========//
//==========// Matching only the fields every module shares is no better: it is the
//==========// shape of a table name-matched to the wrong module, such as a new
//==========// "Contractor Bids" read as "Contractors", where Created Time lines up and
//==========// every real Contractor Bids field reads as deleted. So the evidence has
//==========// to be a field that belongs to this module in particular.
function canVerify(entry, scored) {
  if (!entry.fieldCount) return false;
  return !(scored.total > 0 && scored.specificCount === 0);
}

function unverifiedReason(entry, scored) {
  var mod = entry.module.plural_label;
  if (!entry.fieldCount) return "CRM returned no fields for " + mod;
  if (!scored.matchedCount) return "none of its columns match a " + mod + " field";
  return "only fields every module has line up, nothing specific to " + mod;
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
    S.reverseAuditUnverified = [];
    renderReverseAudit([]);
    return Promise.resolve();
  }
  return runQueue(moduleEntries, function (entry) {
    //==========// one module CRM will not describe (a linking module, a missing
    //==========// scope) is shown as unverifiable rather than ending the whole audit
    return getModuleFields(entry.module).catch(function () { return []; }).then(function (fields) {
      entry.fieldCount = fields.length;
      entry.scored = entry.candidates.map(function (t) {
        var unmatched = unmatchedColumns(t, fields, entry.module);
        var total = auditableColumns(t, entry.module).length;
        var matchedCount = total - unmatched.length;
        return { table: t, unmatched: unmatched, total: total, matchedCount: matchedCount,
                 specificCount: moduleSpecificMatches(t, fields, entry.module),
                 matchRatio: total ? matchedCount / total : 0 };
      }).sort(function (a, b) { return b.matchRatio - a.matchRatio; });
    });
  }, function (i, n, entry) {
    $("scan-progress").innerHTML = "Matching module fields <b>" + i + " / " + n + "</b> - " + esc(entry.module.plural_label);
    showLoader("Matching module fields " + i + " / " + n, n ? i / n : null);
  }).then(function () {
    var verified = [], unverified = [];
    moduleEntries.forEach(function (entry) {
      var usable = [];
      //==========// every table that cannot be stood behind is listed, not just the
      //==========// first, so a second same-named table is never silently dropped
      entry.scored.forEach(function (s) {
        if (canVerify(entry, s)) { usable.push(s); return; }
        unverified.push({
          table: s.table, module: entry.module, columns: s.unmatched, total: s.total,
          matched: s.matchedCount, reason: unverifiedReason(entry, s)
        });
      });
      if (!usable.length) return;
      //==========// still sorted by match ratio, so this is the same pick as before
      //==========// whenever every candidate is usable
      var best = usable[0];
      verified.push({
        table: best.table, module: entry.module, unmatched: best.unmatched,
        skipped: usable.slice(1).map(function (s) { return s.table; })
      });
    });
    S.reverseAuditUnverified = unverified;
    //==========// A broken sync is the only reason anyone opens this, so the tables
    //==========// with something wrong go first, worst first. In an org with a hundred
    //==========// synced tables the one finding would otherwise sit below a screenful
    //==========// of clean ones. Sorted here rather than at render time so the CSV
    //==========// export comes out in the same order.
    verified.sort(function (a, b) { return b.unmatched.length - a.unmatched.length; });
    S.reverseAuditResults = verified;
    return loadOrphanDependents(verified).then(function () { summariseReverseAudit(verified, unverified); });
  });
}

//==========// A clean org ends here with nothing to report, which is the result that
//==========// says the sync is healthy. Anything listed is a column with no field
//==========// behind it, so the count doubles as the count of suspects.
function summariseReverseAudit(verified, unverified) {
  unverified = unverified || [];
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
    (unverified.length ? " · " + unverified.length + " table" + (unverified.length === 1 ? "" : "s") +
      " could not be verified" : "") +
    "</span>";
  renderReverseAudit(verified, unverified);
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


//==========// Tables the audit could not stand behind, listed rather than dropped so
//==========// nobody mistakes silence for a clean bill. Deliberately no rebuild advice:
//==========// nothing here is known to be missing.
function unverifiedSection(unverified) {
  if (!unverified.length) return "";
  var html = "<h3 class='usage-group'>Could not verify</h3>" +
    "<p class='section-note'>These tables were not checked, because none of their columns " +
    "line up with a field that belongs to the module they were matched to. A real sync always " +
    "carries the module's own name field, which cannot be deleted, so this means the field list " +
    "could not be read or the table belongs to a different module, not that its fields were " +
    "deleted. Reload the widget if the module is new, and check the CRM connection user can " +
    "see it.</p>";
  unverified.forEach(function (u) {
    html += "<h3 class='usage-group'>" + esc(u.table.viewName) + " &rarr; " + esc(u.module.plural_label) +
      " <span class='gcount unverified'>not verified</span></h3>" +
      "<p class='section-note'>" + esc(u.reason) +
      (u.total ? ": " + (u.matched || 0) + " of " + u.total + qty(u.total, " column") + " match" : "") +
      (u.columns.length ? " (" + u.columns.map(function (c) { return esc(c.columnName); }).join(", ") + ")" : "") +
      ".</p>";
  });
  return html;
}

function renderReverseAudit(verified, unverified) {
  unverified = unverified || [];
  var box = $("reverse-audit-results");
  if (!verified.length) {
    box.innerHTML = unverified.length ? unverifiedSection(unverified) :
      "<p class='section-note'>No scanned Analytics table's name matched a CRM module, " +
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
    if (unverified.length) {
      html += "<p class='section-note'>" + unverified.length + qty(unverified.length, " table") +
        " at the bottom could not be checked, so this does not cover " +
        (unverified.length === 1 ? "it" : "them") + ".</p>";
    }
  } else {
    //==========// the wording Analytics itself uses, so the two screens connect
    html += "<p class='section-note'>If Analytics is refusing to sync with <i>one or " +
      "more selected fields/modules are not synchronized from Zoho CRM</i>, the " +
      "columns below are why. Each one needs either its CRM field back or its " +
      "Analytics dependents cleared before the sync will run again.</p>";
  }
  verified.forEach(function (v) {
    var n = v.unmatched.length;
    //==========// the badge is green everywhere else in the widget, where a count is
    //==========// just a count. Here a count above zero is the bad news, so it must
    //==========// not read as a reassuring tick.
    html += "<h3 class='usage-group'>" + esc(v.table.viewName) + " &rarr; " + esc(v.module.plural_label) +
      " <span class='gcount" + (n ? " flagged" : "") + "'>" + n +
      (n === 1 ? " unmatched column" : " unmatched columns") + "</span></h3>";
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
  box.innerHTML = html + unverifiedSection(unverified);
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
