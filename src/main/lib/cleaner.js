'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { runPowerShell } = require('./powershell');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_ENTRIES_PER_ROOT = 300_000; // garde-fou contre les arborescences gigantesques

/**
 * Catégories nettoyables. Chaque catégorie fournit ses dossiers racines à partir
 * des variables d'environnement Windows : on ne supprime JAMAIS en dehors de ces dossiers.
 */
function windowsCategories(env = process.env) {
  const local = env.LOCALAPPDATA;
  const sysRoot = env.SystemRoot || env.windir;
  const programData = env.ProgramData;
  const j = (...p) => (p.every(Boolean) ? path.win32.join(...p) : null);

  return [
    {
      id: 'user-temp',
      label: 'Fichiers temporaires utilisateur',
      description: 'Fichiers laissés par les programmes et installateurs (plus de 24 h).',
      requiresAdmin: false,
      minAgeMs: DAY,
      roots: async () => [env.TEMP || j(local, 'Temp')],
    },
    {
      id: 'windows-temp',
      label: 'Fichiers temporaires Windows',
      description: 'Dossier Temp du système (plus de 24 h).',
      requiresAdmin: true,
      minAgeMs: DAY,
      roots: async () => [j(sysRoot, 'Temp')],
    },
    {
      id: 'browser-cache',
      label: 'Cache des navigateurs',
      description: 'Chrome, Edge, Brave et Firefox. Fermez vos navigateurs pour un nettoyage complet.',
      requiresAdmin: false,
      minAgeMs: 0,
      roots: async () => [
        ...(await chromiumCacheDirs(j(local, 'Google', 'Chrome', 'User Data'))),
        ...(await chromiumCacheDirs(j(local, 'Microsoft', 'Edge', 'User Data'))),
        ...(await chromiumCacheDirs(j(local, 'BraveSoftware', 'Brave-Browser', 'User Data'))),
        ...(await firefoxCacheDirs(j(local, 'Mozilla', 'Firefox', 'Profiles'))),
      ],
    },
    {
      id: 'thumbnails',
      label: 'Cache des miniatures',
      description: "Aperçus d'images de l'Explorateur, recréés automatiquement.",
      requiresAdmin: false,
      minAgeMs: 0,
      recursive: false,
      fileFilter: /^thumbcache_.*\.db$/i,
      roots: async () => [j(local, 'Microsoft', 'Windows', 'Explorer')],
    },
    {
      id: 'crash-dumps',
      label: 'Rapports de plantage',
      description: 'Vidages mémoire et rapports d\'erreurs Windows déjà traités.',
      requiresAdmin: true,
      minAgeMs: 0,
      roots: async () => [
        j(local, 'CrashDumps'),
        j(programData, 'Microsoft', 'Windows', 'WER', 'ReportArchive'),
        j(programData, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
      ],
    },
    {
      id: 'update-cache',
      label: 'Cache Windows Update',
      description: 'Mises à jour déjà installées (plus de 7 jours).',
      requiresAdmin: true,
      minAgeMs: 7 * DAY,
      roots: async () => [j(sysRoot, 'SoftwareDistribution', 'Download')],
    },
  ];
}

async function listDirs(dir) {
  if (!dir) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

async function chromiumCacheDirs(userDataDir) {
  const profiles = await listDirs(userDataDir);
  const out = [];
  for (const p of profiles) {
    const name = path.basename(p);
    if (name === 'Default' || /^Profile \d+$/.test(name)) {
      out.push(path.join(p, 'Cache', 'Cache_Data'), path.join(p, 'Code Cache'), path.join(p, 'GPUCache'));
    }
  }
  return out;
}

async function firefoxCacheDirs(profilesDir) {
  return (await listDirs(profilesDir)).map((p) => path.join(p, 'cache2'));
}

/** Refuse les racines dangereuses (racine d'un disque, dossier de premier niveau, chemin relatif). */
function assertSafeRoot(root) {
  if (!root || !path.isAbsolute(root)) throw new Error(`Chemin non autorisé : ${root}`);
  const parsed = path.parse(root);
  const rest = root.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
  if (rest.length < 2) throw new Error(`Chemin trop proche de la racine du disque : ${root}`);
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Parcourt un dossier sans jamais suivre les liens symboliques / jonctions.
 * Appelle onFile(chemin, stat) pour chaque fichier éligible et renvoie la liste
 * des sous-dossiers rencontrés (du plus profond au moins profond).
 */
async function walk(root, { minAgeMs = 0, recursive = true, fileFilter = null, now = Date.now(), onFile }) {
  assertSafeRoot(root);
  const dirs = [];
  const stack = [root];
  let seen = 0;

  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // dossier absent ou inaccessible
    }
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES_PER_ROOT) return dirs;
      const full = path.join(dir, entry.name);
      let st;
      try {
        st = await fs.lstat(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue; // ne jamais sortir du dossier via un lien
      if (st.isDirectory()) {
        if (recursive) {
          dirs.push({ path: full, mtimeMs: st.mtimeMs });
          stack.push(full);
        }
        continue;
      }
      if (!st.isFile()) continue;
      if (fileFilter && !fileFilter.test(entry.name)) continue;
      if (minAgeMs > 0 && now - st.mtimeMs < minAgeMs) continue;
      if (!isInside(root, full)) continue;
      await onFile(full, st);
    }
  }
  // Les plus profonds en premier pour pouvoir supprimer les dossiers vidés.
  dirs.sort((a, b) => b.path.length - a.path.length);
  return dirs;
}

async function existingRoots(category) {
  const roots = (await category.roots()).filter(Boolean);
  const out = [];
  for (const r of [...new Set(roots)]) {
    try {
      const st = await fs.lstat(r);
      if (st.isDirectory() && !st.isSymbolicLink()) out.push(r);
    } catch {
      /* absent */
    }
  }
  return out;
}

async function measureCategory(category, now = Date.now()) {
  let bytes = 0;
  let files = 0;
  for (const root of await existingRoots(category)) {
    await walk(root, {
      minAgeMs: category.minAgeMs,
      recursive: category.recursive !== false,
      fileFilter: category.fileFilter,
      now,
      onFile: (_p, st) => {
        bytes += st.size;
        files += 1;
      },
    });
  }
  return { bytes, files };
}

async function cleanCategory(category, now = Date.now()) {
  let freed = 0;
  let deleted = 0;
  let failed = 0;
  for (const root of await existingRoots(category)) {
    const dirs = await walk(root, {
      minAgeMs: category.minAgeMs,
      recursive: category.recursive !== false,
      fileFilter: category.fileFilter,
      now,
      onFile: async (p, st) => {
        try {
          await fs.unlink(p);
          freed += st.size;
          deleted += 1;
        } catch {
          failed += 1; // fichier en cours d'utilisation : on le laisse
        }
      },
    });
    for (const d of dirs) {
      if (category.minAgeMs > 0 && now - d.mtimeMs < category.minAgeMs) continue;
      if (!isInside(root, d.path)) continue;
      await fs.rmdir(d.path).catch(() => {}); // échoue sans dommage si non vide
    }
  }
  return { freed, deleted, failed };
}

// ---- Corbeille (via l'API Shell de Windows) ----

async function measureRecycleBin() {
  const r = await runPowerShell(`
$bin = (New-Object -ComObject Shell.Application).Namespace(10)
$size = [int64]0; $count = 0
foreach ($i in $bin.Items()) { $count++; try { $size += [int64]$i.ExtendedProperty('Size') } catch {} }
Out-Json @{ bytes = $size; files = $count }`);
  return { bytes: Number(r?.bytes) || 0, files: Number(r?.files) || 0 };
}

async function emptyRecycleBin() {
  const before = await measureRecycleBin();
  await runPowerShell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue', { json: false });
  return { freed: before.bytes, deleted: before.files, failed: 0 };
}

// ---- API publique ----

const RECYCLE_BIN = {
  id: 'recycle-bin',
  label: 'Corbeille',
  description: 'Fichiers supprimés en attente. Ils seront définitivement effacés.',
  requiresAdmin: false,
};

function getCategories() {
  if (process.platform !== 'win32') return [];
  return windowsCategories();
}

async function scan({ isAdmin }) {
  if (process.platform !== 'win32') {
    return { supported: false, categories: [] };
  }
  const results = [];
  for (const cat of getCategories()) {
    const base = { id: cat.id, label: cat.label, description: cat.description, requiresAdmin: cat.requiresAdmin };
    if (cat.requiresAdmin && !isAdmin) {
      results.push({ ...base, bytes: 0, files: 0, blocked: true });
      continue;
    }
    results.push({ ...base, ...(await measureCategory(cat)), blocked: false });
  }
  const bin = await measureRecycleBin().catch(() => ({ bytes: 0, files: 0 }));
  results.push({ ...RECYCLE_BIN, ...bin, blocked: false });
  return { supported: true, categories: results };
}

let cleaning = false;

async function clean(ids, { isAdmin }) {
  if (process.platform !== 'win32') throw new Error("Le nettoyage n'est disponible que sous Windows pour le moment.");
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Aucune catégorie sélectionnée.');
  if (cleaning) throw new Error('Un nettoyage est déjà en cours.');
  cleaning = true;
  try {
    const cats = new Map(getCategories().map((c) => [c.id, c]));
    const report = [];
    for (const id of new Set(ids)) {
      if (id === RECYCLE_BIN.id) {
        report.push({ id, ...(await emptyRecycleBin()) });
        continue;
      }
      const cat = cats.get(id);
      if (!cat) continue; // identifiant inconnu : ignoré
      if (cat.requiresAdmin && !isAdmin) {
        report.push({ id, freed: 0, deleted: 0, failed: 0, skipped: 'Droits administrateur requis' });
        continue;
      }
      report.push({ id, ...(await cleanCategory(cat)) });
    }
    const totals = report.reduce(
      (t, r) => ({ freed: t.freed + r.freed, deleted: t.deleted + r.deleted, failed: t.failed + r.failed }),
      { freed: 0, deleted: 0, failed: 0 },
    );
    return { report, totals };
  } finally {
    cleaning = false;
  }
}

module.exports = {
  scan,
  clean,
  // exportés pour les tests
  windowsCategories,
  assertSafeRoot,
  isInside,
  walk,
  measureCategory,
  cleanCategory,
};
