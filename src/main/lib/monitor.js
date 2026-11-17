'use strict';

const si = require('systeminformation');

// Processus dont l'arrêt planterait ou déstabiliserait Windows : on refuse de les terminer.
const PROTECTED_PROCESSES = new Set([
  'system', 'system idle process', 'idle', 'registry', 'secure system', 'memory compression',
  'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'lsaiso.exe',
  'svchost.exe', 'dwm.exe', 'fontdrvhost.exe', 'sihost.exe', 'ctfmon.exe', 'audiodg.exe',
  'msmpeng.exe', 'nissrv.exe', 'securityhealthservice.exe', 'wudfhost.exe', 'spoolsv.exe',
  // Linux / macOS (utile en développement)
  'systemd', 'init', 'kernel_task', 'launchd', 'windowserver',
]);

let lastProcessSnapshot = new Map(); // pid -> nom

async function getStaticInfo() {
  const [cpu, osInfo, mem, disks, graphics, time] = await Promise.all([
    si.cpu(),
    si.osInfo(),
    si.mem(),
    si.diskLayout().catch(() => []),
    si.graphics().catch(() => ({ controllers: [] })),
    Promise.resolve(si.time()),
  ]);
  return {
    cpu: {
      name: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      cores: cpu.physicalCores,
      threads: cpu.cores,
      speedGHz: cpu.speed,
    },
    os: {
      name: osInfo.distro,
      release: osInfo.release,
      build: osInfo.build,
      arch: osInfo.arch,
    },
    memoryTotal: mem.total,
    disks: disks.map((d) => ({
      name: d.name,
      type: d.type, // 'SSD', 'HD', 'NVMe'…
      interfaceType: d.interfaceType,
      size: d.size,
    })),
    gpus: (graphics.controllers || []).map((g) => ({ model: g.model, vramMB: g.vram })),
    uptimeSeconds: time.uptime,
  };
}

async function getLiveMetrics() {
  const [load, mem, fs, net, temp] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize().catch(() => []),
    si.networkStats('*').catch(() => []),
    si.cpuTemperature().catch(() => ({ main: null })),
  ]);

  // Sous Windows, « active » correspond à la mémoire réellement utilisée.
  const memUsed = mem.active || mem.used;
  const rx = net.reduce((s, n) => s + (n.rx_sec > 0 ? n.rx_sec : 0), 0);
  const tx = net.reduce((s, n) => s + (n.tx_sec > 0 ? n.tx_sec : 0), 0);

  return {
    timestamp: Date.now(),
    cpu: {
      load: round1(load.currentLoad),
      perCore: (load.cpus || []).map((c) => round1(c.load)),
      temperature: typeof temp.main === 'number' && temp.main > 0 ? round1(temp.main) : null,
    },
    memory: {
      total: mem.total,
      used: memUsed,
      percent: mem.total ? round1((memUsed / mem.total) * 100) : 0,
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
    },
    disks: fs
      .filter((d) => d.size > 0)
      .map((d) => ({
        mount: d.mount,
        fs: d.fs,
        type: d.type,
        size: d.size,
        used: d.used,
        free: d.available,
        percent: round1(d.use),
      })),
    network: { rxPerSec: rx, txPerSec: tx },
  };
}

async function getProcesses() {
  const data = await si.processes();
  const list = data.list
    .filter((p) => p.pid > 0)
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: round1(p.cpu),
      memPercent: round1(p.mem),
      memBytes: (p.memRss || 0) * 1024,
      path: p.path || '',
      protected: isProtected(p.name),
    }));
  lastProcessSnapshot = new Map(list.map((p) => [p.pid, p.name]));
  return { total: data.all, list };
}

function isProtected(name) {
  return PROTECTED_PROCESSES.has(String(name || '').toLowerCase());
}

/**
 * Termine un processus. Le nom doit correspondre au dernier relevé pour éviter
 * de tuer un autre programme ayant récupéré le même PID entre-temps.
 */
function killProcess(pid, expectedName, { selfPids = [] } = {}) {
  if (!Number.isInteger(pid) || pid <= 4) {
    throw new Error('Identifiant de processus invalide.');
  }
  if (selfPids.includes(pid)) {
    throw new Error("Impossible de fermer l'optimiseur lui-même.");
  }
  const known = lastProcessSnapshot.get(pid);
  if (!known || known !== expectedName) {
    throw new Error('Ce processus a changé ou n\'existe plus. Actualisez la liste.');
  }
  if (isProtected(known)) {
    throw new Error(`« ${known} » est un processus système essentiel : il ne peut pas être fermé.`);
  }
  try {
    process.kill(pid);
  } catch (err) {
    if (err.code === 'EPERM') throw new Error('Droits insuffisants pour fermer ce processus (relancez en administrateur).');
    if (err.code === 'ESRCH') throw new Error('Le processus est déjà fermé.');
    throw err;
  }
  lastProcessSnapshot.delete(pid);
  return { ok: true };
}

function round1(n) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

// Exposé pour les tests.
function _setSnapshot(entries) {
  lastProcessSnapshot = new Map(entries);
}

module.exports = { getStaticInfo, getLiveMetrics, getProcesses, killProcess, isProtected, _setSnapshot };
