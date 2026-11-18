// Fausse API Windows pour tester l'interface dans Chromium (tests de bout en bout).
// Simule un PC Windows 11 sans droits administrateur, avec des problèmes à détecter.
(() => {
  const GB = 1024 ** 3, MB = 1024 ** 2;
  const ok = (data, ms = 150) => new Promise((r) => setTimeout(() => r({ ok: true, data }), ms));
  const fail = (error, ms = 150) => new Promise((r) => setTimeout(() => r({ ok: false, error }), ms));
  const days = (n) => new Date(Date.now() - n * 86400000).toISOString();
  let t = 0;
  const procs = [
    ['chrome.exe', 12.3, 410], ['chrome.exe', 4.1, 220], ['chrome.exe', 0.5, 120], ['Teams.exe', 8.2, 610],
    ['svchost.exe', 1.1, 40], ['MsMpEng.exe', 3.3, 280], ['explorer.exe', 0.8, 150], ['Spotify.exe', 2.2, 300],
    ['<script>alert(1)</script>.exe', 0.1, 5], ['OneDrive.exe', 0.3, 90], ['dwm.exe', 2.5, 110],
  ].map(([name, cpu, mem], i) => ({ pid: 1000 + i * 4, name, cpu, memPercent: mem / 160, memBytes: mem * MB, path: `C:\\Program Files\\${name}`, protected: /svchost|MsMpEng|dwm/.test(name) }));
  const startupItems = [
    { id: 'HKCU_RUN|Spotify', name: 'Spotify', rawName: 'Spotify', command: '"C:\\Users\\Ana\\AppData\\Roaming\\Spotify\\Spotify.exe" /minimized', publisher: 'Spotify AB', source: 'HKCU_RUN', location: 'Registre (utilisateur)', requiresAdmin: false, enabled: true },
    { id: 'HKCU_RUN|Teams', name: 'Microsoft Teams', rawName: 'Teams', command: 'C:\\Users\\Ana\\AppData\\Local\\Microsoft\\Teams\\Update.exe --processStart "Teams.exe"', publisher: 'Microsoft Corporation', source: 'HKCU_RUN', location: 'Registre (utilisateur)', requiresAdmin: false, enabled: true },
    { id: 'HKLM_RUN|SecurityHealth', name: 'SecurityHealth', rawName: 'SecurityHealth', command: '%windir%\\system32\\SecurityHealthSystray.exe', publisher: 'Microsoft Corporation', source: 'HKLM_RUN', location: 'Registre (tous les utilisateurs)', requiresAdmin: true, enabled: true },
    { id: 'USER_FOLDER|Discord.lnk', name: 'Discord', rawName: 'Discord.lnk', command: 'C:\\Users\\Ana\\AppData\\Local\\Discord\\Update.exe', publisher: null, source: 'USER_FOLDER', location: 'Dossier Démarrage (utilisateur)', requiresAdmin: false, enabled: false },
  ];
  const tweaks = [
    { id: 'power-plan', title: 'Mode d\'alimentation « Performances élevées »', description: 'Le processeur reste à sa fréquence maximale. Mode actuel : Utilisation normale.', impact: 'Élevé', needsRelogin: false, applied: false, canRevert: false },
    { id: 'transparency', title: 'Désactiver la transparence', description: 'Supprime les effets de transparence.', impact: 'Moyen', needsRelogin: false, applied: true, canRevert: true },
    { id: 'animations', title: 'Réduire les animations des fenêtres', description: 'Désactive l\'animation.', impact: 'Moyen', needsRelogin: true, applied: false, canRevert: false },
    { id: 'game-mode', title: 'Activer le mode Jeu', description: 'Priorité au jeu.', impact: 'Élevé (jeux)', needsRelogin: false, applied: true, canRevert: false },
  ];
  let scan = { running: false, type: null, startedAt: null, finishedAt: null, error: null };
  let scanCb = null;
  let readOnly = false;
  const WRITES = new Set(['kill', 'clean', 'toggle', 'apply', 'revert', 'restorePoint', 'removeThreats']);
  const refuse = () => fail('Mode lecture seule activé : aucune modification du PC n\'est possible.');
  window.__calls = []; // journal des appels d'écriture, lu par les tests
  const api = {
    config: {
      get: () => ok({ readOnly }, 10),
      setReadOnly: (v) => { readOnly = v; return ok({ readOnly }, 10); },
    },
    appInfo: () => ok({ platform: 'win32', isWindows: true, isAdmin: false, hostname: 'PC-SALON' }, 10),
    monitor: {
      staticInfo: () => ok({ cpu: { name: 'Intel Core i5-10400F', cores: 6, threads: 12, speedGHz: 2.9 }, os: { name: 'Microsoft Windows 11 Famille', release: '10.0.22631', build: '22631', arch: 'x64' }, memoryTotal: 16 * GB, disks: [{ name: 'Samsung SSD 970 EVO', type: 'NVMe', size: 500 * GB }, { name: 'ST1000DM010', type: 'HD', size: 1000 * GB }], gpus: [{ model: 'NVIDIA GeForce GTX 1660' }], uptimeSeconds: 9 * 86400 + 3600 * 4 }),
      live: () => { t++; const load = 30 + 25 * Math.sin(t / 3) + Math.random() * 10; return ok({ timestamp: Date.now(), cpu: { load, perCore: Array.from({ length: 12 }, (_, i) => Math.max(0, Math.min(100, load + 20 * Math.sin(i + t)))), temperature: 67 }, memory: { total: 16 * GB, used: 13.4 * GB, percent: 83.8 }, disks: [{ mount: 'C:', type: 'NTFS', size: 475 * GB, used: 440 * GB, free: 35 * GB, percent: 92.6 }, { mount: 'D:', type: 'NTFS', size: 931 * GB, used: 300 * GB, free: 631 * GB, percent: 32 }], network: { rxPerSec: 1.2 * MB * Math.random(), txPerSec: 80000 } }, 30); },
      processes: () => ok({ total: 214, list: procs }),
      kill: (pid, name) => (/Teams/.test(name) ? ok({ ok: true }) : fail('Droits insuffisants pour fermer ce processus (relancez en administrateur).')),
    },
    cleaner: {
      scan: () => ok({ supported: true, categories: [
        { id: 'user-temp', label: 'Fichiers temporaires utilisateur', description: 'Fichiers laissés par les programmes et installateurs (plus de 24 h).', requiresAdmin: false, bytes: 2.4 * GB, files: 18342, blocked: false },
        { id: 'windows-temp', label: 'Fichiers temporaires Windows', description: 'Dossier Temp du système (plus de 24 h).', requiresAdmin: true, bytes: 0, files: 0, blocked: true },
        { id: 'browser-cache', label: 'Cache des navigateurs', description: 'Chrome, Edge, Brave et Firefox.', requiresAdmin: false, bytes: 830 * MB, files: 5210, blocked: false },
        { id: 'thumbnails', label: 'Cache des miniatures', description: 'Aperçus d\'images.', requiresAdmin: false, bytes: 120 * MB, files: 9, blocked: false },
        { id: 'crash-dumps', label: 'Rapports de plantage', description: 'Vidages mémoire.', requiresAdmin: true, bytes: 0, files: 0, blocked: true },
        { id: 'recycle-bin', label: 'Corbeille', description: 'Fichiers supprimés en attente.', requiresAdmin: false, bytes: 1.1 * GB, files: 40, blocked: false },
      ] }, 600),
      clean: (ids) => ok({ report: [], totals: { freed: 3.2 * GB, deleted: 23500, failed: 37 } }, 800),
    },
    startup: {
      list: () => ok({ supported: true, items: startupItems }),
      toggle: (id, en) => { const i = startupItems.find((x) => x.id === id); i.enabled = en; return ok({ ok: true }); },
    },
    tweaks: {
      list: () => ok({ supported: true, tweaks }),
      apply: (id) => { tweaks.find((x) => x.id === id).applied = true; tweaks.find((x) => x.id === id).canRevert = true; return ok({ ok: true, needsRelogin: id === 'animations' }); },
      revert: (id) => { tweaks.find((x) => x.id === id).applied = false; tweaks.find((x) => x.id === id).canRevert = false; return ok({ ok: true }); },
      restorePoint: () => fail("Point de restauration impossible : Accès refusé. Vérifiez que l'optimiseur est lancé en administrateur et que la Protection du système est activée sur le disque C:."),
    },
    security: {
      status: () => ok({ supported: true, defender: { available: true, serviceEnabled: true, antivirusEnabled: true, realTime: true, tamperProtected: true, signatureVersion: '1.421.1234.0', signatureUpdated: days(5), signatureAgeDays: 5, quickScanEnd: days(20), fullScanEnd: null }, products: [{ name: 'Windows Defender', enabled: true, upToDate: true }], firewall: [{ name: 'Domain', enabled: true }, { name: 'Private', enabled: true }, { name: 'Public', enabled: true }], firewallAllEnabled: true, uacEnabled: true }),
      update: () => ok({ ok: true }, 600),
      scan: ({ type }) => { scan = { running: true, type, path: null, startedAt: Date.now(), finishedAt: null, error: null }; setTimeout(() => { scan = { ...scan, running: false, finishedAt: Date.now() }; scanCb && scanCb(scan); }, 2500); return ok(scan); },
      scanState: () => ok(scan, 10),
      threats: () => ok({ supported: true, threats: [{ id: '2147735505', name: 'Trojan:Win32/Wacatac.B!ml', severity: 5, severityLabel: 'Grave', active: false, actionSuccess: true, resources: ['file:_C:\\Users\\Ana\\Downloads\\crack_setup.exe'], detected: days(3) }] }),
      removeThreats: () => ok({ ok: true }),
      audit: () => ok({ supported: true, checkedAt: Date.now(), findings: [
        { id: 1, kind: 'task', severity: 'high', title: 'Tâche planifiée avec commande obfusquée : UpdaterSvc', detail: 'powershell.exe -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoA', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', pid: null, sha256: 'DE96A6E69944335375DC1AC238336066889D9FFC7D73628EF4FE1B1B160AB32C' },
        { id: 2, kind: 'process', severity: 'high', title: 'Processus non signé : svch0st.exe', detail: 'Signature : NotSigned. Programme lancé hors des dossiers système.', path: 'C:\\Users\\Ana\\AppData\\Local\\Temp\\svch0st.exe', pid: 4432, sha256: '0F3A3D1E5B2C4A9F8E7D6C5B4A39281706F5E4D3C2B1A09F8E7D6C5B4A392817' },
        { id: 3, kind: 'hosts', severity: 'medium', title: 'Fichier hosts modifié (2 redirection(s))', detail: '0.0.0.0 update.microsoft.com | 0.0.0.0 go.microsoft.com', path: 'C:\\Windows\\System32\\drivers\\etc\\hosts', pid: null },
        { id: 4, kind: 'proxy', severity: 'low', title: 'Proxy configuré', detail: 'Votre trafic web passe par : 127.0.0.1:8888.', path: null, pid: null },
      ] }, 1200),
      onScanFinished: (cb) => { scanCb = cb; return () => { scanCb = null; }; },
    },
    diagnostics: {
      run: () => ok({ score: 46, checkedAt: Date.now(), partial: false, issues: [
        { severity: 'critical', id: 'disk-full-C:', title: 'Disque C: presque plein (35,0 Go libres)', detail: "Windows a besoin d'au moins 10 à 15 % d'espace libre pour fonctionner correctement.", action: { page: 'cleaner', label: 'Nettoyer' } },
        { severity: 'warning', id: 'ram-high', title: 'Mémoire très utilisée (84 %)', detail: 'Gros consommateurs : Teams.exe, chrome.exe, Spotify.exe.', action: { page: 'monitor', label: 'Voir les processus' } },
        { severity: 'warning', id: 'uptime', title: 'PC allumé depuis 9 jours sans redémarrage', detail: 'Un redémarrage libère la mémoire et termine l\'installation des mises à jour.', action: null },
        { severity: 'warning', id: 'signatures-old', title: 'Définitions antivirus vieilles de 5 jours', detail: 'Les nouveaux virus ne sont pas reconnus.', action: { page: 'security', label: 'Mettre à jour' } },
        { severity: 'warning', id: 'junk', title: '4,4 Go de fichiers inutiles', detail: 'Fichiers temporaires, caches et corbeille peuvent être supprimés sans risque.', action: { page: 'cleaner', label: 'Nettoyer' } },
        { severity: 'info', id: 'hdd', title: 'Disque dur mécanique détecté', detail: 'Remplacer le disque système par un SSD…', action: null },
        { severity: 'info', id: 'power', title: "Mode d'alimentation : Utilisation normale", detail: 'Le mode « Performances élevées »…', action: { page: 'tweaks', label: 'Optimiser' } },
      ] }, 1500),
    },
    util: { showItem: () => ok(true), choosePath: () => ok(null), copy: () => ok(true) },
  };
  // Même verrou que le processus principal : en lecture seule, les écritures sont refusées.
  for (const group of Object.values(api)) {
    if (typeof group !== 'object') continue;
    for (const [name, fn] of Object.entries(group)) {
      if (!WRITES.has(name)) continue;
      group[name] = (...args) => { window.__calls.push(name); return readOnly ? refuse() : fn(...args); };
    }
  }
  window.api = api;
})();
