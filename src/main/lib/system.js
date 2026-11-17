'use strict';

const { execFile } = require('node:child_process');
const os = require('node:os');

let adminCache = null;

/**
 * Indique si l'application tourne avec les droits administrateur.
 * Sous Windows, `net session` ne réussit qu'en mode administrateur (méthode classique et rapide).
 */
function isAdmin() {
  if (adminCache !== null) return Promise.resolve(adminCache);
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('net', ['session'], { windowsHide: true }, (err) => {
        adminCache = !err;
        resolve(adminCache);
      });
    } else {
      adminCache = typeof process.getuid === 'function' && process.getuid() === 0;
      resolve(adminCache);
    }
  });
}

async function getAppInfo() {
  return {
    platform: process.platform,
    isWindows: process.platform === 'win32',
    hostname: os.hostname(),
    isAdmin: await isAdmin(),
  };
}

module.exports = { isAdmin, getAppInfo };
