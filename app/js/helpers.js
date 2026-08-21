"use strict";

/* **********************************************************************
 *   DOM_And_Text_Utilities
 ********************************************************************** */

function $(id) { return document.getElementById(id); }
function apiBase() { return $("dc").value; }
function webBase() { return apiBase().replace("analyticsapi.", "analytics."); }
function crmApiBase() { return apiBase().replace("https://analyticsapi.zoho", "https://www.zohoapis"); }
function crmWebBase() { return apiBase().replace("analyticsapi.zoho", "crm.zoho"); }
/* **********************************************************************
 *   Deep_Links
 ********************************************************************** */

/*
 *   Confirmed against a live org. Without a resolved zgid, each of these
 *   falls back to the generic list page rather than guessing whether an
 *   org-less path still accepts a record id.
 */

//==========// the workspace-scoped URL opens the editable view, unlike /open-view/
function viewLink(wsId, viewId) { return webBase() + "/workspace/" + wsId + "/view/" + viewId; }
function functionsPageUrl() {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/functions/myFunctions"
    : crmWebBase() + "/crm/settings/functions";
}
function reportPageUrl(reportId) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/tab/Reports/" + reportId
    : crmWebBase() + "/crm/tab/Reports";
}
function workflowRulePageUrl(ruleId) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/workflow-rules/" + ruleId
    : crmWebBase() + "/crm/settings/workflow-rules";
}
function fieldUpdatePageUrl(fieldUpdateId) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/field-updates/" + fieldUpdateId
    : crmWebBase() + "/crm/settings/field-updates";
}
function scoringRulePageUrl(ruleId) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/scoring-rules/" + ruleId
    : crmWebBase() + "/crm/settings/scoring-rules";
}
function blueprintPageUrl(blueprintId, moduleApiName) {
  return S.crmZgid
    ? crmWebBase() + "/crm/org" + S.crmZgid + "/settings/blueprint/" + blueprintId + "?module=" + moduleApiName
    : crmWebBase() + "/crm/settings/blueprint";
}
/* **********************************************************************
 *   Text_Helpers
 ********************************************************************** */

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
//==========// "Account Name", "Account_Name" and "account_name" all normalize alike
function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
function showError(msg) { var e = $("setup-error"); e.classList.remove("hidden"); e.textContent = msg; }
function clearError() { $("setup-error").classList.add("hidden"); }

/* **********************************************************************
 *   API_Transport
 ********************************************************************** */

/*
 *   Every external call goes through a named CRM Connection, so OAuth and
 *   CORS are handled server-side by CRM. That is what keeps the widget
 *   portable: an org configures two Connections once and nothing else.
 */

//==========// The Connection wrapper reports its own outcome separately from the
//==========// wrapped API's body, so an empty body can still be a successful call.
function invokeSucceeded(resp) {
  if (!resp) return false;
  if (resp.code && String(resp.code).toUpperCase() !== "SUCCESS") return false;
  if (resp.status && String(resp.status).toLowerCase() !== "success") return false;
  return !!(resp.code || resp.status);
}

//==========// Zoho signals a rejected call inside the body too, either as an
//==========// explicit failure status or as an error code paired with a message.
function isErrorBody(body) {
  if (!body || typeof body !== "object") return false;
  if (body.status === "failure") return true;
  return typeof body.code === "string" && body.code.toUpperCase() !== "SUCCESS";
}

function invokeConn(connName, url, headers) {
  var req = { url: url, method: "GET", param_type: 1, parameters: {}, headers: headers || {} };
  return ZOHO.CRM.CONNECTION.invoke(connName, req).then(function (resp) {
    var body = resp && resp.details && resp.details.statusMessage;
    //==========// A list with no rows comes back as 204 No Content, which arrives
    //==========// here as an empty statusMessage. That is a real empty result, not
    //==========// a failure, so it must not be reported as one.
    if ((body === "" || body == null) && invokeSucceeded(resp)) return {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { /* raw text, e.g. function code */ } }
    if (!body || isErrorBody(body)) {
      throw new Error("API error at " + url + "\n" + JSON.stringify(body || resp).slice(0, 500));
    }
    return body;
  });
}
/* **********************************************************************
 *   Rate_Limits
 *
 *   Zoho meters both services, and Analytics metadata is the tight one at
 *   60 calls a minute, rejecting the rest with error 6045. Reading
 *   structure costs one call per table, which is hundreds in a real org.
 *
 *   Every call is spaced to stay under the cap rather than discovering it
 *   the hard way. Before this, a large org silently lost most of its
 *   tables: the first minute of calls landed and every later one was
 *   refused, so a "safe to delete" verdict rested on a fraction of the
 *   data with nothing on screen to say so.
 *
 *   LIMITS holds the floor between calls per service. Analytics sits just
 *   over a second to keep clear of 60 a minute. CRM's floor is well below
 *   its own ceiling and below normal round-trip time, so it costs nothing
 *   and guards against a faster connection outrunning the limit.
 ********************************************************************** */

var LIMITS = {
  analytics: { minIntervalMs: 1100, nextAt: 0, retryWaitMs: 45000, hits: 0 },
  crm: { minIntervalMs: 120, nextAt: 0, retryWaitMs: 20000, hits: 0 }
};

function wait(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

//==========// reserve this call's slot up front, so queued callers keep their order
function reserveSlot(limit) {
  var now = Date.now();
  var delay = Math.max(0, limit.nextAt - now);
  limit.nextAt = Math.max(now, limit.nextAt) + limit.minIntervalMs;
  return delay ? wait(delay) : Promise.resolve();
}

function isRateLimited(err) {
  var s = String((err && err.message) || err);
  return s.indexOf("6045") >= 0 || /rate limit|too many request/i.test(s);
}

//==========// spacing should prevent a rejection, so one retry is enough; if it
//==========// still fails the caller hears about it rather than losing the row
function limitedGet(limit, connName, url, headers) {
  return reserveSlot(limit)
    .then(function () { return invokeConn(connName, url, headers); })
    .catch(function (err) {
      if (!isRateLimited(err)) throw err;
      limit.hits++;
      return wait(limit.retryWaitMs)
        .then(function () { return reserveSlot(limit); })
        .then(function () { return invokeConn(connName, url, headers); });
    });
}

//==========// how long a run of metered calls will take, in whole minutes
function estimateMinutes(callCount, limit) {
  return Math.ceil((callCount * limit.minIntervalMs) / 60000);
}

function analyticsGet(path, config) {
  var url = apiBase() + "/restapi/v2" + path;
  if (config) url += (path.indexOf("?") < 0 ? "?" : "&") + "CONFIG=" + encodeURIComponent(JSON.stringify(config));
  return limitedGet(LIMITS.analytics, $("conn-analytics").value.trim(), url,
    S.orgId ? { "ZANALYTICS-ORGID": S.orgId } : {});
}

function crmGet(path) {
  return limitedGet(LIMITS.crm, $("conn-crm").value.trim(), crmApiBase() + "/crm/v8" + path, {});
}
//==========// run fn over items one at a time, to stay inside API rate limits
function runQueue(items, fn, onStep) {
  return items.reduce(function (p, item, i) {
    return p.then(function () {
      if (onStep) onStep(i + 1, items.length, item);
      return fn(item);
    });
  }, Promise.resolve());
}
