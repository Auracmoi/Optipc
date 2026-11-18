'use strict';

/*
 * Test de la vraie application Electron (processus principal + moteur + interface).
 * Sous Linux sans écran : xvfb-run -a npm run test:e2e
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const NOISE = /dbus|gpu|viz_main|libva|GLib|Fontconfig|ALSA|Gtk|sandbox/i;

async function launch(userDataDir) {
  const app = await electron.launch({
    executablePath: require(path.join(ROOT, 'node_modules', 'electron')),
    args: [ROOT, '--no-sandbox', `--user-data-dir=${userDataDir}`],
  });
  const errors = [];
  app.process().stderr.on('data', (d) => {
    const s = String(d).trim();
    if (s && !NOISE.test(s)) errors.push(`[principal] ${s}`);
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => errors.push(`[page] ${e.message}`));
  win.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
  await win.waitForSelector('.nav-btn.active', { timeout: 20_000 });
  return { app, win, errors };
}

test('lancement réel : interface prête, fenêtre réactive, moteur séparé', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optipc-e2e-'));
  const { app, win, errors } = await launch(dir);
  try {
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => `${m.type}:${m.serviceName || m.name || ''}`));
    assert.ok(metrics.some((m) => /^Utility:.*NodeService/.test(m)), `moteur séparé absent : ${metrics.join(', ')}`);
    // Le processus principal répond vite pendant que le diagnostic tourne.
    let worst = 0;
    for (let i = 0; i < 8; i++) {
      const t0 = Date.now();
      await app.evaluate(() => 1);
      worst = Math.max(worst, Date.now() - t0);
      await win.waitForTimeout(200);
    }
    assert.ok(worst < 500, `processus principal bloqué ${worst} ms`);
    for (const p of ['monitor', 'cleaner', 'startup', 'security', 'tweaks', 'dashboard']) {
      await win.click(`[data-page="${p}"]`);
      await win.waitForTimeout(p === 'monitor' ? 2500 : 600);
    }
    const live = await win.evaluate(() => window.api.monitor.live());
    assert.equal(live.ok, true, 'mesures en direct');
    assert.deepEqual(errors, []);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lecture seule : refus réel côté système et réglage conservé au redémarrage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optipc-e2e-'));
  try {
    let { app, win, errors } = await launch(dir);
    await win.locator('#read-only').click({ force: true });
    await win.waitForSelector('body.read-only');
    const refused = await win.evaluate(() => window.api.monitor.kill(999999, 'x.exe'));
    assert.equal(refused.code, 'READ_ONLY');
    assert.deepEqual(errors, []);
    await app.close();

    ({ app, win, errors } = await launch(dir));
    await win.waitForSelector('body.read-only');
    assert.equal(await win.locator('#read-only').isChecked(), true, 'réglage relu');
    await win.locator('#read-only').click({ force: true });
    await win.waitForFunction(() => !document.body.classList.contains('read-only'));
    const allowed = await win.evaluate(() => window.api.monitor.kill(999999, 'x.exe'));
    assert.notEqual(allowed.code, 'READ_ONLY', 'désactivé : la demande atteint le moteur');
    assert.deepEqual(errors, []);
    await app.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
