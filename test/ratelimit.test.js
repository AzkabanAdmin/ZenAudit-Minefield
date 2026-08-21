"use strict";
//==========// Exercises the shared rate limiter. Zoho Analytics allows 60 metadata
//==========// calls a minute and rejects the rest with 6045, which silently cost a
//==========// large org most of its tables before this existed.
//==========// Run with: npm test

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "app", "js");

/* **********************************************************************
 *   Fake_Clock
 *
 *   A real run of these cases would take minutes of wall clock, so time
 *   is simulated. Microtasks are drained between timer fires, otherwise
 *   the chained promise that makes the call has not run yet and every
 *   call appears to happen at the same instant.
 ********************************************************************** */

let now = 0;
let timers = [];

async function advance(ms) {
  //==========// let anything already queued run at the current time first, or its
  //==========// call records a timestamp from after the clock moved
  for (let k = 0; k < 8; k++) await Promise.resolve();
  const until = now + ms;
  for (;;) {
    timers.sort((a, b) => a.at - b.at);
    const i = timers.findIndex((t) => t.at <= until);
    if (i < 0) break;
    const next = timers.splice(i, 1)[0];
    now = Math.max(now, next.at);
    next.fn();
    for (let k = 0; k < 8; k++) await Promise.resolve();
  }
  now = until;
  for (let k = 0; k < 8; k++) await Promise.resolve();
}

let invocations = [];
const OK = { code: "SUCCESS", status: "success", details: { statusMessage: "{}" } };
let responder = () => Promise.resolve(OK);

const sandbox = {
  console, Promise, JSON, String, Math, RegExp, Array, Object, Number, Boolean, isNaN,
  encodeURIComponent,
  Date: { now: () => now },
  setTimeout: (fn, ms) => { timers.push({ at: now + (ms || 0), fn }); },
  clearTimeout: () => {},
  S: { orgId: null },
  document: { getElementById: () => ({ value: "conn" }) },
  ZOHO: {
    CRM: {
      CONNECTION: {
        invoke: (conn, req) => {
          invocations.push({ at: now, url: req.url });
          return responder(invocations.length);
        },
      },
    },
  },
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

const L = sandbox.LIMITS;

function reset(limit) {
  invocations = [];
  timers = [];
  now = 0;
  limit.nextAt = 0;
  limit.hits = 0;
  responder = () => Promise.resolve(OK);
}

(async function () {
  /* **********************************************************************
   *   Spacing_Stays_Under_The_Cap
   ********************************************************************** */

  check("analytics is spaced at least a second", L.analytics.minIntervalMs >= 1000, true);
  check("which keeps it at or under 60 a minute",
    Math.floor(60000 / L.analytics.minIntervalMs) <= 60, true);
  check("crm is spaced as well", L.crm.minIntervalMs > 0, true);

  //==========// the case that broke a real org: 269 table reads back to back
  reset(L.analytics);
  const many = [];
  for (let i = 0; i < 269; i++) many.push(sandbox.analyticsGet("/views/" + i));
  await advance(600000);
  await Promise.all(many);

  check("every one of the 269 calls is made", invocations.length, 269);

  let tooClose = 0;
  for (let i = 1; i < invocations.length; i++) {
    if (invocations[i].at - invocations[i - 1].at < L.analytics.minIntervalMs) tooClose++;
  }
  check("no call outruns the interval", tooClose, 0);

  const span = invocations[invocations.length - 1].at - invocations[0].at;
  const perMinute = Math.round((invocations.length / span) * 60000);
  console.log("   269 calls spread over " + Math.round(span / 1000) + "s, about " +
    perMinute + " a minute");
  check("the effective rate stays at or under 60 a minute", perMinute <= 60, true);

  /* **********************************************************************
   *   Retry_On_6045
   ********************************************************************** */

  reset(L.analytics);
  //==========// reject the first call the way Zoho does, then succeed
  responder = (n) => (n === 1
    ? Promise.reject(new Error('API error\n{"status":"failure","data":{"errorCode":6045}}'))
    : Promise.resolve(OK));

  const retried = sandbox.analyticsGet("/views/x");
  await advance(120000);
  const body = await retried;

  check("a 6045 rejection is retried rather than lost", invocations.length, 2);
  check("the retry waits for the window to roll over",
    invocations[1].at - invocations[0].at >= L.analytics.retryWaitMs, true);
  check("the rate-limit hit is recorded", L.analytics.hits, 1);
  check("the caller still receives a body", body, {});

  /* **********************************************************************
   *   Other_Failures_Surface
   ********************************************************************** */

  reset(L.analytics);
  responder = () => Promise.reject(new Error('API error\n{"status":"failure","message":"bad scope"}'));
  const hard = sandbox.analyticsGet("/views/y").then(
    () => "resolved",
    (e) => (/bad scope/.test(e.message) ? "passed through" : "message changed"));
  await advance(120000);
  check("a failure that is not a rate limit is not retried away", await hard, "passed through");
  check("and it is only attempted once", invocations.length, 1);

  /* **********************************************************************
   *   Estimates
   ********************************************************************** */

  //==========// estimates use perCallMs, the observed cost, not the throttle floor,
  //==========// so they do not promise a run that finishes faster than it can
  check("estimates are not faster than the throttle allows",
    L.analytics.perCallMs >= L.analytics.minIntervalMs, true);
  check("crm estimates account for round trip, not just the floor",
    L.crm.perCallMs > L.crm.minIntervalMs, true);

  check("269 tables estimates six minutes", sandbox.estimateMinutes(269, L.analytics), 6);
  check("a small org estimates one minute", sandbox.estimateMinutes(20, L.analytics), 1);
  check("420 functions estimates two minutes", sandbox.estimateMinutes(420, L.crm), 2);

  //==========// the phrasing used in the plan and the loader
  check("a short run is described loosely", sandbox.describeDuration(8), "a few seconds");
  check("a medium run is described in seconds", sandbox.describeDuration(45), "45 seconds");
  check("a long run is described in minutes", sandbox.describeDuration(310), "about 5 minutes");

  /* **********************************************************************
   *   The_Otter_Only_Earns_A_Coffee_On_A_Long_Run
   ********************************************************************** */

  //==========// the small test org has 53 tables and must never see the coffee
  check("53 tables is not a long run", sandbox.estimateMinutes(53, L.analytics) >= 3, false);
  check("110 tables is", sandbox.estimateMinutes(110, L.analytics) >= 3, true);
  check("and the small test org stays under the threshold",
    sandbox.estimateMinutes(53, L.analytics), 2);
  check("269 tables certainly is", sandbox.estimateMinutes(269, L.analytics) >= 3, true);

  console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL RATE LIMIT CHECKS PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
