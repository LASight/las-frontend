/** Read-only, frozen-response visual capture. No browser library or dependency.
 * Node 22+, local Chrome, UI on 5177. API GETs are cached in memory; all writes
 * are blocked except one explicit local-account authentication. No JWT, auth
 * response, storage dump, trace or browser profile is saved in the repository.
 * Required env: QA_EMAIL, QA_PASSWORD. Optional: QA_COLLECTION_ID, QA_API.
 * Run from frontend: node scripts/geoscience-preview.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const api = process.env.QA_API ?? 'http://127.0.0.1:8003';
const ui = 'http://127.0.0.1:5177';
const credentials = { email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD };
if (!credentials.email || !credentials.password) throw new Error('QA_EMAIL and QA_PASSWORD are required; credentials are not written to disk.');
const ready = await fetch(`${ui}/login`);
if (!ready.ok) throw new Error(`UI returned HTTP ${ready.status}. Start the new compiled preview described in docs/75-geoscience-ui.md.`);
const login = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) });
if (!login.ok) throw new Error(`Local QA authentication failed: HTTP ${login.status}`);
const auth = await login.json();
const headers = { Authorization: `Bearer ${auth.tokens.access_token}` };
const getJson = async (path) => {
  const response = await fetch(`${api}${path}`, { headers });
  if (!response.ok) throw new Error(`Read failed: ${path} HTTP ${response.status}`);
  return response.json();
};
let collectionId = process.env.QA_COLLECTION_ID;
if (!collectionId) {
  const history = await getJson('/api/history?kind=raster&limit=100');
  for (const item of history.items) {
    if (!/shutts/i.test(item.label)) continue;
    const job = await getJson(`/api/digitization/jobs/${encodeURIComponent(item.item_id)}`);
    if (job.collection_id) {
      const candidate = await getJson(`/api/digitization/collections/${encodeURIComponent(job.collection_id)}`);
      if (candidate.segments.length >= 2 && candidate.segments.every(({ job }) => job.quality)) { collectionId = candidate.collection_id; break; }
    }
  }
}
if (!collectionId) throw new Error('No processed multi-segment Shutts curve found. Supply QA_COLLECTION_ID; no data will be created.');
const collection = await getJson(`/api/digitization/collections/${encodeURIComponent(collectionId)}`);
const profile = await mkdtemp('/private/var/folders/8d/gbzdh3717kxcbbbb00mlqqzr0000gn/T/opencode/geoscience-preview-chrome-');
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-sync', '--disable-breakpad', '--disable-crash-reporter', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
try {
  let activePort;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { activePort = await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); break; } catch { await pause(100); }
  }
  if (!activePort) throw new Error('Isolated Chrome debugging endpoint did not start.');
  const port = activePort.split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const cache = new Map();
  const browserErrors = [];
  let blockedWrites = 0;
  ws.onmessage = async ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(new Error(message.error.message)); else item?.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(message.params.entry.text);
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        await send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(auth)).toString('base64') }); return;
      }
      if (request.method !== 'GET') {
        blockedWrites++;
        await send('Fetch.fulfillRequest', { requestId, responseCode: 403, body: Buffer.from(JSON.stringify({ detail: 'Read-only visual preview: data writes are blocked.' })).toString('base64') }); return;
      }
      const key = url.pathname + url.search;
      if (!cache.has(key)) cache.set(key, (async () => {
        const response = await fetch(`${api}${key}`, { headers });
        return { responseCode: response.status, responseHeaders: [{ name: 'Content-Type', value: response.headers.get('Content-Type') ?? 'application/octet-stream' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(await response.arrayBuffer()).toString('base64') };
      })());
      await send('Fetch.fulfillRequest', { requestId, ...await cache.get(key) });
    } catch { await send('Fetch.failRequest', { requestId, errorReason: 'Failed' }); }
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Fetch.enable', { patterns: [{ urlPattern: `${ui}/api/*` }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    // All storage in this capture is volatile, including refresh tokens.
    const storage = new Map();
    Storage.prototype.setItem = function(k,v) { storage.set(k,String(v)); };
    Storage.prototype.getItem = function(k) { return storage.get(k) ?? null; };
    Storage.prototype.removeItem = function(k) { storage.delete(k); };
    Storage.prototype.clear = function() { storage.clear(); };
  ` });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('Browser expression failed. No auth details are logged.');
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(expression)) return; await pause(100); }
    const pageState = await evaluate(`({title:document.title,location:location.pathname,text:document.body.innerText.slice(0,400)})`);
    throw new Error(`Preview wait timed out: ${expression}. Page: ${JSON.stringify(pageState)}. Browser: ${browserErrors.slice(0, 4).join('; ')}`);
  };
  await send('Page.navigate', { url: `${ui}/login` });
  await wait(`!!document.querySelector('input[type="email"]')`);
  await evaluate(`(() => { const fields = ${JSON.stringify(credentials)}; for (const type of ['email','password']) { const input = document.querySelector('input[type="'+type+'"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,fields[type]); input.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
  await pause(200); await evaluate(`document.querySelector('button[type="submit"]').click()`);
  await wait(`!!document.querySelector('nav[aria-label="Workspaces"]')`);
  const output = resolve('../docs/geoscience-preview'); await mkdir(output, { recursive: true });
  const captures = [];
  const capture = async (file) => {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(join(output, file), Buffer.from(screenshot.data, 'base64')); captures.push(file);
  };
  for (const [index, segment] of collection.segments.entries()) {
    for (const view of index === 0 ? ['crop', 'cal', 'review', 'result'] : ['crop', 'review']) {
      const route = `/digitize/curves/${encodeURIComponent(collectionId)}?segment=${encodeURIComponent(segment.job_id)}&view=${view}`;
      await evaluate(`history.pushState({},'',${JSON.stringify(route)}); window.dispatchEvent(new PopStateEvent('popstate'));`);
      await wait(`!!document.querySelector('#select-segment-${segment.job_id}[aria-current="true"]')`);
      await pause(2500);
      // Visible preview notice is not part of the product or source raster.
      await evaluate(`(() => { let note=document.querySelector('#preview-notice'); if(!note){note=document.createElement('div');note.id='preview-notice';document.body.append(note);} note.textContent='Read-only visual review · frozen existing Shutts responses · not scientific validation';note.style.cssText='position:fixed;bottom:0;left:58px;right:0;background:#32383e;color:#c0c9d1;padding:6px 14px;font:11px sans-serif;z-index:999;'; })()`);
      await capture(`segment-${index + 1}-${view}.png`);
    }
  }
  await evaluate(`document.querySelector('[aria-label="Collapse inspector"]').click()`); await pause(700);
  await capture('review-inspector-collapsed.png');
  await evaluate(`document.querySelector('[aria-label="Expand inspector"]').click()`);
  await evaluate(`document.querySelector('#curve-view-cal').click()`); await pause(500);
  await evaluate(`document.querySelector('[aria-label="Show curve mnemonic options"]').click()`);
  await wait(`!!document.querySelector('#cal-mnemonic-options')`); await pause(300);
  await capture('metadata-options.png');
  await evaluate(`document.querySelector('#cal-mnemonic').blur(); document.querySelector('#curve-view-review').click()`); await pause(500);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
  // Remount the canvas at the new device scale, without changing source data.
  await evaluate(`document.querySelector('#curve-view-crop').click()`); await pause(300);
  await evaluate(`document.querySelector('#curve-view-review').click()`); await pause(1200);
  await capture('review-dpr-2.png');
  const canvasDpr = await evaluate(`(() => {const canvas=document.querySelector('canvas');return {devicePixelRatio:window.devicePixelRatio,backingWidth:canvas.width,cssWidth:canvas.getBoundingClientRect().width};})()`);
  const report = { mode: 'Read-only frozen existing API responses; not scientific validation', capturedAt: new Date().toISOString(), collectionId, segments: collection.segments.map(({ label, job_id, job }) => ({ label, job_id, crop: job.crop, calibration: job.calibration, corrections: job.edits?.length ?? 0 })), files: captures, blockedWrites, browserErrorCount: browserErrors.length, canvasDpr };
  await writeFile(join(output, 'capture-summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Captured ${captures.length} read-only images in docs/geoscience-preview; data writes attempted/blocked: ${blockedWrites}. No tokens persisted.`);
} finally { ws?.close(); chrome.kill(); }
