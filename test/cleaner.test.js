'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertSafeRoot, isInside, cleanCategory, measureCategory, windowsCategories } = require('../src/main/lib/cleaner');

const DAY = 86_400_000;

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'optipc-test-'));
  const root = path.join(base, 'cache', 'Temp');
  const outside = path.join(base, 'precieux');
  fs.mkdirSync(path.join(root, 'sub', 'deep'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });

  const old = new Date(Date.now() - 3 * DAY);
  const write = (p, content, date) => {
    fs.writeFileSync(p, content);
    if (date) fs.utimesSync(p, date, date);
  };
  write(path.join(root, 'old.tmp'), 'x'.repeat(100), old);
  write(path.join(root, 'sub', 'old2.tmp'), 'y'.repeat(50), old);
  write(path.join(root, 'sub', 'deep', 'old3.tmp'), 'z'.repeat(25), old);
  write(path.join(root, 'recent.tmp'), 'r'.repeat(10)); // récent : à conserver
  write(path.join(outside, 'important.docx'), 'NE PAS SUPPRIMER', old);
  // Lien symbolique vers un dossier extérieur : ne doit JAMAIS être suivi.
  fs.symlinkSync(outside, path.join(root, 'lien-dangereux'), 'dir');
  // Dossiers vidés après nettoyage : rendus « anciens » pour pouvoir être supprimés.
  for (const d of [path.join(root, 'sub', 'deep'), path.join(root, 'sub')]) fs.utimesSync(d, old, old);
  return { base, root, outside };
}

const category = (root, extra = {}) => ({ id: 't', minAgeMs: DAY, roots: async () => [root], ...extra });

test('assertSafeRoot refuse les chemins dangereux', () => {
  assert.throws(() => assertSafeRoot('/'));
  assert.throws(() => assertSafeRoot('/tmp'));
  assert.throws(() => assertSafeRoot('relatif/dossier'));
  assert.throws(() => assertSafeRoot(''));
  assert.throws(() => assertSafeRoot(null));
  assert.doesNotThrow(() => assertSafeRoot('/home/user'));
});

test('isInside détecte les sorties de dossier', () => {
  assert.equal(isInside('/a/b', '/a/b/c'), true);
  assert.equal(isInside('/a/b', '/a/b'), false);
  assert.equal(isInside('/a/b', '/a/bc'), false);
  assert.equal(isInside('/a/b', '/a/b/../c'), false);
});

test('measureCategory compte uniquement les fichiers assez anciens', async () => {
  const { base, root } = setup();
  try {
    const m = await measureCategory(category(root));
    assert.equal(m.files, 3);
    assert.equal(m.bytes, 175);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('cleanCategory supprime les vieux fichiers, garde les récents et ne suit pas les liens', async () => {
  const { base, root, outside } = setup();
  try {
    const r = await cleanCategory(category(root));
    assert.equal(r.deleted, 3);
    assert.equal(r.freed, 175);
    assert.equal(r.failed, 0);
    assert.ok(fs.existsSync(path.join(root, 'recent.tmp')), 'le fichier récent doit rester');
    assert.ok(fs.existsSync(path.join(outside, 'important.docx')), 'le fichier hors du dossier doit rester');
    assert.ok(fs.lstatSync(path.join(root, 'lien-dangereux')).isSymbolicLink(), 'le lien lui-même reste intact');
    assert.ok(!fs.existsSync(path.join(root, 'sub')), 'les sous-dossiers vidés sont supprimés');
    assert.ok(fs.existsSync(root), 'le dossier racine est conservé');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('cleanCategory respecte le filtre de nom et le mode non récursif', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'optipc-test-'));
  const root = path.join(base, 'Microsoft', 'Explorer');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'thumbcache_256.db'), 'a');
  fs.writeFileSync(path.join(root, 'iconcache_32.db'), 'b');
  fs.writeFileSync(path.join(root, 'sub', 'thumbcache_1.db'), 'c');
  try {
    const r = await cleanCategory(category(root, { minAgeMs: 0, recursive: false, fileFilter: /^thumbcache_.*\.db$/i }));
    assert.equal(r.deleted, 1);
    assert.ok(!fs.existsSync(path.join(root, 'thumbcache_256.db')));
    assert.ok(fs.existsSync(path.join(root, 'iconcache_32.db')));
    assert.ok(fs.existsSync(path.join(root, 'sub', 'thumbcache_1.db')));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('les catégories Windows ne visent que des dossiers sûrs', async () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local',
    TEMP: 'C:\\Users\\Ana\\AppData\\Local\\Temp',
    SystemRoot: 'C:\\Windows',
    ProgramData: 'C:\\ProgramData',
  };
  const cats = windowsCategories(env);
  const ids = cats.map((c) => c.id);
  assert.deepEqual(ids, ['user-temp', 'windows-temp', 'browser-cache', 'thumbnails', 'crash-dumps']);
  for (const c of cats) {
    for (const r of (await c.roots()).filter(Boolean)) {
      const parts = r.split('\\').filter(Boolean);
      assert.ok(parts.length >= 3, `${c.id} : racine trop haute ${r}`);
      assert.ok(/^C:$/.test(parts[0]));
    }
  }
  assert.deepEqual(await cats[1].roots(), ['C:\\Windows\\Temp']);
  // Jamais le cache Windows Update (suppression définitive non vérifiée).
  for (const c of cats) assert.ok(!(await c.roots()).some((r) => /SoftwareDistribution/i.test(r || '')), c.id);
  // Variable manquante : aucune racine inventée.
  assert.deepEqual(await windowsCategories({})[1].roots(), [null]);
});
