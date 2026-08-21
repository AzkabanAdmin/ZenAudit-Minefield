"use strict";
//==========// Loads every script in widget.html's real order against a DOM shim,
//==========// then calls the top-level entry points. Proves load order and that no
//==========// file references an identifier another file forgot to define.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app");
const html = fs.readFileSync(path.join(APP, "widget.html"), "utf8");

//==========// take the script order from the markup, not a hardcoded list
const order = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
console.log("script order from widget.html: " + order.join(", ") + "\n");

function makeEl(id) {
  const el = {
    id, value: "", textContent: "", innerHTML: "", disabled: false, checked: false,
    children: [], dataset: {}, style: {}, type: "", className: "", title: "",
    _classes: new Set(),
    classList: {
      add: (c) => el._classes.add(c),
      remove: (c) => el._classes.delete(c),
      toggle: (c, on) => (on === undefined
        ? (el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c))
        : (on ? el._classes.add(c) : el._classes.delete(c))),
      contains: (c) => el._classes.has(c),
    },
    appendChild(c) { el.children.push(c); return c; },
    remove() {}, addEventListener() {}, dispatchEvent() {},
    setAttribute(k, v) { el.dataset[k] = v; },
    getAttribute(k) { return el.dataset[k]; },
    closest() { return null; },
    querySelector() { return makeEl("q"); },
    querySelectorAll() { return []; },
    cloneNode() { return makeEl("clone"); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 10, height: 10 }; },
    scrollIntoView() {}, animate() { return {}; },
    selectedOptions: [{ textContent: "Deals" }],
  };
  return el;
}

const els = {};
const $el = (id) => (els[id] || (els[id] = makeEl(id)));

const pageLoadHandlers = [];
const sandbox = {
  console, Promise, Date, Math, JSON, RegExp, Array, Object, String, Number,
  Boolean, isNaN, encodeURIComponent, Event: function (t) { this.type = t; },
  setTimeout: () => 0, clearTimeout: () => {},
  URL: { createObjectURL: () => "blob:stub" }, Blob: function () {},
  innerWidth: 1200, innerHeight: 800, navigator: {},
  localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } },
  document: {
    body: makeEl("body"), documentElement: makeEl("html"),
    getElementById: $el, createElement: (t) => makeEl("new-" + t),
    querySelector: () => makeEl("q"), querySelectorAll: () => [],
    addEventListener() {},
  },
  matchMedia: () => ({ matches: false }),
  ZOHO: {
    CRM: {
      META: {
        getModules: () => Promise.resolve({ modules: [{ api_name: "Deals", id: "1", plural_label: "Deals", singular_label: "Deal", api_supported: true }] }),
        getFields: () => Promise.resolve({ fields: [{ api_name: "Stage", field_label: "Stage", data_type: "picklist" }] }),
      },
      CONNECTION: { invoke: () => Promise.resolve({ details: { statusMessage: '{"data":{"orgs":[]}}' } }) },
      CONFIG: { getOrgInfo: () => Promise.resolve({ org: [{ zgid: "9" }] }) },
    },
    embeddedApp: {
      on(evt, fn) { if (evt === "PageLoad") pageLoadHandlers.push(fn); },
      init() {},
    },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let failures = 0;
for (const f of order) {
  try {
    vm.runInContext(fs.readFileSync(path.join(APP, "js", f), "utf8"), sandbox, { filename: f });
    console.log("PASS evaluated " + f);
  } catch (e) {
    failures++;
    console.log("FAIL evaluated " + f + "\n   " + e.message);
  }
}

//==========// the SDK callback is where the real boot work happens
console.log("");
if (!pageLoadHandlers.length) {
  failures++;
  console.log("FAIL no PageLoad handler registered");
} else {
  try {
    pageLoadHandlers.forEach((fn) => fn());
    console.log("PASS PageLoad handler ran");
  } catch (e) {
    failures++;
    console.log("FAIL PageLoad handler threw\n   " + e.message);
  }
}

//==========// every function the registries name must actually exist
const missing = [];
for (const src of sandbox.SOURCES) {
  if (typeof sandbox.MATCHERS[src.key] !== "function") missing.push("matcher for " + src.key);
  for (const fn of ["heading", "card", "csv"]) {
    if (typeof src[fn] !== "function") missing.push(src.key + "." + fn);
  }
}
for (const sc of sandbox.SCANS) {
  if (!(sc.store in sandbox.S)) missing.push("S." + sc.store);
  if (!(sc.flag in sandbox.S)) missing.push("S." + sc.flag);
}
for (const fn of sandbox.CRM_SCANS) {
  if (typeof fn !== "function") missing.push("a CRM_SCANS entry is not a function");
}
if (missing.length) {
  failures++;
  console.log("FAIL registry wiring: " + missing.join(", "));
} else {
  console.log("PASS registry wiring complete (" + sandbox.SOURCES.length + " sources, " +
    sandbox.SCANS.length + " scans, " + sandbox.CRM_SCANS.length + " CRM sub-scans)");
}

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL BOOT CHECKS PASSED");
process.exit(failures ? 1 : 0);
