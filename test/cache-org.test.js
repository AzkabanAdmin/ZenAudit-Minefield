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

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL CACHE ORG CHECKS PASSED");
process.exit(failures ? 1 : 0);
