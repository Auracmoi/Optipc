'use strict';

const { utilityProcess } = require('electron');
const path = require('node:path');
const log = require('./log');

/*
 * Côté processus principal : démarre le moteur, lui transmet les appels et
 * le relance automatiquement s'il s'arrête de façon inattendue.
 */

const DEFAULT_TIMEOUT = 2 * 60_000;
// Opérations longues (analyses antivirus, nettoyage, point de restauration…).
const LONG_TIMEOUTS = {
  'cleaner:scan': 10 * 60_000,
  'cleaner:clean': 30 * 60_000,
  'security:update': 12 * 60_000,
  'security:removeThreats': 12 * 60_000,
  'security:audit': 6 * 60_000,
  'tweaks:restorePoint': 4 * 60_000,
  'diagnostics:run': 6 * 60_000,
};

let child = null;
let nextId = 1;
let userDataDir = null;
let stopping = false;
let restarts = 0;
const pending = new Map(); // id -> { resolve, timer, channel }
const listeners = new Set();

function failAll(message) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ ok: false, error: message });
    pending.delete(id);
  }
}

function start(options) {
  userDataDir = options.userDataDir;
  child = utilityProcess.fork(path.join(__dirname, 'backend.js'), [], {
    serviceName: 'OptiPC - moteur',
    stdio: 'pipe',
  });
  child.stdout?.on('data', (d) => log.write(`[moteur] ${String(d).trim()}`));
  child.stderr?.on('data', (d) => log.write(`[moteur:erreur] ${String(d).trim()}`));

  child.on('message', (msg) => {
    if (msg && msg.event) {
      if (msg.event === 'log') log.write(msg.payload);
      else for (const l of listeners) l(msg.event, msg.payload);
      return;
    }
    const p = pending.get(msg?.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(msg.id);
    p.resolve({ ok: msg.ok, data: msg.data, error: msg.error, code: msg.code });
  });

  child.on('exit', (code) => {
    log.write(`Le moteur s'est arrêté (code ${code}).`);
    child = null;
    failAll("Le moteur d'analyse s'est arrêté. Réessayez dans quelques secondes.");
    if (!stopping && restarts < 5) {
      restarts += 1;
      setTimeout(() => start({ userDataDir }), 1000);
    }
  });

  send({ type: 'init', userDataDir });
}

function send(data, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve) => {
    if (!child) {
      resolve({ ok: false, error: "Le moteur d'analyse redémarre. Réessayez dans quelques secondes." });
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      log.write(`Délai dépassé pour ${data.channel || data.type}.`);
      resolve({ ok: false, error: "L'opération prend trop de temps et a été abandonnée." });
    }, timeoutMs);
    pending.set(id, { resolve, timer, channel: data.channel });
    child.postMessage({ id, ...data });
  });
}

/** Appelle une opération du moteur. Renvoie toujours { ok, data } ou { ok: false, error }. */
function call(channel, args = []) {
  return send({ channel, args }, LONG_TIMEOUTS[channel] || DEFAULT_TIMEOUT);
}

function onEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function stop() {
  stopping = true;
  failAll("L'application se ferme.");
  if (child) child.kill();
}

module.exports = { start, call, onEvent, stop };
