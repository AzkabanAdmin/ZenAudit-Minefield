"use strict";

// Persisted settings (connection names, data center, theme), theme toggle,
// and small setup-card UI toggles.

var SETTINGS_KEY = "fieldcheck.settings.v1";
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      conn: $("conn-analytics").value, crmConn: $("conn-crm").value, booksConn: $("conn-books").value,
      includeBooks: $("include-books").checked, dc: $("dc").value, theme: THEME
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
    if (s.booksConn) $("conn-books").value = s.booksConn;
    if (s.includeBooks) {
      $("include-books").checked = true;
      $("include-books").closest(".src-tile").classList.add("on");
    }
    if (s.dc) $("dc").value = s.dc;
    applyTheme(THEME_META.hasOwnProperty(s.theme) ? s.theme : "dark");
  } catch (e) { /* ignore bad cache */ }
}
// Changing the Analytics connection or data center re-resolves orgs and
// workspaces automatically (loadOrgs is defined in scan.js, loaded later).
$("conn-analytics").onchange = function () { saveSettings(); if (S.sdkReady) loadOrgs(); };
$("conn-crm").onchange = saveSettings;
$("conn-books").onchange = function () {
  saveSettings();
  S.booksOrgId = null;
  if (S.sdkReady && $("include-books").checked) loadBooksOrgs();
};
$("dc").onchange = function () { saveSettings(); if (S.sdkReady) loadOrgs(); };

// Three themes (dark, light, zen) picked from a dropdown menu rather than
// cycled through. applyTheme() just sets classes/icons for a given theme;
// setTheme() is what the menu calls, and wraps that in a circular reveal
// that grows from wherever the user clicked.
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
    opt.classList.toggle("active", opt.dataset.theme === t);
  });
}
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
// Switching themes grows a circle from the clicked option (or the toggle
// button itself, e.g. if picked via keyboard) out to cover the page. Falls
// back to an instant switch on browsers without the View Transitions API,
// or when the user has asked for reduced motion.
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
$("btn-toggle-setup").onclick = function () {
  var card = $("setup-card");
  card.classList.toggle("collapsed");
  this.textContent = card.classList.contains("collapsed") ? "Settings" : "Hide settings";
};
// Only ever expands (unlike the Settings link above, which toggles both
// ways); its own visibility is CSS-driven off setup-card's collapsed state,
// so it only shows up while looking at results.
$("btn-back-to-menu").onclick = function () {
  $("setup-card").classList.remove("collapsed");
  $("btn-toggle-setup").textContent = "Hide settings";
};
$("btn-guide").onclick = function () { $("guide").classList.toggle("hidden"); };
// Click any scope chip to copy it for the connection form
document.addEventListener("click", function (e) {
  var el = e.target;
  if (el.tagName !== "CODE" || !(el.closest(".scopes") || el.closest(".guide"))) return;
  var text = el.textContent;
  if (text === "copied!") return;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function () {
      el.textContent = "copied!";
      setTimeout(function () { el.textContent = text; }, 900);
    });
  }
});
