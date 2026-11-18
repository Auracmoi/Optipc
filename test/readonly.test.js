'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../src/main/config');
const { WRITE_CHANNELS, FORWARDED, guarded } = require('../src/main/ipc');

test('la préférence lecture seule est sauvegardée et relue', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optipc-cfg-'));
  try {
    assert.equal(config.load(dir).readOnly, false, 'désactivé par défaut');
    config.setReadOnly(true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')).readOnly, true);
    assert.equal(config.load(dir).readOnly, true, 'relu après redémarrage');
    assert.throws(() => config.setReadOnly('oui'), /invalide/);
    fs.writeFileSync(path.join(dir, 'config.json'), '{corrompu');
    assert.equal(config.load(dir).readOnly, false, 'fichier corrompu : valeur par défaut');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('en lecture seule, toute opération qui modifie le PC est refusée', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optipc-cfg-'));
  try {
    config.load(dir);
    config.setReadOnly(true);
    for (const channel of WRITE_CHANNELS) {
      const r = await guarded(channel, []);
      assert.equal(r.ok, false, channel);
      assert.equal(r.code, 'READ_ONLY', channel);
    }
    // Une lecture n'est pas bloquée par le mode (ici le moteur n'est pas lancé : autre message).
    const read = await guarded('monitor:live', []);
    assert.notEqual(read.code, 'READ_ONLY');
    config.setReadOnly(false);
    const write = await guarded('cleaner:clean', [[]]);
    assert.notEqual(write.code, 'READ_ONLY', 'désactivé : plus de refus lecture seule');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('chaque opération d\'écriture existe bien dans le relais', () => {
  const all = new Set([...FORWARDED, 'monitor:kill']);
  for (const c of WRITE_CHANNELS) assert.ok(all.has(c), c);
  // Les opérations qui modifient le PC doivent toutes être protégées.
  for (const c of ['cleaner:clean', 'startup:toggle', 'tweaks:apply', 'tweaks:revert', 'tweaks:restorePoint', 'security:removeThreats', 'monitor:kill']) {
    assert.ok(WRITE_CHANNELS.has(c), c);
  }
});
