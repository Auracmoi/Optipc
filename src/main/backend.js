'use strict';

/*
 * Processus « moteur » (Electron utilityProcess).
 *
 * Toutes les opérations système (mesures, PowerShell, nettoyage…) s'exécutent ici,
 * jamais dans le processus principal. Certaines bibliothèques lancent des commandes
 * Windows bloquantes (execSync) : dans le processus principal, elles gèleraient la
 * fenêtre (fenêtre grise « Ne répond pas »). Ici, elles ne bloquent que le moteur.
 */

const system = require('./lib/system');
const monitor = require('./lib/monitor');
const cleaner = require('./lib/cleaner');
const startup = require('./lib/startup');
const tweaks = require('./lib/tweaks');
const security = require('./lib/security');
const diagnostics = require('./lib/diagnostics');

const port = process.parentPort;
if (!port) {
  throw new Error('backend.js doit être lancé par utilityProcess.fork().');
}

const admin = () => system.isAdmin();
const emit = (event, payload) => port.postMessage({ event, payload });

// Liste fermée des opérations disponibles.
const HANDLERS = {
  'app:info': () => system.getAppInfo(),

  'monitor:static': () => monitor.getStaticInfo(),
  'monitor:live': () => monitor.getLiveMetrics(),
  'monitor:processes': () => monitor.getProcesses(),
  'monitor:kill': (pid, name, selfPids) => monitor.killProcess(pid, name, { selfPids }),

  'cleaner:scan': async () => cleaner.scan({ isAdmin: await admin() }),
  'cleaner:clean': async (ids) => cleaner.clean(ids, { isAdmin: await admin() }),

  'startup:list': () => startup.list(),
  'startup:toggle': async (id, enabled) => startup.setEnabled(id, enabled, { isAdmin: await admin() }),

  'tweaks:list': () => tweaks.list(),
  'tweaks:apply': (id) => tweaks.apply(id),
  'tweaks:revert': (id) => tweaks.revert(id),
  'tweaks:restorePoint': () => tweaks.createRestorePoint(),

  'security:status': () => security.getStatus(),
  'security:update': () => security.updateSignatures(),
  'security:scan': (opts) => security.startScan(opts || {}, (state) => emit('security:scan-finished', state)),
  'security:scanState': () => security.getScanState(),
  'security:threats': () => security.getThreats(),
  'security:removeThreats': () => security.removeThreats(),
  'security:audit': () => security.runAudit(),

  'diagnostics:run': async () => diagnostics.run({ isAdmin: await admin() }),
};

port.on('message', async (msg) => {
  const { id, type } = msg.data || {};

  if (type === 'init') {
    tweaks.init({ userDataDir: msg.data.userDataDir });
    port.postMessage({ id, ok: true, data: true });
    return;
  }

  const fn = HANDLERS[msg.data?.channel];
  if (!fn) {
    port.postMessage({ id, ok: false, error: `Opération inconnue : ${msg.data?.channel}` });
    return;
  }
  try {
    const data = await fn(...(msg.data.args || []));
    port.postMessage({ id, ok: true, data });
  } catch (err) {
    port.postMessage({ id, ok: false, error: err?.message || String(err), code: err?.code });
  }
});

process.on('uncaughtException', (err) => emit('log', `Erreur non gérée dans le moteur : ${err?.stack || err}`));
process.on('unhandledRejection', (err) => emit('log', `Promesse rejetée dans le moteur : ${err?.stack || err}`));

module.exports = { CHANNELS: Object.keys(HANDLERS) };
