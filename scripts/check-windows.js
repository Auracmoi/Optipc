'use strict';

/*
 * Contrôle sur un vrai Windows, en LECTURE SEULE : exécute chaque lecture
 * système d'OptiPC (mesures, scripts PowerShell) et vérifie la forme des
 * réponses. Rien n'est supprimé, désactivé ni modifié.
 *
 *   npm run check:windows            (de préférence dans un terminal administrateur)
 *
 * Code de sortie 0 si tout passe, 1 sinon. Utilisé aussi par l'intégration
 * continue GitHub Actions (machine Windows).
 */

const monitor = require('../src/main/lib/monitor');
const cleaner = require('../src/main/lib/cleaner');
const startup = require('../src/main/lib/startup');
const tweaks = require('../src/main/lib/tweaks');
const security = require('../src/main/lib/security');
const diagnostics = require('../src/main/lib/diagnostics');
const system = require('../src/main/lib/system');

if (process.platform !== 'win32') {
  console.error('Ce contrôle se lance sur Windows uniquement.');
  process.exit(2);
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

check('Droits administrateur (information)', async () => {
  const admin = await system.isAdmin();
  return admin ? 'oui' : 'non : certaines lectures seront limitées';
});

check('Configuration matérielle', async () => {
  const s = await monitor.getStaticInfo();
  must(s.cpu.name && s.memoryTotal > 0, 'processeur ou mémoire introuvable');
  return `${s.os.name} ${s.os.build} · ${s.cpu.name} · ${(s.memoryTotal / 1024 ** 3).toFixed(1)} Go`;
});

check('Mesures en direct', async () => {
  const l = await monitor.getLiveMetrics();
  must(l.cpu.load >= 0 && l.cpu.load <= 100, `charge processeur incohérente : ${l.cpu.load}`);
  must(l.disks.some((d) => /^c:?\\?$/i.test(d.mount)), 'disque C: introuvable');
  return `CPU ${l.cpu.load} %, RAM ${l.memory.percent} %, ${l.disks.length} disque(s)`;
});

check('Liste des processus', async () => {
  const p = await monitor.getProcesses();
  must(p.list.some((x) => /^explorer\.exe$|^svchost\.exe$/i.test(x.name)), 'processus Windows attendus absents');
  return `${p.list.length} processus`;
});

check('Nettoyage : mesure (aucune suppression)', async () => {
  const s = await cleaner.scan({ isAdmin: await system.isAdmin() });
  must(s.supported && s.categories.length >= 5, 'catégories manquantes');
  must(s.categories.every((c) => Number.isFinite(c.bytes) && c.bytes >= 0), 'taille invalide');
  return s.categories.map((c) => `${c.id}=${c.blocked ? 'admin requis' : `${(c.bytes / 1024 ** 2).toFixed(0)} Mo`}`).join(', ');
});

check('Programmes au démarrage (lecture)', async () => {
  const s = await startup.list();
  must(s.supported, 'non pris en charge');
  must(s.items.every((i) => i.id && i.name && typeof i.enabled === 'boolean'), 'entrée mal formée');
  return `${s.items.length} programme(s), ${s.items.filter((i) => i.enabled).length} actif(s)`;
});

check("Réglages et mode d'alimentation (lecture)", async () => {
  const t = await tweaks.list();
  must(t.supported && t.tweaks.length === 5, `5 réglages attendus, ${t.tweaks.length} reçus`);
  const p = await tweaks.getPowerScheme();
  must(p && /^[0-9a-f-]{36}$/.test(p.guid), "mode d'alimentation illisible");
  return `mode actuel : ${p.name}`;
});

check('Sécurité : état de la protection', async () => {
  const s = await security.getStatus();
  must(s.supported, 'non pris en charge');
  const d = s.defender;
  return d.available
    ? `Defender ${d.antivirusEnabled ? 'actif' : 'inactif'}, définitions de ${d.signatureAgeDays ?? '?'} j, pare-feu ${s.firewallAllEnabled ? 'actif' : 'incomplet'}`
    : `Defender indisponible (${d.error || 'raison inconnue'}), ${s.products.length} antivirus déclaré(s)`;
});

check('Sécurité : historique des menaces', async () => {
  const t = await security.getThreats();
  must(t.supported, 'non pris en charge');
  return `${t.threats.length} menace(s) connue(s)`;
});

check('Sécurité : analyse avancée (lecture seule)', async () => {
  const a = await security.runAudit();
  must(a.supported, 'non pris en charge');
  must(a.findings.every((f) => ['high', 'medium', 'low'].includes(f.severity) && f.title), 'résultat mal formé');
  return `${a.findings.length} élément(s) signalé(s)`;
});

check('Diagnostic complet', async () => {
  const d = await diagnostics.run({ isAdmin: await system.isAdmin() });
  must(d.score >= 0 && d.score <= 100, `score invalide : ${d.score}`);
  return `score ${d.score}/100, ${d.issues.length} problème(s)`;
});

(async () => {
  let failed = 0;
  for (const { name, fn } of checks) {
    const t0 = Date.now();
    try {
      const detail = await fn();
      console.log(`OK     ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s) : ${detail}`);
    } catch (err) {
      failed += 1;
      console.log(`ÉCHEC  ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s) : ${err.message}`);
    }
  }
  console.log(failed ? `\n${failed} contrôle(s) en échec sur ${checks.length}.` : `\nLes ${checks.length} contrôles sont passés.`);
  process.exit(failed ? 1 : 0);
})();
