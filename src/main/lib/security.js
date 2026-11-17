'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { runPowerShell, asArray, UnsupportedPlatformError } = require('./powershell');

/*
 * Sécurité : le moteur antivirus est Microsoft Defender (intégré à Windows,
 * signatures mises à jour quotidiennement par Microsoft). L'optimiseur le pilote
 * et ajoute une « analyse avancée » heuristique qui recherche les signes
 * classiques d'infection que l'antivirus ne signale pas forcément.
 */

const DATE_FN = "function D($d) { if ($d) { try { return ([datetime]$d).ToString('o') } catch {} }; return $null }";

const STATUS_SCRIPT = `${DATE_FN}
$r = @{}
try {
  $s = Get-MpComputerStatus
  $r.defender = @{
    available = $true
    serviceEnabled = [bool]$s.AMServiceEnabled
    antivirusEnabled = [bool]$s.AntivirusEnabled
    realTime = [bool]$s.RealTimeProtectionEnabled
    tamperProtected = [bool]$s.IsTamperProtected
    signatureVersion = [string]$s.AntivirusSignatureVersion
    signatureUpdated = (D $s.AntivirusSignatureLastUpdated)
    quickScanEnd = (D $s.QuickScanEndTime)
    fullScanEnd = (D $s.FullScanEndTime)
  }
} catch { $r.defender = @{ available = $false; error = $_.Exception.Message } }
try {
  $r.products = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { @{ name = [string]$_.displayName; state = [int]$_.productState } })
} catch { $r.products = @() }
try {
  $r.firewall = @(Get-NetFirewallProfile | ForEach-Object { @{ name = [string]$_.Name; enabled = ([string]$_.Enabled -eq 'True') } })
} catch { $r.firewall = @() }
try {
  $r.uac = [int](Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name EnableLUA).EnableLUA
} catch { $r.uac = $null }
Out-Json $r
`;

const UPDATE_SCRIPT = 'Update-MpSignature\nOut-Json @{ ok = $true }';

const SCAN_SCRIPT = `
if ($OptArgs.type -eq 'CustomScan') { Start-MpScan -ScanType CustomScan -ScanPath $OptArgs.path }
else { Start-MpScan -ScanType $OptArgs.type }
Out-Json @{ ok = $true }
`;

const THREATS_SCRIPT = `${DATE_FN}
$threats = @{}
foreach ($t in @(Get-MpThreat -ErrorAction SilentlyContinue)) { if ($t) { $threats[[string]$t.ThreatID] = $t } }
$out = New-Object System.Collections.ArrayList
foreach ($d in @(Get-MpThreatDetection -ErrorAction SilentlyContinue)) {
  if (-not $d) { continue }
  $t = $threats[[string]$d.ThreatID]
  $name = 'Menace inconnue'; $sev = 0; $active = $false
  if ($t) { $name = [string]$t.ThreatName; $sev = [int]$t.SeverityID; $active = [bool]$t.IsActive }
  [void]$out.Add(@{
    id = [string]$d.ThreatID; name = $name; severity = $sev; active = $active
    resources = @($d.Resources | ForEach-Object { [string]$_ })
    detected = (D $d.InitialDetectionTime); actionSuccess = [bool]$d.ActionSuccess
  })
}
Out-Json @($out)
`;

const REMOVE_SCRIPT = 'Remove-MpThreat\nOut-Json @{ ok = $true }';

// Analyse heuristique : processus, démarrage, tâches planifiées, fichier hosts, exclusions, proxy.
const AUDIT_SCRIPT = String.raw`
$suspect = '\\AppData\\Local\\Temp\\|\\Downloads\\|\\Users\\Public\\|\\Windows\\Temp\\|\\AppData\\Roaming\\[^\\]+\.exe$|\\ProgramData\\[^\\]+\.exe$'
$trusted = '^[A-Za-z]:\\(Windows|Program Files|Program Files \(x86\))\\'
$found = New-Object System.Collections.ArrayList
$sigCache = @{}
function Sig($p) {
  if (-not $sigCache.ContainsKey($p)) {
    try { $sigCache[$p] = [string](Get-AuthenticodeSignature -LiteralPath $p).Status } catch { $sigCache[$p] = 'Unknown' }
  }
  return $sigCache[$p]
}
function Add-F($kind, $sev, $title, $detail, $path, $procId) {
  [void]$found.Add(@{ kind = $kind; severity = $sev; title = $title; detail = $detail; path = $path; pid = $procId })
}
function Rate($p) {
  if (-not $p -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { return $null }
  if ($p -match $trusted) { return $null }
  $s = Sig $p
  if ($s -eq 'Valid') { return $null }
  if ($p -match $suspect) { return @('high', $s) }
  return @('medium', $s)
}
function ExePath($cmd) {
  $c = [Environment]::ExpandEnvironmentVariables([string]$cmd)
  if ($c -match '^\s*"([^"]+)"') { return $Matches[1] }
  if ($c -match '^\s*(.+?\.(exe|bat|cmd|com|scr|vbs|js|ps1))(\s|$)') { return $Matches[1] }
  return ($c -split '\s')[0]
}

# 1. Processus en cours
$seen = @{}
foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
  $exe = $p.ExecutablePath
  if (-not $exe -or $seen.ContainsKey($exe)) { continue }
  $seen[$exe] = $true
  $r = Rate $exe
  if ($r) { Add-F 'process' $r[0] ('Processus non signé : ' + $p.Name) ('Signature : ' + $r[1] + '. Programme lancé hors des dossiers système.') $exe ([int]$p.ProcessId) }
}

# 2. Programmes au démarrage (registre)
$runKeys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run','HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce','HKLM:\Software\Microsoft\Windows\CurrentVersion\Run','HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
foreach ($k in $runKeys) {
  $key = Get-Item -Path $k -ErrorAction SilentlyContinue
  if (-not $key) { continue }
  foreach ($n in $key.GetValueNames()) {
    if (-not $n) { continue }
    $cmd = [string]$key.GetValue($n)
    $exe = ExePath $cmd
    if ($cmd -match '(?i)-enc(odedcommand)?\s|frombase64string|downloadstring|invoke-expression|\biex\b') {
      Add-F 'startup' 'high' ('Démarrage avec commande obfusquée : ' + $n) $cmd $exe $null; continue
    }
    if ($exe -and [IO.Path]::IsPathRooted($exe) -and -not (Test-Path -LiteralPath $exe)) {
      Add-F 'startup' 'low' ('Entrée de démarrage orpheline : ' + $n) ('Le fichier n''existe plus : ' + $exe) $null $null; continue
    }
    $r = Rate $exe
    if ($r) { Add-F 'startup' $r[0] ('Démarrage non signé : ' + $n) ('Signature : ' + $r[1] + '. Commande : ' + $cmd) $exe $null }
  }
}

# 3. Tâches planifiées
foreach ($t in @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Disabled' })) {
  foreach ($a in @($t.Actions)) {
    if (-not $a.Execute) { continue }
    $full = ([string]$a.Execute + ' ' + [string]$a.Arguments)
    $exe = ExePath $a.Execute
    if ($full -match '(?i)-enc(odedcommand)?\s|frombase64string|downloadstring|invoke-expression|\biex\b') {
      Add-F 'task' 'high' ('Tâche planifiée avec commande obfusquée : ' + $t.TaskName) $full $exe $null; continue
    }
    if ($exe -match $suspect) {
      $r = Rate $exe
      if ($r) { Add-F 'task' 'high' ('Tâche planifiée suspecte : ' + $t.TaskName) ('Exécute un programme non signé depuis un dossier temporaire : ' + $full) $exe $null }
    }
  }
}

# 4. Fichier hosts
$hosts = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
if (Test-Path -LiteralPath $hosts) {
  $lines = @(Get-Content -LiteralPath $hosts -ErrorAction SilentlyContinue | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') -and $_ -notmatch '^(127\.0\.0\.1|::1)\s+localhost$' })
  if ($lines.Count -gt 0) {
    Add-F 'hosts' 'medium' ('Fichier hosts modifié (' + $lines.Count + ' redirection(s))') (($lines | Select-Object -First 5) -join ' | ') $hosts $null
  }
}

# 5. Exclusions de Microsoft Defender
try {
  $pref = Get-MpPreference
  $ex = @($pref.ExclusionPath) + @($pref.ExclusionProcess) + @($pref.ExclusionExtension) | Where-Object { $_ -and -not ([string]$_).StartsWith('N/A') }
  foreach ($e in $ex) { Add-F 'exclusion' 'medium' 'Exclusion Defender' ('Defender n''analyse pas : ' + $e + '. À supprimer si vous ne l''avez pas ajoutée vous-même.') $null $null }
} catch {}

# 6. Proxy système
try {
  $is = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
  if ($is.ProxyEnable -eq 1 -and $is.ProxyServer) { Add-F 'proxy' 'low' 'Proxy configuré' ('Votre trafic web passe par : ' + $is.ProxyServer + '. Normal en entreprise, suspect sinon.') $null $null }
  if ($is.AutoConfigURL) { Add-F 'proxy' 'low' 'Script de proxy automatique' ('Configuration chargée depuis : ' + $is.AutoConfigURL) $null $null }
} catch {}

# Empreintes SHA-256 (à vérifier sur un service comme VirusTotal)
$n = 0
foreach ($f in $found) {
  if ($f.path -and $f.severity -ne 'low' -and $n -lt 40 -and (Test-Path -LiteralPath $f.path -PathType Leaf)) {
    try { $f.sha256 = (Get-FileHash -LiteralPath $f.path -Algorithm SHA256).Hash; $n++ } catch {}
  }
}
Out-Json @($found)
`;

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const THREAT_SEVERITY = { 0: 'Inconnue', 1: 'Faible', 2: 'Modérée', 4: 'Élevée', 5: 'Grave' };

function ensureWindows(feature) {
  if (process.platform !== 'win32') throw new UnsupportedPlatformError(feature);
}

/** Décode le champ productState du Centre de sécurité Windows. */
function decodeProductState(state) {
  const hex = Number(state || 0).toString(16).padStart(6, '0');
  return {
    enabled: ['10', '11'].includes(hex.slice(2, 4)),
    upToDate: hex.slice(4, 6) === '00',
  };
}

async function getStatus() {
  if (process.platform !== 'win32') return { supported: false };
  const r = (await runPowerShell(STATUS_SCRIPT, { timeoutMs: 60_000 })) || {};
  const products = asArray(r.products).map((p) => ({ name: p.name, ...decodeProductState(p.state) }));
  const firewall = asArray(r.firewall);
  const defender = r.defender || { available: false };
  const signatureAgeDays = defender.signatureUpdated
    ? Math.floor((Date.now() - new Date(defender.signatureUpdated).getTime()) / 86_400_000)
    : null;
  return {
    supported: true,
    defender: { ...defender, signatureAgeDays },
    products,
    firewall,
    firewallAllEnabled: firewall.length > 0 && firewall.every((f) => f.enabled),
    uacEnabled: r.uac === null || r.uac === undefined ? null : r.uac === 1,
  };
}

async function updateSignatures() {
  ensureWindows('La mise à jour de Defender');
  await runPowerShell(UPDATE_SCRIPT, { timeoutMs: 10 * 60_000 });
  return { ok: true };
}

// ---- Analyses (une seule à la fois, exécutée en arrière-plan) ----

const scanState = { running: false, type: null, path: null, startedAt: null, finishedAt: null, error: null };
const SCAN_TIMEOUTS = { QuickScan: 60 * 60_000, FullScan: 8 * 60 * 60_000, CustomScan: 4 * 60 * 60_000 };

async function startScan({ type, path: scanPath }, onDone) {
  ensureWindows("L'analyse antivirus");
  if (!SCAN_TIMEOUTS[type]) throw new Error("Type d'analyse inconnu.");
  if (scanState.running) throw new Error('Une analyse est déjà en cours.');
  let target = null;
  if (type === 'CustomScan') {
    if (typeof scanPath !== 'string' || !path.isAbsolute(scanPath)) throw new Error('Chemin à analyser invalide.');
    await fs.stat(scanPath).catch(() => { throw new Error("Ce fichier ou dossier n'existe pas."); });
    target = path.resolve(scanPath);
  }
  Object.assign(scanState, { running: true, type, path: target, startedAt: Date.now(), finishedAt: null, error: null });

  runPowerShell(SCAN_SCRIPT, { args: { type, path: target }, timeoutMs: SCAN_TIMEOUTS[type] })
    .then(() => {})
    .catch((err) => { scanState.error = err.message; })
    .finally(() => {
      scanState.running = false;
      scanState.finishedAt = Date.now();
      if (typeof onDone === 'function') onDone(getScanState());
    });

  return getScanState();
}

function getScanState() {
  return { ...scanState };
}

async function getThreats() {
  if (process.platform !== 'win32') return { supported: false, threats: [] };
  const raw = asArray(await runPowerShell(THREATS_SCRIPT, { timeoutMs: 60_000 }));
  const threats = raw
    .map((t) => ({ ...t, resources: asArray(t.resources), severityLabel: THREAT_SEVERITY[t.severity] || 'Inconnue' }))
    .sort((a, b) => String(b.detected).localeCompare(String(a.detected)));
  return { supported: true, threats };
}

async function removeThreats() {
  ensureWindows('La suppression des menaces');
  await runPowerShell(REMOVE_SCRIPT, { timeoutMs: 10 * 60_000 });
  return { ok: true };
}

async function runAudit() {
  if (process.platform !== 'win32') return { supported: false, findings: [] };
  const raw = asArray(await runPowerShell(AUDIT_SCRIPT, { timeoutMs: 5 * 60_000 }));
  const findings = raw
    .filter((f) => f && SEVERITY_ORDER[f.severity] !== undefined)
    .map((f, i) => ({ id: i + 1, ...f }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { supported: true, findings, checkedAt: Date.now() };
}

module.exports = {
  getStatus,
  updateSignatures,
  startScan,
  getScanState,
  getThreats,
  removeThreats,
  runAudit,
  decodeProductState,
  // pour les tests (taille des scripts)
  SCRIPTS: { STATUS_SCRIPT, UPDATE_SCRIPT, SCAN_SCRIPT, THREATS_SCRIPT, REMOVE_SCRIPT, AUDIT_SCRIPT },
};
