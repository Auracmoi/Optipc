'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { runPowerShell, asArray, UnsupportedPlatformError } = require('./powershell');

const HIGH_PERF_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const BALANCED_GUID = '381b4222-f694-41f0-9685-ff5bb260df2e';

/*
 * Réglages proposés. Uniquement des réglages documentés, sans risque et réversibles :
 * la valeur d'origine est sauvegardée avant toute modification.
 */
const REGISTRY_TWEAKS = [
  {
    id: 'transparency',
    title: 'Désactiver la transparence',
    description: "Supprime les effets de transparence de la barre des tâches et des menus. Allège la charge graphique sur les PC modestes.",
    impact: 'Moyen',
    needsRelogin: false,
    values: [
      { path: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', name: 'EnableTransparency', type: 'DWord', optimal: 0 },
    ],
  },
  {
    id: 'animations',
    title: 'Réduire les animations des fenêtres',
    description: "Désactive l'animation de réduction/agrandissement des fenêtres et accélère l'ouverture des menus.",
    impact: 'Moyen',
    needsRelogin: true,
    values: [
      { path: 'HKCU:\\Control Panel\\Desktop\\WindowMetrics', name: 'MinAnimate', type: 'String', optimal: '0' },
      { path: 'HKCU:\\Control Panel\\Desktop', name: 'MenuShowDelay', type: 'String', optimal: '100' },
    ],
  },
  {
    id: 'game-mode',
    title: 'Activer le mode Jeu',
    description: 'Windows donne la priorité au jeu en cours et suspend les mises à jour en arrière-plan pendant la partie.',
    impact: 'Élevé (jeux)',
    needsRelogin: false,
    values: [
      { path: 'HKCU:\\Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', type: 'DWord', optimal: 1 },
    ],
  },
  {
    id: 'game-dvr',
    title: "Désactiver l'enregistrement de jeu en arrière-plan",
    description: "Coupe la capture vidéo permanente de la Xbox Game Bar (Game DVR), qui consomme processeur et carte graphique.",
    impact: 'Élevé (jeux)',
    needsRelogin: false,
    values: [
      { path: 'HKCU:\\System\\GameConfigStore', name: 'GameDVR_Enabled', type: 'DWord', optimal: 0 },
      { path: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', name: 'AppCaptureEnabled', type: 'DWord', optimal: 0 },
    ],
  },
];

const READ_SCRIPT = `
$out = New-Object System.Collections.ArrayList
foreach ($v in $OptArgs.values) {
  $p = Get-ItemProperty -Path $v.path -Name $v.name -ErrorAction SilentlyContinue
  if ($null -eq $p) { [void]$out.Add(@{ exists = $false; value = $null }) }
  else { [void]$out.Add(@{ exists = $true; value = $p.($v.name) }) }
}
$scheme = (powercfg /getactivescheme) | Out-String
Out-Json @{ values = @($out); scheme = $scheme }
`;

const WRITE_SCRIPT = `
foreach ($v in $OptArgs.values) {
  if ($v.remove) {
    Remove-ItemProperty -Path $v.path -Name $v.name -ErrorAction SilentlyContinue
    continue
  }
  if (-not (Test-Path -Path $v.path)) { New-Item -Path $v.path -Force | Out-Null }
  if ($v.type -eq 'DWord') { $val = [int]$v.value } else { $val = [string]$v.value }
  New-ItemProperty -Path $v.path -Name $v.name -Value $val -PropertyType $v.type -Force | Out-Null
}
Out-Json @{ ok = $true }
`;

const POWER_SCRIPT = `
$guid = $OptArgs.guid
$list = (powercfg /list) | Out-String
if ($list -notmatch [regex]::Escape($guid)) {
  # Certains PC (veille moderne) masquent ce mode : on le recrée avec son GUID d'origine.
  powercfg -duplicatescheme $guid $guid | Out-Null
}
powercfg /setactive $guid
if ($LASTEXITCODE -ne 0) { throw "Impossible d'activer ce mode d'alimentation." }
Out-Json @{ ok = $true }
`;

const RESTORE_POINT_SCRIPT = `
$w = $null
Checkpoint-Computer -Description 'Optimiseur PC - avant réglages' -RestorePointType 'MODIFY_SETTINGS' -WarningVariable w -WarningAction SilentlyContinue
if ($w) { Out-Json @{ created = $false; message = [string]$w[0] } } else { Out-Json @{ created = $true; message = 'Point de restauration créé.' } }
`;

let backupFile = null;

function init({ userDataDir }) {
  backupFile = path.join(userDataDir, 'tweaks-backup.json');
}

async function readBackup() {
  try {
    return JSON.parse(await fs.readFile(backupFile, 'utf8'));
  } catch {
    return {};
  }
}

async function writeBackup(data) {
  await fs.mkdir(path.dirname(backupFile), { recursive: true });
  await fs.writeFile(backupFile, JSON.stringify(data, null, 2), 'utf8');
}

function parseActiveScheme(text) {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\(([^)]*)\)/i.exec(String(text || ''));
  return m ? { guid: m[1].toLowerCase(), name: m[2].trim() } : null;
}

function sameValue(a, b) {
  return String(a) === String(b);
}

async function list() {
  if (process.platform !== 'win32') return { supported: false, tweaks: [] };
  const allValues = REGISTRY_TWEAKS.flatMap((t) => t.values.map(({ path: p, name }) => ({ path: p, name })));
  const res = await runPowerShell(READ_SCRIPT, { args: { values: allValues } });
  const read = asArray(res?.values);
  const backup = await readBackup();

  let i = 0;
  const tweaks = REGISTRY_TWEAKS.map((t) => {
    const current = t.values.map(() => read[i++] || { exists: false, value: null });
    const applied = t.values.every((v, k) => current[k].exists && sameValue(current[k].value, v.optimal));
    return {
      id: t.id,
      title: t.title,
      description: t.description,
      impact: t.impact,
      needsRelogin: t.needsRelogin,
      applied,
      canRevert: Boolean(backup[t.id]),
    };
  });

  const scheme = parseActiveScheme(res?.scheme);
  tweaks.unshift({
    id: 'power-plan',
    title: 'Mode d\'alimentation « Performances élevées »',
    description: `Le processeur reste à sa fréquence maximale. Recommandé sur PC fixe ; sur portable, l'autonomie diminue. Mode actuel : ${scheme ? scheme.name : 'inconnu'}.`,
    impact: 'Élevé',
    needsRelogin: false,
    applied: scheme?.guid === HIGH_PERF_GUID,
    canRevert: Boolean(backup['power-plan']),
  });

  return { supported: true, tweaks };
}

function findTweak(id) {
  return REGISTRY_TWEAKS.find((t) => t.id === id);
}

async function apply(id) {
  if (process.platform !== 'win32') throw new UnsupportedPlatformError('Les réglages système');
  const backup = await readBackup();

  if (id === 'power-plan') {
    const res = await runPowerShell(READ_SCRIPT, { args: { values: [] } });
    const scheme = parseActiveScheme(res?.scheme);
    if (!backup['power-plan'] && scheme && scheme.guid !== HIGH_PERF_GUID) {
      backup['power-plan'] = { guid: scheme.guid };
      await writeBackup(backup);
    }
    await runPowerShell(POWER_SCRIPT, { args: { guid: HIGH_PERF_GUID } });
    return { ok: true };
  }

  const tweak = findTweak(id);
  if (!tweak) throw new Error('Réglage inconnu.');

  // Sauvegarde des valeurs d'origine (une seule fois, pour toujours pouvoir revenir à l'état initial).
  if (!backup[id]) {
    const res = await runPowerShell(READ_SCRIPT, {
      args: { values: tweak.values.map(({ path: p, name }) => ({ path: p, name })) },
    });
    const read = asArray(res?.values);
    backup[id] = tweak.values.map((v, k) => ({
      path: v.path,
      name: v.name,
      type: v.type,
      existed: Boolean(read[k]?.exists),
      value: read[k]?.exists ? read[k].value : null,
    }));
    await writeBackup(backup);
  }

  await runPowerShell(WRITE_SCRIPT, {
    args: { values: tweak.values.map((v) => ({ path: v.path, name: v.name, type: v.type, value: v.optimal })) },
  });
  return { ok: true, needsRelogin: tweak.needsRelogin };
}

async function revert(id) {
  if (process.platform !== 'win32') throw new UnsupportedPlatformError('Les réglages système');
  const backup = await readBackup();
  const saved = backup[id];
  if (!saved) throw new Error("Aucune sauvegarde pour ce réglage : il n'a pas été modifié par l'optimiseur.");

  if (id === 'power-plan') {
    await runPowerShell(POWER_SCRIPT, { args: { guid: saved.guid || BALANCED_GUID } });
  } else {
    const tweak = findTweak(id);
    if (!tweak) throw new Error('Réglage inconnu.');
    // On ne restaure que des clés de la liste blanche (pas celles éventuellement modifiées dans le fichier).
    const allowed = new Set(tweak.values.map((v) => `${v.path}|${v.name}|${v.type}`));
    const values = saved
      .filter((s) => allowed.has(`${s.path}|${s.name}|${s.type}`))
      .map((s) => (s.existed ? { path: s.path, name: s.name, type: s.type, value: s.value } : { path: s.path, name: s.name, remove: true }));
    await runPowerShell(WRITE_SCRIPT, { args: { values } });
  }

  delete backup[id];
  await writeBackup(backup);
  return { ok: true };
}

async function createRestorePoint() {
  if (process.platform !== 'win32') throw new UnsupportedPlatformError('Le point de restauration');
  try {
    return await runPowerShell(RESTORE_POINT_SCRIPT, { timeoutMs: 180_000 });
  } catch (err) {
    const reason = /[.!?]$/.test(err.message.trim()) ? err.message.trim() : `${err.message.trim()}.`;
    throw new Error(
      `Point de restauration impossible : ${reason} Vérifiez que l'optimiseur est lancé en administrateur et que la Protection du système est activée sur le disque C:.`,
    );
  }
}

/** État du mode d'alimentation, utilisé par le diagnostic. */
async function getPowerScheme() {
  if (process.platform !== 'win32') return null;
  const res = await runPowerShell(READ_SCRIPT, { args: { values: [] } });
  const scheme = parseActiveScheme(res?.scheme);
  return scheme ? { ...scheme, isHighPerformance: scheme.guid === HIGH_PERF_GUID } : null;
}

module.exports = { init, list, apply, revert, createRestorePoint, getPowerScheme, parseActiveScheme, REGISTRY_TWEAKS, HIGH_PERF_GUID };
