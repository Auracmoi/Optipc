'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/main/security-policy');

test("seules les URL de l'application sont reconnues (origine, pas préfixe)", () => {
  assert.equal(p.isAppUrl('optipc://app/index.html'), true);
  assert.equal(p.isAppUrl('optipc://app.evil.com/index.html'), false);
  assert.equal(p.isAppUrl('optipc://evil/index.html'), false);
  assert.equal(p.isAppUrl('file:///C:/index.html'), false);
  assert.equal(p.isAppUrl('https://app/'), false);
  assert.equal(p.isAppUrl('pas une url'), false);
});

test('liens externes : https et liste fermée uniquement', () => {
  assert.equal(p.isSafeExternal('https://www.virustotal.com/gui/file/ABC'), true);
  assert.equal(p.isSafeExternal('http://www.virustotal.com/gui/file/ABC'), false);
  assert.equal(p.isSafeExternal('https://www.virustotal.com.evil.com/'), false);
  assert.equal(p.isSafeExternal('https://user:pass@www.virustotal.com/'), false);
  assert.equal(p.isSafeExternal('file:///C:/Windows/System32/calc.exe'), false);
  assert.equal(p.isSafeExternal('ms-settings:privacy'), false);
});

test("le protocole ne sert que les fichiers de l'interface", () => {
  assert.match(p.resolveAppFile('optipc://app/index.html'), /renderer[\\/]index\.html$/);
  assert.match(p.resolveAppFile('optipc://app/'), /renderer[\\/]index\.html$/);
  assert.match(p.resolveAppFile('optipc://app/js/pages/cleaner.js'), /cleaner\.js$/);
  // L'URL normalise « .. » : le chemin reste dans le dossier de l'interface, jamais dans src/main.
  assert.match(p.resolveAppFile('optipc://app/../main/main.js'), /renderer[\\/]main[\\/]main\.js$/);
  assert.match(p.resolveAppFile('optipc://app/%2e%2e/main/main.js'), /renderer[\\/]main[\\/]main\.js$/);
  // Barres obliques encodées : décodées APRÈS l'analyse de l'URL, elles tenteraient de sortir → refusé.
  assert.equal(p.resolveAppFile('optipc://app/..%2fmain%2fmain.js'), null);
  assert.equal(p.resolveAppFile('optipc://app/index.json'), null, 'extension non servie');
  assert.equal(p.resolveAppFile('optipc://autre/index.html'), null);
});

test('expéditeur IPC : uniquement la page de l\'application', () => {
  assert.equal(p.isTrustedSender({ url: 'optipc://app/index.html' }), true);
  assert.equal(p.isTrustedSender({ url: 'https://www.virustotal.com/' }), false);
  assert.equal(p.isTrustedSender({ url: 'about:blank' }), false);
  assert.equal(p.isTrustedSender(null), false);
});

test('réponse du protocole : 200 pour un fichier, 404 sinon', async () => {
  const ok = await p.serveAppRequest({ url: 'optipc://app/index.html' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/html/);
  assert.match(await ok.text(), /OptiPC/);
  assert.equal((await p.serveAppRequest({ url: 'optipc://app/../../package.json' })).status, 404);
  assert.equal((await p.serveAppRequest({ url: 'optipc://app/absent.js' })).status, 404);
});
