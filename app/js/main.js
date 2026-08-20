"use strict";

/* **********************************************************************
 *   Boot
 ********************************************************************** */

//==========// loaded last, so everything it calls is already defined
ZOHO.embeddedApp.on("PageLoad", function () {
  $("sdk-tag").textContent = "SDK ready";
  S.sdkReady = true;
  restoreSettings();
  updateScanButton();
  loadModules();
  showLoader(bootLine);
  loadOrgs().then(endBoot, endBoot); //==========// errors surface in the setup card
  //==========// the org zgid powers every deep link back into CRM settings
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
//==========// the mini loader reuses the same otter artwork
$("mini-otter").appendChild(document.querySelector(".otter-wrap svg").cloneNode(true));
$("loader-status").textContent = bootLine;
ZOHO.embeddedApp.init();
//==========// failsafe: if PageLoad never fires (opened outside CRM), don't leave
//==========// the boot loader up forever. Scans manage their own hide.
setTimeout(function () { if (bootPhase) endBoot(); }, 12000);
