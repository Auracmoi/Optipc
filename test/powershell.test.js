'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeScript, firstMeaningfulLine, asArray, runPowerShell, MAX_SCRIPT_CHARS } = require('../src/main/lib/powershell');
const startup = require('../src/main/lib/startup');
const tweaks = require('../src/main/lib/tweaks');
const security = require('../src/main/lib/security');

test('encodeScript produit de l\'UTF-16LE base64 contenant le préambule et le script', () => {
  const decoded = Buffer.from(encodeScript('Write-Output "été"'), 'base64').toString('utf16le');
  assert.match(decoded, /\$ErrorActionPreference = 'Stop'/);
  assert.match(decoded, /ConvertFrom-Json/);
  assert.ok(decoded.endsWith('Write-Output "été"'));
});

test('firstMeaningfulLine ignore les lignes de position d\'erreur', () => {
  const stderr = 'Accès refusé.\r\nAt line:1 char:1\r\n+ Remove-Item x\r\n';
  assert.equal(firstMeaningfulLine(stderr), 'Accès refusé.');
  assert.equal(firstMeaningfulLine(''), '');
});

test('asArray normalise les sorties PowerShell', () => {
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray({ a: 1 }), [{ a: 1 }]);
  assert.deepEqual(asArray([1, 2]), [1, 2]);
});

test('runPowerShell refuse proprement hors Windows', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(runPowerShell('Out-Json 1'), { code: 'UNSUPPORTED_PLATFORM' });
});

test('tous les scripts PowerShell tiennent dans la limite de la ligne de commande', () => {
  const scripts = {
    'startup.LIST': startup.LIST_SCRIPT,
    'startup.TOGGLE': startup.TOGGLE_SCRIPT,
    ...Object.fromEntries(Object.entries(security.SCRIPTS).map(([k, v]) => [`security.${k}`, v])),
  };
  for (const [name, s] of Object.entries(scripts)) {
    assert.ok(s.length < MAX_SCRIPT_CHARS, `${name} trop long (${s.length})`);
    assert.ok(!s.includes('undefined'), `${name} contient « undefined » (erreur de gabarit)`);
    // Les scripts ne doivent jamais interpoler de données : tout passe par $OptArgs.
    assert.ok(!/\$\{/.test(s), `${name} contient une interpolation \${…}`);
  }
  assert.ok(tweaks.REGISTRY_TWEAKS.length > 0);
});
