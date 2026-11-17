'use strict';

const { runPowerShell, asArray, UnsupportedPlatformError } = require('./powershell');

/*
 * Les programmes au démarrage sont désactivés exactement comme le fait le
 * Gestionnaire des tâches de Windows : via les clés « StartupApproved ».
 * L'entrée d'origine n'est jamais supprimée, l'opération est donc 100 % réversible.
 *
 * Sources prises en charge (identifiant -> emplacement de l'entrée / clé d'approbation) :
 */
const SOURCES = {
  HKCU_RUN: {
    label: 'Registre (utilisateur)',
    approved: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
    requiresAdmin: false,
  },
  HKLM_RUN: {
    label: 'Registre (tous les utilisateurs)',
    approved: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
    requiresAdmin: true,
  },
  HKLM_RUN32: {
    label: 'Registre 32 bits (tous les utilisateurs)',
    approved: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32',
    requiresAdmin: true,
  },
  USER_FOLDER: {
    label: 'Dossier Démarrage (utilisateur)',
    approved: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
    requiresAdmin: false,
  },
  COMMON_FOLDER: {
    label: 'Dossier Démarrage (tous les utilisateurs)',
    approved: 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
    requiresAdmin: true,
  },
};

const LIST_SCRIPT = String.raw`
$approvedKeys = @{
  HKCU_RUN = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
  HKLM_RUN = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
  HKLM_RUN32 = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32'
  USER_FOLDER = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
  COMMON_FOLDER = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
}
function Get-Enabled($source, $name) {
  $p = Get-ItemProperty -Path $approvedKeys[$source] -Name $name -ErrorAction SilentlyContinue
  if ($null -eq $p) { return $true }
  $bytes = $p.$name
  if ($bytes -isnot [byte[]] -or $bytes.Length -eq 0) { return $true }
  return (($bytes[0] -band 1) -eq 0)  # octet impair = désactivé
}
function Get-ExePath($cmd) {
  if ($cmd -match '^\s*"([^"]+)"') { return $Matches[1] }
  if ($cmd -match '^\s*(.+?\.(exe|bat|cmd|com|lnk))(\s|$)') { return $Matches[1] }
  return ($cmd -split '\s')[0]
}
function Get-Publisher($file) {
  try {
    $f = [Environment]::ExpandEnvironmentVariables($file)
    if (Test-Path -LiteralPath $f -PathType Leaf) { return (Get-Item -LiteralPath $f).VersionInfo.CompanyName }
  } catch {}
  return $null
}
$items = New-Object System.Collections.ArrayList
$runKeys = @(
  @{ s = 'HKCU_RUN'; k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' },
  @{ s = 'HKLM_RUN'; k = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run' },
  @{ s = 'HKLM_RUN32'; k = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run' }
)
foreach ($rk in $runKeys) {
  $key = Get-Item -Path $rk.k -ErrorAction SilentlyContinue
  if ($null -eq $key) { continue }
  foreach ($name in $key.GetValueNames()) {
    if ([string]::IsNullOrEmpty($name)) { continue }
    $cmd = [string]$key.GetValue($name)
    $exe = Get-ExePath $cmd
    [void]$items.Add(@{ source = $rk.s; name = $name; command = $cmd; path = $exe; publisher = (Get-Publisher $exe); enabled = (Get-Enabled $rk.s $name) })
  }
}
$folders = @(
  @{ s = 'USER_FOLDER'; d = [Environment]::GetFolderPath('Startup') },
  @{ s = 'COMMON_FOLDER'; d = [Environment]::GetFolderPath('CommonStartup') }
)
$shell = New-Object -ComObject WScript.Shell
foreach ($f in $folders) {
  if (-not $f.d -or -not (Test-Path -LiteralPath $f.d)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $f.d -File -ErrorAction SilentlyContinue) {
    if ($file.Name -ieq 'desktop.ini') { continue }
    $target = $file.FullName
    if ($file.Extension -ieq '.lnk') { try { $t = $shell.CreateShortcut($file.FullName).TargetPath; if ($t) { $target = $t } } catch {} }
    [void]$items.Add(@{ source = $f.s; name = $file.Name; command = $target; path = $target; publisher = (Get-Publisher $target); enabled = (Get-Enabled $f.s $file.Name) })
  }
}
Out-Json @($items)
`;

const TOGGLE_SCRIPT = `
$key = $OptArgs.approvedKey
if (-not (Test-Path -Path $key)) { New-Item -Path $key -Force | Out-Null }
if ($OptArgs.enabled) { $first = 2 } else { $first = 3 }
$bytes = [byte[]]@($first,0,0,0,0,0,0,0,0,0,0,0)
New-ItemProperty -Path $key -Name $OptArgs.name -Value $bytes -PropertyType Binary -Force | Out-Null
Out-Json @{ ok = $true }
`;

function makeId(source, name) {
  return `${source}|${name}`;
}

async function list() {
  if (process.platform !== 'win32') return { supported: false, items: [] };
  const raw = asArray(await runPowerShell(LIST_SCRIPT, { timeoutMs: 45_000 }));
  const items = raw
    .filter((i) => i && SOURCES[i.source] && typeof i.name === 'string')
    .map((i) => ({
      id: makeId(i.source, i.name),
      name: i.name.replace(/\.lnk$/i, ''),
      rawName: i.name,
      command: i.command || '',
      path: i.path || '',
      publisher: i.publisher || null,
      source: i.source,
      location: SOURCES[i.source].label,
      requiresAdmin: SOURCES[i.source].requiresAdmin,
      enabled: i.enabled !== false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { supported: true, items };
}

/**
 * Active/désactive une entrée. L'identifiant est vérifié contre une énumération
 * fraîche : l'interface ne peut pas faire écrire une clé arbitraire.
 */
async function setEnabled(id, enabled, { isAdmin }) {
  if (process.platform !== 'win32') throw new UnsupportedPlatformError('La gestion du démarrage');
  if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error('Paramètres invalides.');
  const { items } = await list();
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error("Ce programme n'apparaît plus dans la liste de démarrage.");
  const source = SOURCES[item.source];
  if (source.requiresAdmin && !isAdmin) {
    throw new Error('Ce programme est lancé pour tous les utilisateurs : relancez l\'optimiseur en administrateur.');
  }
  await runPowerShell(TOGGLE_SCRIPT, { args: { approvedKey: source.approved, name: item.rawName, enabled } });
  return { ok: true };
}

module.exports = { list, setEnabled, SOURCES, LIST_SCRIPT, TOGGLE_SCRIPT };
