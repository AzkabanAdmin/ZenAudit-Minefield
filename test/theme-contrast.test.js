"use strict";
//==========// Guards a bug that shipped once: body.dark set only a colour on link
//==========// hover, so the generic button:hover painted a filled pill underneath
//==========// and the text became mint on mint. Any hover rule that recolours text
//==========// has to settle its own background, in every theme.
//==========// Run with: npm test

const fs = require("fs");
const path = require("path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "app", "css", "styles.css"), "utf8");

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name +
    (ok ? "" : "\n   got:      " + JSON.stringify(actual) + "\n   expected: " + JSON.stringify(expected)));
}

//==========// crude but sufficient: selector plus declaration block, comments gone
const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [];
for (const m of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = m[1].trim().replace(/\s+/g, " ");
  if (!selector || selector.startsWith("@")) continue;
  rules.push({ selector, body: m[2] });
}

console.log("parsed " + rules.length + " css rules\n");
check("the stylesheet parsed into rules", rules.length > 100, true);

/* **********************************************************************
 *   A_Hover_Rule_Owns_Its_Background
 *
 *   The generic button:hover fills the button. Any more specific hover
 *   rule that only changes colour inherits that fill, which is how the
 *   text vanished.
 ********************************************************************** */

const genericFills = rules.filter((r) =>
  /(^|[\s,])(body\.\w+\s+)?button:hover/.test(r.selector) && /background\s*:/.test(r.body));
check("a generic button hover does fill the button", genericFills.length > 0, true);

//==========// a hover rule aimed at a button variant, since those are the ones the
//==========// generic fill would otherwise reach
const variantHovers = rules.filter((r) =>
  /button\.\w[\w-]*[^,{}]*:hover/.test(r.selector));
check("there are button variant hover rules to check", variantHovers.length >= 3, true);

const missingBackground = variantHovers
  .filter((r) => /color\s*:/.test(r.body) && !/background\s*:/.test(r.body))
  .map((r) => r.selector);
check("every button variant hover settles its own background", missingBackground, []);

/* **********************************************************************
 *   Link_Buttons_Specifically
 *
 *   These are the ones that must never look like a filled pill, and they
 *   exist in all three themes.
 ********************************************************************** */

const linkHovers = rules.filter((r) => /button\.link[^,{}]*:hover/.test(r.selector));
check("every theme has a link hover rule", linkHovers.length >= 3, true);

const linkNotCleared = linkHovers
  .filter((r) => !/background\s*:\s*none/.test(r.body))
  .map((r) => r.selector);
check("each of them clears the background", linkNotCleared, []);

const linkKeepsShadow = linkHovers
  .filter((r) => !/box-shadow\s*:\s*none/.test(r.body))
  .map((r) => r.selector);
check("and drops the shadow, so no pill outline remains", linkKeepsShadow, []);

//==========// the three themes are dark, zen, and the unprefixed light base
const themed = linkHovers.map((r) =>
  (/body\.dark/.test(r.selector) ? "dark" : /body\.zen/.test(r.selector) ? "zen" : "light"));
check("all three themes are covered", themed.sort(), ["dark", "light", "zen"]);

/* **********************************************************************
 *   A_Theme_That_Refills_A_Button_Restates_Its_Text
 *
 *   A hover that only changes the fill is safe as long as the theme's base
 *   button rule defines a text colour to inherit. Checking the fill
 *   against the text would mean computing contrast; checking that the pair
 *   is always defined together is the property that actually prevents the
 *   bug, and it is checkable.
 ********************************************************************** */

function baseButtonRules() {
  return rules.filter((r) => /^(body\.\w+\s+)?button$/.test(r.selector));
}

const bases = baseButtonRules();
check("each theme that restyles buttons has a base rule", bases.length >= 2, true);

const baseMissingPair = bases
  .filter((r) => /background\s*:/.test(r.body) && !/color\s*:/.test(r.body))
  .map((r) => r.selector);
check("a base button rule that sets a fill also sets its text colour", baseMissingPair, []);

//==========// the light base is what every unstyled theme falls back to
const lightBase = bases.filter((r) => r.selector === "button")[0];
check("the light base defines both", 
  !!(lightBase && /background\s*:/.test(lightBase.body) && /color\s*:/.test(lightBase.body)), true);

//==========// and dark, which is the shipped default
const darkBase = bases.filter((r) => r.selector === "body.dark button")[0];
check("dark defines both too",
  !!(darkBase && /background\s*:/.test(darkBase.body) && /color\s*:/.test(darkBase.body)), true);

//==========// a disabled button must stay legible rather than inheriting a fill
const disabled = rules.filter((r) => /button:disabled/.test(r.selector));
check("disabled states are styled", disabled.length >= 2, true);

console.log(failures ? "\n" + failures + " FAILURE(S)" : "\nALL THEME CONTRAST CHECKS PASSED");
process.exit(failures ? 1 : 0);
