'use strict';

// Vérifie que l'interface, le relais (ipc.js) et le moteur (backend.js) exposent exactement les mêmes opérations.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', f), 'utf8');

function backendChannels() {
  const src = read('backend.js');
  const block = src.slice(src.indexOf('const HANDLERS = {'), src.indexOf('};', src.indexOf('const HANDLERS = {')));
  return [...block.matchAll(/^\s*'([a-z]+:[A-Za-z]+)':/gm)].map((m) => m[1]).sort();
}

function forwardedChannels() {
  const src = read('ipc.js');
  const block = src.slice(src.indexOf('const FORWARDED = ['), src.indexOf('];', src.indexOf('const FORWARDED = [')));
  return [...block.matchAll(/'([a-z]+:[A-Za-z]+)'/g)].map((m) => m[1]);
}

function preloadChannels() {
  return [...read('preload.js').matchAll(/call\('([a-z]+:[A-Za-z]+)'\)/g)].map((m) => m[1]).sort();
}

test('chaque opération du moteur est relayée, et inversement', () => {
  const relayed = [...forwardedChannels(), 'monitor:kill'].sort();
  assert.deepEqual(relayed, backendChannels());
});

test("chaque fonction de l'interface correspond à une opération existante", () => {
  const local = ['shell:showItem', 'dialog:choosePath', 'clipboard:write'];
  const known = new Set([...backendChannels(), ...local]);
  for (const c of preloadChannels()) assert.ok(known.has(c), `canal inconnu : ${c}`);
  assert.equal(preloadChannels().length, known.size);
});

test("le processus principal ne charge aucun module système lourd", () => {
  for (const f of ['main.js', 'ipc.js', 'backend-client.js']) {
    assert.ok(!/require\('\.\/lib\//.test(read(f)), `${f} ne doit pas charger ./lib (travail système réservé au moteur)`);
  }
});
