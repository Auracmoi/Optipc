'use strict';

const fs = require('node:fs');
const path = require('node:path');

/*
 * Journal de diagnostic : %APPDATA%\OptiPC\logs\optipc.log
 * En cas de problème, ce fichier permet de comprendre ce qui s'est passé.
 */

const MAX_SIZE = 1024 * 1024; // 1 Mo : l'ancien journal est renommé en .old
let file = null;

function init(userDataDir) {
  try {
    const dir = path.join(userDataDir, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'optipc.log');
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_SIZE) {
      fs.renameSync(file, `${file}.old`);
    }
  } catch {
    file = null;
  }
  return file;
}

function write(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  if (process.env.OPTIPC_DEBUG) process.stdout.write(line);
  if (!file) return;
  try {
    fs.appendFileSync(file, line, 'utf8');
  } catch {
    /* le journal ne doit jamais faire planter l'application */
  }
}

module.exports = { init, write, get file() { return file; } };
