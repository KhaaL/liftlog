// Shared setup for the browser suites: the app with a test handle, and a browser.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

/* The one line of index.html the suites depend on. Code inserted in its place
   runs inside the app's closure, which is what lets `window.testAPI` reach the
   internals by name; the served copy is the only one that carries it. */
const SEAM = '/* @test-seam */';
const APP = path.join(__dirname, '..', 'index.html');

/* index.html with `window.testAPI = <api>` in place of the seam. `api` is the
   source of an object literal, e.g. '{ save, get state(){ return state } }'.
   A missing or doubled marker throws here, naming the cause, instead of every
   check later failing on an undefined testAPI. */
function appWithTestAPI(api){
  const html = fs.readFileSync(APP, 'utf8');
  const found = html.split(SEAM).length - 1;
  if (found !== 1)
    throw new Error('index.html must contain the test seam ' + SEAM + ' exactly once; found ' + found +
      '. Restore it on the line before init(); at the end of the script.');
  return html.replace(SEAM, () => 'window.testAPI = ' + api + ';');
}

/* BROWSER_PATH selects an installed Chromium instead of Playwright's own. */
function launchBrowser(){
  return chromium.launch({ headless:true,
    ...(process.env.BROWSER_PATH ? { executablePath:process.env.BROWSER_PATH } : {}) });
}

module.exports = { appWithTestAPI, launchBrowser };
