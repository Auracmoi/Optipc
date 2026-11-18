'use strict';

const { ipcMain, shell, dialog, clipboard, app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const backend = require('./backend-client');

/*
 * Le processus principal ne fait AUCUN travail système lui-même : il relaie les
 * appels de l'interface vers le moteur (processus séparé). La fenêtre reste donc
 * toujours réactive, même quand Windows met du temps à répondre.
 *
 * Chaque appel renvoie { ok: true, data } ou { ok: false, error }.
 */

// Opérations relayées telles quelles vers le moteur (liste fermée).
const FORWARDED = [
  'app:info',
  'monitor:static', 'monitor:live', 'monitor:processes',
  'cleaner:scan', 'cleaner:clean',
  'startup:list', 'startup:toggle',
  'tweaks:list', 'tweaks:apply', 'tweaks:revert', 'tweaks:restorePoint',
  'security:status', 'security:update', 'security:scan', 'security:scanState',
  'security:threats', 'security:removeThreats', 'security:audit',
  'diagnostics:run',
];

function handleLocal(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err?.message || String(err), code: err?.code };
    }
  });
}

/** PID de l'application elle-même (fenêtre, moteur…) : elle ne peut pas se fermer elle-même. */
function selfPids() {
  return [process.pid, ...app.getAppMetrics().map((m) => m.pid)];
}

function register() {
  for (const channel of FORWARDED) {
    ipcMain.handle(channel, (_event, ...args) => backend.call(channel, args));
  }
  // Fermer un processus : on ajoute la liste des PID de l'application, connue seulement ici.
  ipcMain.handle('monitor:kill', (_event, pid, name) => backend.call('monitor:kill', [pid, name, selfPids()]));

  backend.onEvent((event, payload) => {
    if (event !== 'security:scan-finished') return;
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('security:scan-finished', payload);
  });

  // ---- Utilitaires de l'interface (rapides, sans appel système lourd) ----
  handleLocal('shell:showItem', (p) => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !fs.existsSync(p)) throw new Error('Fichier introuvable.');
    shell.showItemInFolder(p);
    return true;
  });
  handleLocal('dialog:choosePath', async (kind) => {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win, {
      title: "Choisir ce qu'il faut analyser",
      properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  handleLocal('clipboard:write', (text) => {
    clipboard.writeText(String(text).slice(0, 10_000));
    return true;
  });
}

module.exports = { register, FORWARDED };
