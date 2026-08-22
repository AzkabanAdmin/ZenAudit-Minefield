"use strict";
//==========// A full scan of a large org costs minutes and thousands of metered
//==========// calls, so it is saved as a file rather than re-run. That file is
//==========// picked by hand and could be anything, so it is validated before
//==========// anything reads it, and a round trip has to come back identical.
//==========// Run with: npm test

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app", "js");

const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, value: "", textContent: "", innerHTML: "", disabled: false, files: null,
      _c: new Set(),
      classList: {
        add: (c) => els[id]._c.add(c),
        remove: (c) => els[id]._c.delete(c),
        toggle: (c, on) => (on ? els[id]._c.add(c) : els[id]._c.delete(c)),
        contains: (c) => els[id]._c.has(c),
      },
      appendChild() {}, remove() {}, click() {}, setAttribute() {},
      getAttribute: () => null, querySelectorAll: () => [],
      selectedOptions: [{ textContent: "Deals" }],
    };
  }
  return els[id];
}

const store = {};
const sandbox = {
  console, Promise, JSON, String, Math, RegExp, Array, Object, Number, Boolean, isNaN,
  encodeURIComponent, Date, setTimeout: (f) => f(), clearTimeout: () => {},
  URL: { createObjectURL: () => "blob:stub" },
  Blob: function (parts) { this.parts = parts; },
  //==========// a reader the test drives: __nextRead decides what the handler sees
  FileReader: function () {
    var self = this;
    this.readAsText = function () {
      var pending = sandbox.__nextRead || { text: "" };
      if (pending.fail) { if (self.onerror) self.onerror(); return; }
      self.result = pending.text;
      if (self.onload) self.onload();
    };
  },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  document: {
    getElementById: el, createElement: () => el("anchor"),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, body: el("body"),
  },
  ZOHO: { CRM: { META: {}, CONNECTION: { invoke: () => Promise.resolve({}) }, CONFIG: {} } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["state.js", "helpers.js", "sources.js", "loader.js", "scan.js", "fields.js"]) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), "utf8"), sandbox, { filename: f });
}

//==========// finishScan hands off to the field list, which is another file's job.
//==========// This suite is about the scan file, so that boundary is stubbed.
sandbox.loadFields = function () {};
sandbox.renderFieldList = function () {};

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name +
    (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

const S = sandbox.S;

//==========// a scan with something in every source, so a round trip has work to do
function loadFixtureIntoState() {
  S.crmZgid = "org-A";
  S.orgId = "an-1";
  S.scannedAt = "8/20/2026, 6:55:16 PM";
  S.viewCount = 817;
  S.viewsUnreadable = 0;
  S.analyticsScanned = true;
  S.reportsSkippedStale = 79;
  S.tables = [{ viewId: "v1", viewName: "Deals", columns: [{ columnId: "c1", columnName: "Stage" }] }];
  S.queryTables = [{ viewId: "q1", viewName: "SQL", sql: "select 1" }];
  S.functions = [{ id: "f1", name: "fn", code: "x = 1;" }];
  S.functionsScanned = true;
  S.workflowRules = [{ id: "r1", name: "rule", moduleId: "m1", triggerFields: [], criteriaFields: [] }];
  S.workflowRulesScanned = true;
  S.blueprintFields = [];
  S.blueprintFieldsScanned = true;
  //==========// each entry cost one metered Analytics call
  S.depCache = { c1: { views: [{ viewName: "Pipeline", viewId: "v9" }],
    customFormulas: [], aggregateFormulas: [] } };
  el("dc").value = "https://analyticsapi.zoho.com";
}

/* **********************************************************************
 *   A_Round_Trip_Is_Lossless
 ********************************************************************** */

loadFixtureIntoState();
const saved = JSON.parse(JSON.stringify(sandbox.scanPayload()));

//==========// wipe state the way a fresh browser would
S.tables = []; S.queryTables = []; S.functions = []; S.workflowRules = [];
S.functionsScanned = false; S.workflowRulesScanned = false; S.viewCount = 0;
S.scannedAt = null; S.reportsSkippedStale = 0; S.depCache = {};

check("the saved file passes validation", sandbox.validateScanFile(saved), null);

sandbox.restoreScan(saved);
check("tables come back", S.tables.length, 1);
check("their columns come back", S.tables[0].columns[0].columnName, "Stage");
check("query tables come back", S.queryTables[0].sql, "select 1");
check("function source comes back", S.functions[0].code, "x = 1;");
check("scanned flags come back", [S.functionsScanned, S.workflowRulesScanned], [true, true]);
check("the view count comes back", S.viewCount, 817);
check("the scan date comes back", S.scannedAt, "8/20/2026, 6:55:16 PM");
check("the stale report count comes back", S.reportsSkippedStale, 79);

//==========// the dependents are the expensive part, so losing them would mean paying
//==========// for the same calls again
check("fetched dependents come back", Object.keys(S.depCache), ["c1"]);
check("with their payload intact", S.depCache.c1.views[0].viewName, "Pipeline");

//==========// saving the restored state must produce the same file again
const resaved = JSON.parse(JSON.stringify(sandbox.scanPayload()));
check("saving what was loaded produces the same file", resaved, saved);

/* **********************************************************************
 *   A_Bad_File_Is_Refused_Rather_Than_Half_Loaded
 ********************************************************************** */

function rejects(label, obj) {
  const problem = sandbox.validateScanFile(obj);
  check(label, typeof problem === "string" && problem.length > 0, true);
}

rejects("null is refused", null);
rejects("a string is refused", "not a scan");
rejects("an empty object is refused", {});
rejects("a file with no tables array is refused", { at: "now", queryTables: [] });
rejects("a file with no query tables array is refused", { at: "now", tables: [] });
rejects("a file with no scan date is refused", { tables: [], queryTables: [] });
rejects("a file from a future format is refused",
  { format: "zenaudit-scan-99", at: "now", tables: [], queryTables: [] });
rejects("a damaged source list is refused",
  { at: "now", tables: [], queryTables: [], functions: "oops" });

//==========// a minimal but honest file is accepted
check("a scan with no CRM sources is still valid",
  sandbox.validateScanFile({ format: "zenaudit-scan-1", at: "now", tables: [], queryTables: [] }), null);

//==========// a file predating the format marker still loads
check("a file with no format marker is accepted",
  sandbox.validateScanFile({ at: "now", tables: [], queryTables: [] }), null);

//==========// and a file from before dependents were saved restores to an empty cache
S.depCache = { stale: 1 };
sandbox.restoreScan({ at: "now", tables: [], queryTables: [] });
check("a file with no dependents leaves an empty cache", S.depCache, {});

/* **********************************************************************
 *   Housekeeping
 ********************************************************************** */

loadFixtureIntoState();
check("a real scan is worth saving", sandbox.scanIsWorthSaving(), true);
check("the filename names the org and the time",
  /^zenaudit-scan-org-A-8-20-2026-6-55-16-PM\.json$/.test(sandbox.scanFileName()), true);

S.scannedAt = null;
check("nothing to save before a scan", sandbox.scanIsWorthSaving(), false);

sandbox.updateScanFileButtons();
check("so the save button stays hidden", el("btn-export-scan")._c.has("hidden"), true);

loadFixtureIntoState();
sandbox.updateScanFileButtons();
check("and appears once there is a scan", el("btn-export-scan")._c.has("hidden"), false);

/* **********************************************************************
 *   Loading_A_File_Runs_The_Real_Handler
 *
 *   The browser's own picker cannot be driven from a test, but everything
 *   after it can: this invokes the widget's actual onchange handler with a
 *   stubbed reader, so the parse, the validation, the restore and the
 *   error paths are the shipped ones.
 ********************************************************************** */

const fileInput = el("scan-file");
check("the widget bound a change handler to the picker", typeof fileInput.onchange, "function");

function pickFile(name, text, opts) {
  sandbox.__nextRead = { text: text, fail: !!(opts && opts.fail) };
  el("setup-error").textContent = "";
  el("setup-error")._c.add("hidden");
  fileInput.files = [{ name: name }];
  fileInput.onchange.call(fileInput);
}

function lastError() {
  return el("setup-error")._c.has("hidden") ? null : el("setup-error").textContent;
}

//==========// a good file loads over whatever was there before
loadFixtureIntoState();
const goodText = JSON.stringify(sandbox.scanPayload());
S.tables = []; S.functions = []; S.scannedAt = null; S.functionsScanned = false;

pickFile("saved.json", goodText);
check("a saved scan loads", S.tables.length, 1);
check("its functions load", S.functions.length, 1);
check("its date loads", S.scannedAt, "8/20/2026, 6:55:16 PM");
check("it is marked as loaded rather than scanned", S.importedFrom, "saved.json");
check("a good file raises no error", lastError(), null);

//==========// the picker is cleared so the same file can be chosen again
check("the picker is reset after a load", fileInput.value, "");

//==========// a scan from another org loads, but says which org it describes
S.crmZgid = "org-B";
pickFile("other-org.json", goodText);
check("a scan from another org still loads", S.tables.length, 1);
check("and warns that it describes a different org",
  /different org/.test(lastError() || ""), true);
S.crmZgid = "org-A";

//==========// junk is refused without disturbing what is on screen
S.tables = [{ viewName: "kept" }];
pickFile("notes.txt", "this is not json at all");
check("invalid json is refused", /not valid JSON/.test(lastError() || ""), true);
check("and state is left alone", S.tables[0].viewName, "kept");

//==========// valid JSON that is not a scan is refused too, naming what is missing
pickFile("wrong.json", JSON.stringify({ hello: "world" }));
check("json that is not a scan is refused",
  /missing its Analytics tables/.test(lastError() || ""), true);
check("state is still untouched", S.tables[0].viewName, "kept");

//==========// and something that is not even an object
pickFile("array.json", JSON.stringify([1, 2, 3]));
check("a json array is refused", !!lastError(), true);
check("state survives that too", S.tables[0].viewName, "kept");

//==========// an unreadable file reports rather than failing quietly
pickFile("locked.json", "", { fail: true });
check("a read failure is reported", /Could not read/.test(lastError() || ""), true);

/* **********************************************************************
 *   Offering_To_Save_After_A_Long_Scan
 *
 *   Based on how long the run actually took, so the offer only appears
 *   when the wait was real.
 ********************************************************************** */

loadFixtureIntoState();
S.importedFrom = null;

S.lastScanSeconds = 8;
sandbox.maybeSuggestSave();
check("a quick scan is not worth an offer", el("save-nudge")._c.has("hidden"), true);

S.lastScanSeconds = 400;
sandbox.maybeSuggestSave();
check("a long scan is", el("save-nudge")._c.has("hidden"), false);
check("and the offer says how long it took",
  /about 7 minutes/.test(el("save-nudge-text").innerHTML), true);

//==========// a loaded scan is already a file, so there is nothing to offer
S.importedFrom = "saved.json";
sandbox.maybeSuggestSave();
check("a loaded scan gets no offer", el("save-nudge")._c.has("hidden"), true);


/* **********************************************************************
 *   A_Rescan_Discards_What_It_Must
 *
 *   Someone rescans precisely because they have just changed something in
 *   CRM. Keeping the module field lists made a rebuilt field still read as
 *   deleted until the page was reloaded, so the reverse audit went on
 *   reporting a break that had already been fixed.
 ********************************************************************** */

S.depCache = { c1: { views: [], customFormulas: [], aggregateFormulas: [] } };
S.moduleFieldsCache = { Leads: [{ api_name: "Website", label: "Website" }] };
S.tables = [{ viewName: "from the previous run" }];

sandbox.beginScan();

check("a rescan drops the dependents it paid for", S.depCache, {});
check("and the module field lists, so a rebuilt field is seen", S.moduleFieldsCache, {});
check("and the tables it is about to replace", S.tables, []);

/* **********************************************************************
 *   The_File_Shape_Is_Pinned
 *
 *   A saved scan is the only artefact of this app that outlives the
 *   session, and it can be loaded on another machine months later. So the
 *   key set is spelled out here rather than left to whatever scanPayload
 *   happens to return. Adding a source to SCANS legitimately adds two keys
 *   and this check will say which; anything else drifting is a bug.
 ********************************************************************** */

loadFixtureIntoState();
check("the saved file holds exactly these keys", Object.keys(sandbox.scanPayload()).sort(), [
  "analyticsScanned", "at", "blueprintFields", "blueprintFieldsScanned",
  "connectedWorkflowRules", "connectedWorkflowRulesScanned", "crmZgid", "dc",
  "depCache", "format", "functions", "functionsScanned", "orgId", "queryTables",
  "reports", "reportsScanned", "reportsSkippedStale", "scoringRules",
  "scoringRulesScanned", "tables", "viewCount", "viewsUnreadable", "webhookActions",
  "webhookActionsScanned", "workflowFieldUpdates", "workflowFieldUpdatesScanned",
  "workflowRules", "workflowRulesScanned",
]);

//==========// Deliberately absent. CRM field lists are read live from the settings
//==========// endpoint on every scan, because a field parked off a layout, renamed or
//==========// deleted since the file was written must not be answered from it. Saving
//==========// them would be the same stale-cache bug the app already had once.
check("the field lists are not saved into the file",
  Object.keys(sandbox.scanPayload()).indexOf("moduleFieldsCache"), -1);

/* **********************************************************************
 *   A_Loaded_Scan_Produces_The_Same_Verdicts
 *
 *   The round trip above proves the bytes survive. This proves the app
 *   behaves the same on the far side of one, which is the property anyone
 *   loading a saved scan actually depends on.
 ********************************************************************** */

//==========// any dependents fetch here would mean the file failed to carry them
let depFetches = 0;
sandbox.analyticsGet = function () {
  depFetches++;
  return Promise.resolve({ data: { views: [], customFormulas: [], aggregateFormulas: [] } });
};

(async function () {
  loadFixtureIntoState();
  S.modules = [{ api_name: "Deals", id: "M1", plural_label: "Deals", singular_label: "Deal" }];
  el("module-pick").value = "Deals";

  const stage = { api_name: "Stage", label: "Stage", type: "picklist", custom: false };

  function verdictOf(r) {
    return {
      hits: sandbox.hitCount(r),
      category: sandbox.categoryOf(stage),
      notSynced: r.notSynced,
      analytics: sandbox.analyticsHitCount(r),
      columns: r.columns.length,
      unchecked: sandbox.uncheckedCount(r),
    };
  }

  S.results = {};
  const before = verdictOf(await sandbox.checkField(stage));
  check("the field has a real verdict to compare against", before.analytics > 0, true);
  check("and it needed no network, the scan carried it", depFetches, 0);

  //==========// save it, then wipe state the way a fresh browser would
  const file = JSON.parse(JSON.stringify(sandbox.scanPayload()));
  S.tables = []; S.queryTables = []; S.functions = []; S.workflowRules = [];
  S.depCache = {}; S.results = {}; S.scannedAt = null;
  S.functionsScanned = false; S.workflowRulesScanned = false;

  check("the saved file validates", sandbox.validateScanFile(file), null);
  sandbox.restoreScan(file);

  //==========// forget the answers, keep the data, so this is a genuine re-check
  S.results = {};
  const after = verdictOf(await sandbox.checkField(stage));

  check("a loaded scan gives the identical verdict", after, before);
  check("and still bought no dependents, they came from the file", depFetches, 0);

  //==========// the same holds for a field the scan says nothing about
  const ghost = { api_name: "Ghost_Field", label: "Ghost Field", type: "text", custom: true };
  const ghostResult = await sandbox.checkField(ghost);
  check("a field absent from the loaded scan reads as not synced", ghostResult.notSynced, true);

  /* **********************************************************************
   *   A_Real_File_From_An_Older_Version_Still_Loads
   *
   *   Saved files outlive the code that wrote them. This one is a genuine
   *   233 table export taken before format, crmZgid and depCache existed,
   *   which is exactly the file someone rediscovers in a Downloads folder
   *   months later. It has to load rather than be refused.
   ********************************************************************** */

  const REAL = path.join(__dirname, "fixtures", "scan-cache.json");
  if (!fs.existsSync(REAL)) {
    console.log("SKIP real file check: test/fixtures/scan-cache.json is not present");
  } else {
    const old = JSON.parse(fs.readFileSync(REAL, "utf8"));
    check("a file predating the format marker has none", old.format, undefined);
    check("nor the org key", old.crmZgid, undefined);
    check("nor any saved dependents", old.depCache, undefined);

    check("and it is still accepted", sandbox.validateScanFile(old), null);

    sandbox.restoreScan(old);
    check("its tables restore in full", S.tables.length, old.tables.length);
    check("that is a substantial scan", S.tables.length > 200, true);
    check("its columns come with them",
      S.tables.reduce((n, t) => n + (t.columns || []).length, 0) > 3000, true);
    check("its Deluge source restores", S.functions.length, old.functions.length);
    check("the missing dependents restore as an empty cache", S.depCache, {});
    check("and the scan date survives", S.scannedAt, old.at);

    //==========// re-saving an old file brings it up to the current format rather
    //==========// than writing the old shape back out
    const resavedOld = sandbox.scanPayload();
    check("re-saving it stamps the current format", resavedOld.format, "zenaudit-scan-1");
    check("and the upgraded file validates", sandbox.validateScanFile(resavedOld), null);
  }


  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL SCAN FILE CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
