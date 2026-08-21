"use strict";

/* **********************************************************************
 *   Persisted_Settings
 ********************************************************************** */

/*
 *   Connection names, data center and theme persist. Scan-source toggles
 *   deliberately do not: which sources you want is a per-audit decision,
 *   not a preference, so every source starts from the checkbox defaults in
 *   widget.html on each load.
 */

var SETTINGS_KEY = "fieldcheck.settings.v1";
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      conn: $("conn-analytics").value, crmConn: $("conn-crm").value,
      dc: $("dc").value, theme: THEME
    }));
  } catch (e) { /* best-effort */ }
}
function restoreSettings() {
  var raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;
  try {
    var s = JSON.parse(raw);
    if (s.conn) $("conn-analytics").value = s.conn;
    if (s.crmConn) $("conn-crm").value = s.crmConn;
    if (s.dc) $("dc").value = s.dc;
    applyTheme(THEME_META.hasOwnProperty(s.theme) ? s.theme : "dark");
  } catch (e) { /* ignore bad cache */ }
}
//==========// changing the connection or data center re-resolves orgs and workspaces
$("conn-analytics").onchange = function () { saveSettings(); if (S.sdkReady) loadOrgs(); };
$("conn-crm").onchange = saveSettings;
$("dc").onchange = function () { saveSettings(); if (S.sdkReady) loadOrgs(); };

/* **********************************************************************
 *   Themes
 ********************************************************************** */

/*
 *   Three themes picked from a dropdown rather than cycled through.
 *   applyTheme sets the classes and icons; setTheme is what the menu
 *   calls, wrapping that in a circular reveal from the click point.
 */

var THEME = "dark";
var THEME_META = {
  dark: { icon: "&#127769;", label: "Dark" },        // moon
  light: { icon: "&#9728;&#65039;", label: "Light" }, // sun
  zen: { icon: "&#127807;", label: "Zen" }            // herb sprig
};
function applyTheme(t) {
  THEME = t;
  document.body.classList.toggle("dark", t === "dark");
  document.body.classList.toggle("zen", t === "zen");
  $("theme-toggle-icon").innerHTML = THEME_META[t].icon;
  $("theme-toggle").title = "Theme: " + THEME_META[t].label;
  document.querySelectorAll(".theme-option").forEach(function (opt) {
    var on = opt.dataset.theme === t;
    opt.classList.toggle("active", on);
    opt.setAttribute("aria-checked", on ? "true" : "false");
  });
}
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
//==========// Grows a circle from the clicked option out to cover the page. Falls
//==========// back to an instant switch without the View Transitions API, or when
//==========// the user has asked for reduced motion.
function setTheme(t, originEl) {
  var rect = (originEl || $("theme-toggle")).getBoundingClientRect();
  closeThemeMenu();
  if (t === THEME) return;
  var apply = function () { applyTheme(t); saveSettings(); };
  if (!document.startViewTransition || prefersReducedMotion()) { apply(); return; }
  var x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  var endRadius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  var transition = document.startViewTransition(apply);
  transition.ready.then(function () {
    document.documentElement.animate(
      { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + endRadius + "px at " + x + "px " + y + "px)"] },
      { duration: 550, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" }
    );
  }).catch(function () { /* transition skipped/aborted; apply() already ran regardless */ });
}
function openThemeMenu() {
  $("theme-menu").classList.remove("hidden");
  $("theme-toggle").setAttribute("aria-expanded", "true");
}
function closeThemeMenu() {
  $("theme-menu").classList.add("hidden");
  $("theme-toggle").setAttribute("aria-expanded", "false");
}
$("theme-toggle").onclick = function (e) {
  e.stopPropagation();
  if ($("theme-menu").classList.contains("hidden")) openThemeMenu(); else closeThemeMenu();
};
document.querySelectorAll(".theme-option").forEach(function (opt) {
  opt.onclick = function () { setTheme(opt.dataset.theme, opt); };
});
document.addEventListener("click", function (e) {
  if (!$("theme-menu").classList.contains("hidden") && !e.target.closest(".theme-picker")) closeThemeMenu();
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") closeThemeMenu();
});
/* **********************************************************************
 *   Setup_Card
 ********************************************************************** */

$("btn-toggle-setup").onclick = function () {
  var card = $("setup-card");
  card.classList.toggle("collapsed");
  this.textContent = card.classList.contains("collapsed") ? "Settings" : "Hide settings";
};
//==========// Only ever expands, unlike the Settings link above. Its own visibility
//==========// is CSS-driven off the collapsed state, so it shows only over results.
$("btn-back-to-menu").onclick = function () {
  $("setup-card").classList.remove("collapsed");
  $("btn-toggle-setup").textContent = "Hide settings";
};
$("btn-guide").onclick = function () { $("guide").classList.toggle("hidden"); };
/* **********************************************************************
 *   Copying_A_Scope
 *
 *   The widget runs in a cross-origin iframe, and the Clipboard API needs
 *   a clipboard-write permission the host frame does not grant, so
 *   writeText rejects. The old handler only acted on success, which meant
 *   clicking a scope silently did nothing.
 *
 *   So there are three attempts, and the last one always works: the modern
 *   API, then the old execCommand which iframes still allow, then simply
 *   selecting the text so it can be copied by hand. Feedback is shown
 *   either way rather than only when the first attempt succeeds.
 ********************************************************************** */

//==========// the deprecated route, which is the one that works inside an iframe
function copyViaTextarea(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "readonly");
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

//==========// last resort: leave it selected so Ctrl+C finishes the job
function selectElementText(el) {
  try {
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch (e) { return false; }
}

function flashChip(el, message) {
  var original = el.getAttribute("data-scope") || el.textContent;
  el.setAttribute("data-scope", original);
  el.textContent = message;
  setTimeout(function () {
    el.textContent = el.getAttribute("data-scope") || original;
    el.removeAttribute("data-scope");
  }, 1100);
}

document.addEventListener("click", function (e) {
  var el = e.target;
  if (el.tagName !== "CODE" || !(el.closest(".scopes") || el.closest(".guide"))) return;
  //==========// mid-flash, so the label is not the scope right now
  if (el.hasAttribute("data-scope")) return;
  var text = el.textContent;

  function fallback() {
    if (copyViaTextarea(text)) { flashChip(el, "copied"); return; }
    if (selectElementText(el)) { flashChip(el, "press Ctrl+C"); return; }
    flashChip(el, "copy by hand");
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      flashChip(el, "copied");
    }, fallback);
    return;
  }
  fallback();
});
