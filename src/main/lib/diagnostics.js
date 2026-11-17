'use strict';

const si = require('systeminformation');
const monitor = require('./monitor');
const cleaner = require('./cleaner');
const startup = require('./startup');
const tweaks = require('./tweaks');
const security = require('./security');

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const WEIGHTS = { critical: 20, warning: 8, info: 2 };
const ORDER = { critical: 0, warning: 1, info: 2 };

function fmtGB(bytes) {
  return `${(bytes / GB).toFixed(1).replace('.', ',')} Go`;
}

function fmtSize(bytes) {
  return bytes >= GB ? fmtGB(bytes) : `${Math.round(bytes / MB)} Mo`;
}

/**
 * Analyse pure (sans accès système) : transforme les mesures en problèmes
 * classés par gravité, avec l'action recommandée. Testée unitairement.
 */
function analyze(f) {
  const issues = [];
  const add = (severity, id, title, detail, action = null) => issues.push({ severity, id, title, detail, action });
  const top = (list) => (list || []).slice(0, 3).map((p) => p.name).join(', ');

  // --- Processeur ---
  if (typeof f.cpuLoad === 'number') {
    if (f.cpuLoad >= 85) add('critical', 'cpu-high', `Processeur saturé (${Math.round(f.cpuLoad)} %)`, `Programmes les plus gourmands : ${top(f.topCpu) || 'inconnus'}.`, { page: 'monitor', label: 'Voir les processus' });
    else if (f.cpuLoad >= 60) add('warning', 'cpu-busy', `Processeur très sollicité (${Math.round(f.cpuLoad)} %)`, `Programmes les plus gourmands : ${top(f.topCpu) || 'inconnus'}.`, { page: 'monitor', label: 'Voir les processus' });
  }
  if (typeof f.cpuTemp === 'number') {
    if (f.cpuTemp >= 90) add('critical', 'cpu-temp', `Processeur en surchauffe (${Math.round(f.cpuTemp)} °C)`, 'Le processeur ralentit pour se protéger. Nettoyez les ventilateurs et vérifiez l\'aération.');
    else if (f.cpuTemp >= 80) add('warning', 'cpu-warm', `Processeur chaud (${Math.round(f.cpuTemp)} °C)`, 'Vérifiez que les aérations ne sont pas obstruées.');
  }

  // --- Mémoire ---
  if (typeof f.memPercent === 'number') {
    if (f.memPercent >= 90) add('critical', 'ram-full', `Mémoire presque pleine (${Math.round(f.memPercent)} %)`, `Windows utilise le disque comme mémoire, ce qui ralentit tout. Gros consommateurs : ${top(f.topMem) || 'inconnus'}.`, { page: 'monitor', label: 'Libérer de la mémoire' });
    else if (f.memPercent >= 80) add('warning', 'ram-high', `Mémoire très utilisée (${Math.round(f.memPercent)} %)`, `Gros consommateurs : ${top(f.topMem) || 'inconnus'}.`, { page: 'monitor', label: 'Voir les processus' });
  }
  if (f.memTotal && f.memTotal < 7.5 * GB) {
    add('info', 'ram-small', `Peu de mémoire installée (${fmtGB(f.memTotal)})`, '8 Go est le minimum confortable pour Windows 10/11 ; 16 Go pour le jeu ou le multitâche.');
  }

  // --- Disques ---
  for (const d of f.disks || []) {
    const freePct = d.size ? (d.free / d.size) * 100 : 100;
    const isSystem = /^c:?\\?$/i.test(d.mount) || d.mount === '/';
    if (freePct < 10) add(isSystem ? 'critical' : 'warning', `disk-full-${d.mount}`, `Disque ${d.mount} presque plein (${fmtGB(d.free)} libres)`, isSystem ? 'Windows a besoin d\'au moins 10 à 15 % d\'espace libre pour fonctionner correctement.' : 'Libérez de l\'espace sur ce disque.', { page: 'cleaner', label: 'Nettoyer' });
    else if (freePct < 20 && isSystem) add('warning', `disk-low-${d.mount}`, `Espace limité sur ${d.mount} (${fmtGB(d.free)} libres)`, 'Pensez à faire du ménage avant que le disque ne soit plein.', { page: 'cleaner', label: 'Nettoyer' });
  }
  if ((f.diskTypes || []).some((t) => /^(HD|HDD)$/i.test(t))) {
    add('info', 'hdd', 'Disque dur mécanique détecté', 'Remplacer le disque système par un SSD est l\'amélioration la plus efficace : démarrage et ouverture des programmes 3 à 5 fois plus rapides.');
  }
  if (typeof f.cleanableBytes === 'number') {
    if (f.cleanableBytes >= GB) add('warning', 'junk', `${fmtSize(f.cleanableBytes)} de fichiers inutiles`, 'Fichiers temporaires, caches et corbeille peuvent être supprimés sans risque.', { page: 'cleaner', label: 'Nettoyer' });
    else if (f.cleanableBytes >= 200 * MB) add('info', 'junk', `${fmtSize(f.cleanableBytes)} de fichiers inutiles`, 'Un nettoyage libérera de l\'espace.', { page: 'cleaner', label: 'Nettoyer' });
  }

  // --- Démarrage / système ---
  if (typeof f.startupCount === 'number') {
    if (f.startupCount > 10) add('warning', 'startup-many', `${f.startupCount} programmes se lancent au démarrage`, 'Ils ralentissent l\'ouverture de session et occupent la mémoire en permanence.', { page: 'startup', label: 'Gérer le démarrage' });
    else if (f.startupCount > 5) add('info', 'startup-some', `${f.startupCount} programmes se lancent au démarrage`, 'Désactivez ceux dont vous n\'avez pas besoin dès l\'allumage.', { page: 'startup', label: 'Gérer le démarrage' });
  }
  if (typeof f.uptimeDays === 'number' && f.uptimeDays >= 7) {
    add('warning', 'uptime', `PC allumé depuis ${Math.floor(f.uptimeDays)} jours sans redémarrage`, 'Un redémarrage libère la mémoire et termine l\'installation des mises à jour. (« Arrêter » ne suffit pas si le démarrage rapide est actif.)');
  }
  if (f.powerScheme && !f.powerScheme.isHighPerformance) {
    add('info', 'power', `Mode d'alimentation : ${f.powerScheme.name}`, 'Le mode « Performances élevées » maintient le processeur à pleine vitesse (PC fixe recommandé).', { page: 'tweaks', label: 'Optimiser' });
  }

  // --- Sécurité ---
  const s = f.security;
  if (s && s.supported) {
    const def = s.defender || {};
    const otherAv = (s.products || []).some((p) => p.enabled && !/^(windows|microsoft) defender/i.test(p.name));
    const defenderActive = def.available && def.antivirusEnabled;
    if (!defenderActive && !otherAv) {
      add('critical', 'no-av', 'Aucun antivirus actif', 'Votre PC n\'est pas protégé. Réactivez Microsoft Defender.', { page: 'security', label: 'Sécurité' });
    } else if (defenderActive) {
      if (!def.realTime) add('critical', 'realtime-off', 'Protection en temps réel désactivée', 'Les fichiers ne sont plus analysés à leur ouverture.', { page: 'security', label: 'Sécurité' });
      if (typeof def.signatureAgeDays === 'number' && def.signatureAgeDays > 3) add('warning', 'signatures-old', `Définitions antivirus vieilles de ${def.signatureAgeDays} jours`, 'Les nouveaux virus ne sont pas reconnus.', { page: 'security', label: 'Mettre à jour' });
      const lastScan = [def.quickScanEnd, def.fullScanEnd].filter(Boolean).map((d) => new Date(d).getTime()).sort((a, b) => b - a)[0];
      if (!lastScan || f.now - lastScan > 14 * 86_400_000) add('info', 'scan-old', 'Aucune analyse antivirus depuis plus de 14 jours', 'Lancez une analyse rapide.', { page: 'security', label: 'Analyser' });
    }
    if (s.firewall && s.firewall.length && !s.firewallAllEnabled) add('critical', 'firewall-off', 'Pare-feu Windows désactivé', 'Au moins un profil réseau n\'est pas protégé par le pare-feu.', { page: 'security', label: 'Sécurité' });
    if (s.uacEnabled === false) add('warning', 'uac-off', 'Contrôle de compte d\'utilisateur (UAC) désactivé', 'Les programmes peuvent modifier le système sans votre accord.');
  }
  if (typeof f.activeThreats === 'number' && f.activeThreats > 0) {
    add('critical', 'threats', `${f.activeThreats} menace(s) active(s) détectée(s)`, 'Microsoft Defender a détecté des logiciels malveillants non supprimés.', { page: 'security', label: 'Traiter' });
  }

  issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const penalty = issues.reduce((sum, i) => sum + WEIGHTS[i.severity], 0);
  return { score: Math.max(0, 100 - penalty), issues };
}

async function safe(promise, fallback = null) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/** Collecte les mesures réelles puis lance l'analyse. */
async function run({ isAdmin }) {
  const isWin = process.platform === 'win32';

  // Charge processeur moyenne sur ~3 secondes (une mesure isolée peut être un pic).
  const loads = [];
  for (let i = 0; i < 4; i++) {
    const l = await safe(si.currentLoad());
    if (l) loads.push(l.currentLoad);
    if (i < 3) await new Promise((r) => setTimeout(r, 1000));
  }

  const [live, info, procs, startupList, power, sec, threats, junk] = await Promise.all([
    safe(monitor.getLiveMetrics()),
    safe(monitor.getStaticInfo()),
    safe(monitor.getProcesses()),
    isWin ? safe(startup.list()) : null,
    isWin ? safe(tweaks.getPowerScheme()) : null,
    isWin ? safe(security.getStatus()) : null,
    isWin ? safe(security.getThreats()) : null,
    isWin ? safe(cleaner.scan({ isAdmin })) : null,
  ]);

  const list = procs?.list || [];
  const facts = {
    now: Date.now(),
    cpuLoad: loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : null,
    cpuTemp: live?.cpu.temperature ?? null,
    memPercent: live?.memory.percent ?? null,
    memTotal: live?.memory.total ?? null,
    disks: live?.disks || [],
    diskTypes: (info?.disks || []).map((d) => d.type),
    uptimeDays: info ? info.uptimeSeconds / 86_400 : null,
    topCpu: [...list].sort((a, b) => b.cpu - a.cpu).filter((p) => p.cpu > 1),
    topMem: [...list].sort((a, b) => b.memBytes - a.memBytes),
    startupCount: startupList ? startupList.items.filter((i) => i.enabled).length : null,
    powerScheme: power,
    security: sec,
    activeThreats: threats ? threats.threats.filter((t) => t.active).length : null,
    cleanableBytes: junk?.supported ? junk.categories.reduce((s, c) => s + c.bytes, 0) : null,
  };

  return { ...analyze(facts), checkedAt: facts.now, partial: !isWin };
}

module.exports = { analyze, run };
