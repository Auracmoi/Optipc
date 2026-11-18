'use strict';

const fs = require('node:fs');
const path = require('node:path');

/*
 * Préférences de l'application : %APPDATA%\OptiPC\config.json
 * Une seule pour l'instant : le mode lecture seule.
 */

const DEFAULTS = Object.freeze({ readOnly: false });
let file = null;
let current = { ...DEFAULTS };

function load(userDataDir) {
  file = path.join(userDataDir, 'config.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    current = { ...DEFAULTS, readOnly: saved.readOnly === true };
  } catch {
    current = { ...DEFAULTS };
  }
  return get();
}

function get() {
  return { ...current };
}

function setReadOnly(value) {
  if (typeof value !== 'boolean') throw new Error('Valeur invalide.');
  current.readOnly = value;
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf8');
  }
  return get();
}

module.exports = { load, get, setReadOnly, DEFAULTS };
