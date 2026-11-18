'use strict';

const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const ipc = require('./ipc');
const backend = require('./backend-client');
const log = require('./log');
const config = require('./config');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0d1117',
    title: 'OptiPC',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d1117', symbolColor: '#c9d1d9', height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const win = mainWindow;
  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
  };
  win.once('ready-to-show', show);
  // Filet de sécurité : la fenêtre s'affiche même si le premier rendu tarde.
  setTimeout(show, 4000);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch((err) => {
    log.write(`Chargement de l'interface impossible : ${err.message}`);
  });

  // L'interface ne peut ni naviguer ailleurs ni ouvrir de fenêtres : les liens https s'ouvrent dans le navigateur.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Journalisation des incidents pour pouvoir les diagnostiquer.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log.write(`Échec de chargement ${code} ${desc} ${url}`));
  win.webContents.on('render-process-gone', (_e, details) => {
    log.write(`Processus d'affichage arrêté : ${details.reason} (code ${details.exitCode})`);
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) win.reload();
  });
  win.on('unresponsive', () => log.write('La fenêtre ne répond plus.'));
  win.on('responsive', () => log.write('La fenêtre répond de nouveau.'));
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error') log.write(`[interface] ${details.message}`);
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

// Une seule instance de l'optimiseur à la fois.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  start();
}

function start() {
  process.on('uncaughtException', (err) => {
    log.write(`Erreur non gérée : ${err?.stack || err}`);
    dialog.showErrorBox('OptiPC', `Une erreur inattendue s'est produite :\n${err?.message || err}\n\nJournal : ${log.file || 'indisponible'}`);
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const userDataDir = app.getPath('userData');
    log.init(userDataDir);
    log.write(`Démarrage d'OptiPC ${app.getVersion()} (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`);
    config.load(userDataDir);
    backend.start({ userDataDir });
    ipc.register();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => backend.stop());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
