'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../src/main/lib/diagnostics');

const GB = 1024 ** 3;
const NOW = Date.UTC(2026, 10, 17);

function healthy(overrides = {}) {
  return {
    now: NOW,
    cpuLoad: 12,
    cpuTemp: 55,
    memPercent: 45,
    memTotal: 16 * GB,
    disks: [{ mount: 'C:', size: 500 * GB, free: 250 * GB }],
    diskTypes: ['SSD'],
    uptimeDays: 1,
    topCpu: [],
    topMem: [],
    startupCount: 3,
    powerScheme: { name: 'Performances élevées', isHighPerformance: true },
    security: {
      supported: true,
      defender: { available: true, antivirusEnabled: true, realTime: true, signatureAgeDays: 0, quickScanEnd: new Date(NOW - 86_400_000).toISOString() },
      products: [{ name: 'Windows Defender', enabled: true, upToDate: true }],
      firewall: [{ name: 'Domain', enabled: true }],
      firewallAllEnabled: true,
      uacEnabled: true,
    },
    activeThreats: 0,
    cleanableBytes: 10 * 1024 ** 2,
    ...overrides,
  };
}

const ids = (r) => r.issues.map((i) => i.id);

test('un PC sain obtient 100 sans aucun problème', () => {
  const r = analyze(healthy());
  assert.equal(r.score, 100);
  assert.deepEqual(r.issues, []);
});

test('détecte processeur saturé, mémoire pleine et surchauffe', () => {
  const r = analyze(healthy({ cpuLoad: 95, memPercent: 93, cpuTemp: 96, topCpu: [{ name: 'jeu.exe' }] }));
  assert.ok(ids(r).includes('cpu-high'));
  assert.ok(ids(r).includes('ram-full'));
  assert.ok(ids(r).includes('cpu-temp'));
  assert.match(r.issues.find((i) => i.id === 'cpu-high').detail, /jeu\.exe/);
  assert.equal(r.score, 40);
});

test('seuils intermédiaires = avertissements', () => {
  const r = analyze(healthy({ cpuLoad: 70, memPercent: 82, cpuTemp: 85 }));
  assert.deepEqual(ids(r).sort(), ['cpu-busy', 'cpu-warm', 'ram-high']);
  assert.ok(r.issues.every((i) => i.severity === 'warning'));
});

test('disque système presque plein = critique, autre disque = avertissement', () => {
  const r = analyze(healthy({ disks: [{ mount: 'C:', size: 100 * GB, free: 5 * GB }, { mount: 'D:', size: 100 * GB, free: 5 * GB }] }));
  assert.equal(r.issues.find((i) => i.id === 'disk-full-C:').severity, 'critical');
  assert.equal(r.issues.find((i) => i.id === 'disk-full-D:').severity, 'warning');
  assert.equal(r.issues.find((i) => i.id === 'disk-full-C:').action.page, 'cleaner');
});

test('conseils : HDD, peu de RAM, mode d\'alimentation, démarrage, redémarrage, fichiers inutiles', () => {
  const r = analyze(healthy({
    diskTypes: ['HD'],
    memTotal: 4 * GB,
    powerScheme: { name: 'Utilisation normale', isHighPerformance: false },
    startupCount: 14,
    uptimeDays: 12,
    cleanableBytes: 3 * GB,
  }));
  for (const id of ['hdd', 'ram-small', 'power', 'startup-many', 'uptime', 'junk']) assert.ok(ids(r).includes(id), id);
  assert.equal(r.issues.find((i) => i.id === 'junk').severity, 'warning');
});

test('sécurité : aucun antivirus, pare-feu coupé, UAC désactivé, menaces actives', () => {
  const r = analyze(healthy({
    security: { supported: true, defender: { available: true, antivirusEnabled: false }, products: [], firewall: [{ name: 'Public', enabled: false }], firewallAllEnabled: false, uacEnabled: false },
    activeThreats: 2,
  }));
  for (const id of ['no-av', 'firewall-off', 'uac-off', 'threats']) assert.ok(ids(r).includes(id), id);
  assert.equal(r.issues[0].severity, 'critical', 'les problèmes critiques sont en tête');
});

test('un autre antivirus actif évite l\'alerte « aucun antivirus »', () => {
  const r = analyze(healthy({
    security: { ...healthy().security, defender: { available: true, antivirusEnabled: false }, products: [{ name: 'Bitdefender', enabled: true }] },
  }));
  assert.ok(!ids(r).includes('no-av'));
});

test('Defender : temps réel coupé, définitions anciennes, pas d\'analyse récente', () => {
  const r = analyze(healthy({
    security: { ...healthy().security, defender: { available: true, antivirusEnabled: true, realTime: false, signatureAgeDays: 9 } },
  }));
  for (const id of ['realtime-off', 'signatures-old', 'scan-old']) assert.ok(ids(r).includes(id), id);
});

test('le score ne descend jamais sous 0 et les données manquantes sont tolérées', () => {
  const r = analyze({ now: NOW, cpuLoad: 99, memPercent: 99, cpuTemp: 99, activeThreats: 3, disks: [{ mount: 'C:', size: 10, free: 0 }], security: { supported: true, defender: {}, products: [], firewall: [{ name: 'x', enabled: false }], firewallAllEnabled: false, uacEnabled: false } });
  assert.equal(r.score, 0);
  assert.doesNotThrow(() => analyze({ now: NOW }));
  assert.equal(analyze({ now: NOW }).score, 100);
});
