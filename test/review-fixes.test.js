'use strict';

// Tests des corrections issues de la revue de code (débogage complet).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cleaner = require('../src/main/lib/cleaner');
const config = require('../src/main/config');
const { WRITE_CHANNELS } = require('../src/main/ipc');

test('nettoyage : une racine non sûre est ignorée sans faire échouer la catégorie', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'optipc-rf-'));
  const good = path.join(base, 'cache', 'Temp');
  fs.mkdirSync(good, { recursive: true });
  const old = new Date(Date.now() - 3 * 86_400_000);
  fs.writeFileSync(path.join(good, 'a.tmp'), 'x'.repeat(10));
  fs.utimesSync(path.join(good, 'a.tmp'), old, old);
  try {
    // '/tmp' est trop proche de la racine du disque : refusée, mais la bonne racine est traitée.
    const cat = { id: 't', minAgeMs: 86_400_000, roots: async () => ['/tmp', good] };
    assert.deepEqual(await cleaner.measureCategory(cat), { bytes: 10, files: 1 });
    const r = await cleaner.cleanCategory(cat);
    assert.equal(r.deleted, 1);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("nettoyage : TEMP égal au Temp de Windows n'est pas compté deux fois", async () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local', SystemRoot: 'C:\\Windows', ProgramData: 'C:\\ProgramData' };
  const userTemp = (e) => cleaner.windowsCategories(e).find((c) => c.id === 'user-temp').roots();
  assert.deepEqual(await userTemp({ ...env, TEMP: 'C:\\WINDOWS\\Temp\\' }), []);
  assert.deepEqual(await userTemp({ ...env, TEMP: 'C:\\Users\\Ana\\AppData\\Local\\Temp' }), ['C:\\Users\\Ana\\AppData\\Local\\Temp']);
});

test("lecture seule : si l'écriture échoue, l'état ne change pas", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optipc-rf-'));
  try {
    config.load(dir);
    // Un dossier à la place du fichier : l'écriture échoue.
    fs.mkdirSync(path.join(dir, 'config.json'));
    assert.throws(() => config.setReadOnly(true));
    assert.equal(config.get().readOnly, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('lecture seule : analyses et mise à jour Defender sont protégées', () => {
  assert.ok(WRITE_CHANNELS.has('security:scan'));
  assert.ok(WRITE_CHANNELS.has('security:update'));
  assert.ok(!WRITE_CHANNELS.has('cleaner:scan'), 'mesurer reste possible');
});

test('antivirus : deux demandes rapprochées ne lancent pas deux analyses', async (t) => {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', real));
  delete require.cache[require.resolve('../src/main/lib/security')];
  const security = require('../src/main/lib/security');
  let done;
  const finished = new Promise((r) => { done = r; });
  const target = os.tmpdir();
  const results = await Promise.allSettled([
    security.startScan({ type: 'CustomScan', path: target }, done),
    security.startScan({ type: 'CustomScan', path: target }, done),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /déjà en cours/);
  await finished; // ici PowerShell est absent : l'analyse se termine en erreur, et l'état est libéré
  assert.equal(security.getScanState().running, false);
  // Un chemin inexistant annule la réservation.
  await assert.rejects(security.startScan({ type: 'CustomScan', path: path.join(target, 'nexiste-pas-xyz') }), /n'existe pas/);
  assert.equal(security.getScanState().running, false);
});
