"use strict";

/* **********************************************************************
 *   Loaders
 ********************************************************************** */

/*
 *   A full-screen overlay for boot and scans, plus a backdrop-free mini
 *   loader for in-page work like Check All.
 *
 *   The overlay holds for at least MIN_LOADER_MS so it never just
 *   flickers. The boot loader is already visible in the markup, so the
 *   clock starts at script evaluation rather than the first showLoader().
 */

var MIN_LOADER_MS = 2200, loaderShownAt = Date.now(), loaderHideTimer = null;
function showLoader(status, frac) {
  var el = $("loader");
  if (el.classList.contains("hidden")) loaderShownAt = Date.now();
  if (loaderHideTimer) { clearTimeout(loaderHideTimer); loaderHideTimer = null; }
  el.classList.remove("hidden");
  $("loader-status").textContent = status || "";
  var fill = $("loader-fill");
  if (frac == null) {
    fill.classList.add("indet");
  } else {
    fill.classList.remove("indet");
    fill.style.left = "0";
    fill.style.width = Math.round(frac * 100) + "%";
  }
}
function hideLoader() {
  var wait = Math.max(0, MIN_LOADER_MS - (Date.now() - loaderShownAt));
  if (loaderHideTimer) clearTimeout(loaderHideTimer);
  loaderHideTimer = setTimeout(function () {
    $("loader").classList.add("hidden");
    loaderHideTimer = null;
  }, wait);
}

//==========// boot gets a playful line; real scans keep factual progress text
var BOOT_LINES = [
  "Achieving field zen…",
  "Meditating on your metadata…",
  "Teaching the otter where your fields live…",
  "Aligning columns and chakras…",
  "Deep breaths. Deep scans.",
  "Consulting the field spirits…",
  "Warming up the whiskers…"
];
var bootLine = BOOT_LINES[Math.floor(Math.random() * BOOT_LINES.length)];
var bootPhase = true;
function endBoot() { bootPhase = false; hideLoader(); }

function showMini(status, frac) {
  $("mini-loader").classList.remove("hidden");
  $("mini-status").textContent = status || "";
  if (frac != null) $("mini-fill").style.width = Math.round(frac * 100) + "%";
}
function hideMini() { $("mini-loader").classList.add("hidden"); }
