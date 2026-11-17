'use strict';

const { ipcMain, shell, dialog, clipboard, app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const system = require('./lib/system');
const monitor = require('./lib/monitor');
const cleaner = require('./lib/cleaner');
const startup = require('./lib/startup');
const tweaks = require('./lib/tweaks');
const security = require('./lib/security');
const diagnostics = require('./lib/diagnostics');

/**
 * Chaque appel renvoie { ok: true, data } ou { ok: false, error } : l'interface
 * affiche ainsi des messages d'erreur clairs (et non des traces techniques).
 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), code: err?.code };
    }
  });
}

function selfPids() {
  return [process.pid, ...app.getAppMetrics().map((m) => m.pid)];
}

function register() {
  const admin = () => system.isAdmin();

  handle('app:info', () => system.getAppInfo());

  handle('monitor:static', () => monitor.getStaticInfo());
  handle('monitor:live', () => monitor.getLiveMetrics());
  handle('monitor:processes', () => monitor.getProcesses());
  handle('monitor:kill', (pid, name) => monitor.killProcess(pid, name, { selfPids: selfPids() }));

  handle('cleaner:scan', async () => cleaner.scan({ isAdmin: await admin() }));
  handle('cleaner:clean', async (ids) => cleaner.clean(ids, { isAdmin: await admin() }));

  handle('startup:list', () => startup.list());
  handle('startup:toggle', async (id, enabled) => startup.setEnabled(id, enabled, { isAdmin: await admin() }));

  handle('tweaks:list', () => tweaks.list());
  handle('tweaks:apply', (id) => tweaks.apply(id));
  handle('tweaks:revert', (id) => tweaks.revert(id));
  handle('tweaks:restorePoint', () => tweaks.createRestorePoint());

  handle('security:status', () => security.getStatus());
  handle('security:update', () => security.updateSignatures());
  handle('security:scan', (opts) =>
    security.startScan(opts || {}, (state) => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('security:scan-finished', state);
    }),
  );
  handle('security:scanState', () => security.getScanState());
  handle('security:threats', () => security.getThreats());
  handle('security:removeThreats', () => security.removeThreats());
  handle('security:audit', () => security.runAudit());

  handle('diagnostics:run', async () => diagnostics.run({ isAdmin: await admin() }));

  // ---- Utilitaires ----
  handle('shell:showItem', (p) => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p)) throw new Error('Fichier introuvable.');
    shell.showItemInFolder(p);
    return true;
  });
  handle('dialog:choosePath', async (kind) => {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win, {
      title: 'Choisir ce qu\'il faut analyser',
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  handle('clipboard:write', (text) => {
    clipboard.writeText(String(text).slice(0, 10_000));
    return true;
  });
}

module.exports = { register };
