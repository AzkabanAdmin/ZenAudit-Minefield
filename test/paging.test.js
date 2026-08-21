"use strict";
//==========// Exercises listAllPages in isolation with a stubbed crmGet.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app", "js");
const src = fs.readFileSync(path.join(APP, "scan.js"), "utf8");

//==========// pull just the paginator out; the rest of scan.js needs a live DOM
const start = src.indexOf("function listAllPages");
const end = src.indexOf("/* ****", start);
const snippet = src.slice(start, end);

const calls = [];
const sandbox = {
  console,
  Promise,
  crmGet(p) {
    calls.push(p);
    //==========// three pages of two rows, then stop
    const page = Number(/page=(\d+)/.exec(p)[1]);
    if (page > 3) throw new Error("asked for a page past the end");
    return Promise.resolve({
      rows: [{ id: page + "a" }, { id: page + "b" }],
      info: { more_records: page < 3 },
    });
  },
};
vm.createContext(sandbox);
vm.runInContext(snippet, sandbox);

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

sandbox.listAllPages("/settings/functions", "rows").then((all) => {
  check("collects every page", all.map((r) => r.id), ["1a", "1b", "2a", "2b", "3a", "3b"]);
  check("stops at more_records false", calls.length, 3);
  check("builds ? separator", calls[0], "/settings/functions?page=1&per_page=200");

  //==========// a path that already has a query string must use & instead
  calls.length = 0;
  return sandbox.listAllPages("/settings/x?source=crm", "rows");
}).then(() => {
  check("builds & separator", calls[0], "/settings/x?source=crm&page=1&per_page=200");

  //==========// a missing key must yield an empty list, not throw
  calls.length = 0;
  return sandbox.listAllPages("/settings/y", "absent");
}).then((all) => {
  check("missing key yields empty", all, []);
  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL PAGING CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}).catch((e) => { console.error("ERROR", e); process.exit(1); });
