'use strict';

const { spawn } = require('node:child_process');

class UnsupportedPlatformError extends Error {
  constructor(feature = 'Cette fonction') {
    super(`${feature} n'est disponible que sous Windows pour le moment.`);
    this.name = 'UnsupportedPlatformError';
    this.code = 'UNSUPPORTED_PLATFORM';
  }
}

// Préambule ajouté à chaque script :
// - arrêt sur la première erreur,
// - sortie en UTF-8 (accents corrects),
// - les arguments arrivent par variable d'environnement (JSON) et JAMAIS par
//   interpolation de texte : aucune injection de commande possible.
const PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$OptArgs = $null',
  'if ($env:OPT_ARGS) { $OptArgs = $env:OPT_ARGS | ConvertFrom-Json }',
  // Sérialise n'importe quelle valeur en JSON compact (tableaux préservés).
  'function Out-Json($Value) { ConvertTo-Json -InputObject $Value -Depth 6 -Compress }',
].join('\n');

// La ligne de commande Windows est limitée à 32 767 caractères ; le script
// encodé (UTF-16 + base64) occupe ~2,7 fois sa taille.
const MAX_SCRIPT_CHARS = 11000;

function encodeScript(script) {
  return Buffer.from(`${PRELUDE}\n${script}`, 'utf16le').toString('base64');
}

function firstMeaningfulLine(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('At line:') && !l.startsWith('+') && !l.startsWith('Au caractère'));
  return lines[0] || '';
}

/**
 * Exécute un script PowerShell (Windows PowerShell 5.1, présent sur tout Windows 10/11).
 * @param {string} script  Script dont la sortie standard est du JSON (via Out-Json) ou vide.
 * @param {object} [opts]
 * @param {object} [opts.args]       Arguments transmis en JSON dans $OptArgs.
 * @param {number} [opts.timeoutMs]  Délai maximal avant arrêt forcé.
 * @param {boolean} [opts.json]      Analyser la sortie comme du JSON (par défaut : oui).
 */
function runPowerShell(script, { args = {}, timeoutMs = 60_000, json = true } = {}) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new UnsupportedPlatformError());
      return;
    }
    if (script.length > MAX_SCRIPT_CHARS) {
      reject(new Error(`Script PowerShell trop long (${script.length} caractères).`));
      return;
    }

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeScript(script)],
      { windowsHide: true, env: { ...process.env, OPT_ARGS: JSON.stringify(args) } },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`PowerShell n'a pas répondu dans le délai imparti (${Math.round(timeoutMs / 1000)} s).`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      if (code !== 0) {
        const msg = firstMeaningfulLine(stderr) || `PowerShell a échoué (code ${code}).`;
        finish(reject, new Error(msg));
        return;
      }
      if (!json) {
        finish(resolve, stdout);
        return;
      }
      const text = stdout.trim();
      if (!text) {
        finish(resolve, null);
        return;
      }
      try {
        finish(resolve, JSON.parse(text));
      } catch {
        finish(reject, new Error(`Réponse PowerShell illisible : ${text.slice(0, 200)}`));
      }
    });
  });
}

/** Normalise une valeur PowerShell en tableau (ConvertTo-Json renvoie un objet seul s'il n'y a qu'un élément). */
function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

module.exports = { runPowerShell, asArray, UnsupportedPlatformError, encodeScript, firstMeaningfulLine, MAX_SCRIPT_CHARS };
