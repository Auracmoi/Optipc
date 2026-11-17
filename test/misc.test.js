'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const monitor = require('../src/main/lib/monitor');
const { parseActiveScheme } = require('../src/main/lib/tweaks');
const { decodeProductState } = require('../src/main/lib/security');

test('killProcess refuse les cas dangereux ou incohérents', () => {
  monitor._setSnapshot([[1234, 'notepad.exe'], [600, 'lsass.exe'], [700, 'OptiPC.exe']]);
  assert.throws(() => monitor.killProcess(0, 'x'), /invalide/);
  assert.throws(() => monitor.killProcess(4, 'System'), /invalide/);
  assert.throws(() => monitor.killProcess('1234', 'notepad.exe'), /invalide/);
  assert.throws(() => monitor.killProcess(1.5, 'notepad.exe'), /invalide/);
  assert.throws(() => monitor.killProcess(700, 'OptiPC.exe', { selfPids: [700] }), /lui-même/);
  assert.throws(() => monitor.killProcess(1234, 'chrome.exe'), /changé/);
  assert.throws(() => monitor.killProcess(9999, 'notepad.exe'), /changé/);
  assert.throws(() => monitor.killProcess(600, 'lsass.exe'), /essentiel/);
});

test('isProtected reconnaît les processus système (insensible à la casse)', () => {
  assert.equal(monitor.isProtected('CSRSS.EXE'), true);
  assert.equal(monitor.isProtected('svchost.exe'), true);
  assert.equal(monitor.isProtected('chrome.exe'), false);
});

test('parseActiveScheme lit la sortie de powercfg en français et en anglais', () => {
  assert.deepEqual(
    parseActiveScheme("GUID du mode de gestion de l'alimentation : 381b4222-f694-41f0-9685-ff5bb260df2e  (Utilisation normale)"),
    { guid: '381b4222-f694-41f0-9685-ff5bb260df2e', name: 'Utilisation normale' },
  );
  assert.deepEqual(
    parseActiveScheme('Power Scheme GUID: 8C5E7FDA-E8BF-4A96-9A85-A6E23A8C635C  (High performance)'),
    { guid: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', name: 'High performance' },
  );
  assert.equal(parseActiveScheme(''), null);
  assert.equal(parseActiveScheme(null), null);
});

test('decodeProductState interprète le Centre de sécurité Windows', () => {
  assert.deepEqual(decodeProductState(397568), { enabled: true, upToDate: true }); // 0x061100 Defender actif
  assert.deepEqual(decodeProductState(393472), { enabled: false, upToDate: true }); // 0x060100 désactivé
  assert.deepEqual(decodeProductState(397584), { enabled: true, upToDate: false }); // 0x061110 obsolète
  assert.deepEqual(decodeProductState(266240), { enabled: true, upToDate: true }); // 0x041000 antivirus tiers
});

test('les mesures en direct fonctionnent sur la machine courante', async () => {
  const live = await monitor.getLiveMetrics();
  assert.ok(live.cpu.load >= 0 && live.cpu.load <= 100);
  assert.ok(live.memory.total > 0);
  assert.ok(live.memory.percent > 0 && live.memory.percent <= 100);
  const procs = await monitor.getProcesses();
  assert.ok(procs.list.length > 0);
  assert.ok(procs.list.every((p) => Number.isInteger(p.pid) && typeof p.name === 'string'));
});
