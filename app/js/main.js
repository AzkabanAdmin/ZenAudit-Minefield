"use strict";

// Boot wiring. Loaded last; everything it calls is defined in earlier files.

ZOHO.embeddedApp.on("PageLoad", function () {
  $("sdk-tag").textContent = "SDK ready";
  S.sdkReady = true;
  restoreSettings();
  updateScanButton();
  loadModules();
  showLoader(bootLine);
  loadOrgs().then(endBoot, endBoot); // errors surface in the setup card
  if ($("include-books").checked) loadBooksOrgs();
  // org zgid powers the deep link to the Functions settings page
  ZOHO.CRM.CONFIG.getOrgInfo().then(function (resp) {
    try { S.crmZgid = resp.org[0].zgid || null; } catch (e) { /* generic link fallback */ }
  }).catch(function () { /* generic link fallback */ });
  var raw = localStorage.getItem(SCAN_KEY);
  if (raw) {
    var c = JSON.parse(raw);
    var b = $("btn-cache");
    b.classList.remove("hidden");
    b.textContent = "Use cached scan · " + c.at;
  }
});
// The mini loader reuses the same otter artwork
$("mini-otter").appendChild(document.querySelector(".otter-wrap svg").cloneNode(true));
$("loader-status").textContent = bootLine;
ZOHO.embeddedApp.init();
// Failsafe: if the SDK never fires PageLoad (e.g. opened outside CRM),
// don't leave the boot loader up forever. Scans manage their own hide.
setTimeout(function () { if (bootPhase) endBoot(); }, 12000);
