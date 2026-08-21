"use strict";
//==========// Exercises invokeConn's handling of the shapes a Connection invoke
//==========// can return, including the 204 No Content an empty list produces.
//==========// Run with: npm test

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app", "js");

let nextResponse = null;
const sandbox = {
  console, Promise, JSON, String, Date, Math, RegExp, Array, Object, Number,
  encodeURIComponent,
  S: { orgId: null },
  document: { getElementById: () => ({ value: "crm" }) },
  ZOHO: { CRM: { CONNECTION: { invoke: () => Promise.resolve(nextResponse) } } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(APP, "helpers.js"), "utf8"), sandbox, { filename: "helpers.js" });

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name +
    (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

function invoke(resp) {
  nextResponse = resp;
  return sandbox.invokeConn("crm", "/test").then(
    (body) => ({ ok: true, body }),
    (err) => ({ ok: false, message: err.message }));
}

/* **********************************************************************
 *   Cases
 ********************************************************************** */

//==========// the exact payload a live org returned for an org with no webhooks
const EMPTY_LIST_204 = {
  code: "SUCCESS",
  details: { statusMessage: "", status: "true" },
  message: "Connection invoked successfully",
  status: "success",
};

//==========// a genuine failure must still be reported as one
const REAL_FAILURE = {
  code: "SUCCESS",
  details: { statusMessage: '{"status":"failure","message":"invalid oauth"}' },
  status: "success",
};

const OAUTH_ERROR = {
  code: "INVALID_TOKEN",
  details: { statusMessage: '{"code":"INVALID_TOKEN"}' },
  status: "error",
};

Promise.resolve()
  .then(() => invoke(EMPTY_LIST_204))
  .then((r) => {
    check("204 empty list resolves instead of throwing", r.ok, true);
    check("204 empty list yields an empty object", r.body, {});
    //==========// this is what listAllPages does with it
    check("empty object reads as an empty page", (r.body || {})["webhooks"] || [], []);
    check("empty object stops pagination", !!((r.body || {}).info && r.body.info.more_records), false);
  })
  .then(() => invoke({ code: "SUCCESS", details: { statusMessage: '{"webhooks":[{"id":"1"}]}' }, status: "success" }))
  .then((r) => check("normal JSON body parses", r.body, { webhooks: [{ id: "1" }] }))
  .then(() => invoke(REAL_FAILURE))
  .then((r) => check("a failure body still throws", r.ok, false))
  .then(() => invoke(OAUTH_ERROR))
  .then((r) => check("an oauth error still throws", r.ok, false))
  .then(() => invoke(null))
  .then((r) => check("a missing response still throws", r.ok, false))
  .then(() => invoke({ details: { statusMessage: "" } }))
  .then((r) => check("empty body with no success marker still throws", r.ok, false))
  .then(() => {
    console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL TRANSPORT CHECKS PASSED");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => { console.error("ERROR", e); process.exit(1); });
