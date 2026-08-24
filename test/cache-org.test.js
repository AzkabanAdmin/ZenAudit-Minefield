"use strict";
//==========// The scan cache lives in localStorage, which Chrome keys to
//==========// crm.zoho.com rather than to the org. Two orgs therefore share one
//==========// bucket, so a cached scan has to prove it belongs to the org on screen
//==========// before it is offered. Restoring the wrong one would produce verdicts
//==========// that look real while describing a different client's data.
//==========// Run with: npm test

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app", "js");

const store = {};
const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, value: "", textContent: "", innerHTML: "", disabled: false,
      _c: new Set(),
      classList: {
        add: (c) => els[id]._c.add(c),
        remove: (c) => els[id]._c.delete(c),
        toggle: (c, on) => (on ? els[id]._c.add(c) : els[id]._c.delete(c)),
        contains: (c) => els[id]._c.has(c),
      },
      appendChild() {}, setAttribute() {}, getAttribute() { return null; },
      querySelectorAll: () => [],
      selectedOptions: [{ textContent: "Deals" }],
    };
  }
  return els[id];
}

const sandbox = {
  console, Promise, JSON, String, Math, RegExp, Array, Object, Number, Boolean, isNaN,
  encodeURIComponent, Date, setTimeout: (f) => f(), clearTimeout: () => {},
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
  document: {
    getElementById: el, createElement: () => el("new"),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, body: el("body"),
  },
  ZOHO: { CRM: { META: {}, CONNECTION: { invoke: () => Promise.resolve({}) }, CONFIG: {} } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ["state.js", "helpers.js", "sources.js", "loader.js", "scan.js"]) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), "utf8"), sandbox, { filename: f });
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name +
    (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

const S = sandbox.S;
const KEY = sandbox.SCAN_KEY;

function writeCacheFor(zgid) {
  store[KEY] = JSON.stringify({ crmZgid: zgid, at: "some time", tables: [], queryTables: [] });
}

/* **********************************************************************
 *   A_Cache_Must_Prove_Its_Org
 ********************************************************************** */

S.crmZgid = "org-A";
writeCacheFor("org-A");
check("a cache from this org is offered", !!sandbox.cachedScanForThisOrg(), true);

writeCacheFor("org-B");
check("a cache from another org is not", sandbox.cachedScanForThisOrg(), null);

//==========// caches written before the org stamp existed cannot be trusted either
store[KEY] = JSON.stringify({ at: "old", tables: [] });
check("a cache with no org stamp is not offered", sandbox.cachedScanForThisOrg(), null);

delete store[KEY];
check("no cache at all is handled", sandbox.cachedScanForThisOrg(), null);

//==========// and before the zgid resolves, nothing is claimed either way
writeCacheFor("org-A");
S.crmZgid = null;
check("without a known org, no cache is offered", sandbox.cachedScanForThisOrg(), null);

/* **********************************************************************
 *   The_Button_Follows_The_Same_Rule
 ********************************************************************** */

S.crmZgid = "org-A";
writeCacheFor("org-A");
sandbox.offerCachedScan();
check("the button is shown for a matching org", el("btn-cache")._c.has("hidden"), false);
check("and labelled with when the scan ran", /some time/.test(el("btn-cache").textContent), true);

writeCacheFor("org-B");
sandbox.offerCachedScan();
check("the button is hidden for a different org", el("btn-cache")._c.has("hidden"), true);

/* **********************************************************************
 *   Folder_Gating
 *
 *   The scan plan narrows a run by unticking folders, so folderAllowed is
 *   what has to honour it. Getting this wrong would drop tables silently,
 *   which is the failure the rate limiter work was all about.
 ********************************************************************** */

S.folders = [
  { wsId: "w1", folderId: 10, folderName: "CRM Modules (Data)", selected: true },
  { wsId: "w1", folderId: 11, folderName: "Zoho Books", selected: false },
  { wsId: "w2", folderId: 20, folderName: "Tables & Reports", selected: true },
];

check("a selected folder is scanned", sandbox.folderAllowed("w1", 10), true);
check("an unticked folder is skipped", sandbox.folderAllowed("w1", 11), false);
check("a folder in another workspace is judged on its own", sandbox.folderAllowed("w2", 20), true);

//==========// an unknown folder is scanned rather than dropped: better to do extra
//==========// work than to lose a table without saying so
check("an unrecognised folder id is still scanned", sandbox.folderAllowed("w1", 999), true);

//==========// and a workspace we have no folder data for is never filtered
check("a workspace with no folder data is unfiltered", sandbox.folderAllowed("w3", 1), true);

/* **********************************************************************
 *   Workspace_Pills_Drive_The_Plan
 *
 *   The pills sit above the plan table and were wired only to the scan
 *   button, so unticking a workspace left its folders listed and still
 *   counted in the total. The panel exists to say what a scan would cover,
 *   which makes overstating it the one thing it must not do.
 ********************************************************************** */

el("include-an").checked = true;
el("include-crm").checked = true;
el("include-reports").checked = false;
el("include-reverse-audit").checked = false;

S.workspaces = [
  { workspaceId: "w1", workspaceName: "Zoho One Workspace", selected: true },
  { workspaceId: "w2", workspaceName: "Zoho Books Analytics", selected: true },
];

//==========// 60 tables in one workspace, 40 in the other, so the split is obvious
S.plan = {
  at: "some time",
  analytics: [
    //==========// folder is the live object the row is re-linked to after a restore,
    //==========// and its presence is what puts a checkbox in the row
    { wsId: "w1", wsName: "Zoho One Workspace", folderId: 10, folderName: "CRM Modules",
      tables: 60, folder: { wsId: "w1", folderId: 10, selected: true } },
    { wsId: "w2", wsName: "Zoho Books Analytics", folderId: 20, folderName: "Books",
      tables: 40, folder: { wsId: "w2", folderId: 20, selected: true } },
  ],
  crm: [],
  reports: null,
};

const bothOn = sandbox.planSeconds();
check("both workspaces are counted to start with",
  bothOn, sandbox.estimateSeconds(100, sandbox.LIMITS.analytics));

sandbox.renderPlan();
const bothHtml = el("plan-body").innerHTML;
check("and both appear in the table", /Zoho Books Analytics/.test(bothHtml), true);

//==========// untick the Books workspace, the way the pill does
S.workspaces[1].selected = false;
sandbox.renderPlan();

check("the total drops to the workspaces still selected",
  sandbox.planSeconds(), sandbox.estimateSeconds(60, sandbox.LIMITS.analytics));
check("and it really did drop", sandbox.planSeconds() < bothOn, true);

const oneHtml = el("plan-body").innerHTML;
check("the deselected workspace's rows leave the table",
  /Zoho Books Analytics/.test(oneHtml), false);
check("the remaining workspace stays", /Zoho One Workspace/.test(oneHtml), true);

//==========// the folder checkbox carries an index into S.plan.analytics, so skipping
//==========// a row must not renumber the ones after it
check("the surviving row still points at its own entry in the plan",
  /data-plan-folder='0'/.test(oneHtml), true);

//==========// with every workspace off there is nothing to read, and saying so beats
//==========// an empty panel that looks like a bug
S.workspaces[0].selected = false;
sandbox.renderPlan();
check("no workspace selected means no Analytics time", sandbox.planSeconds(), 0);
check("and the panel says why rather than going blank",
  /No Analytics workspace is selected/.test(el("plan-body").innerHTML), true);

S.workspaces[0].selected = true;
S.workspaces[1].selected = true;

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL CACHE ORG CHECKS PASSED");
process.exit(failures ? 1 : 0);
