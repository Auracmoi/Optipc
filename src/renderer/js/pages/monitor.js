'use strict';

(function () {
  const { esc, fmtBytes, fmtRate, fmtPct, call, toast, confirmDialog, loading, levelClass } = window.U;
  const I = window.Icons;

  // L'historique est conservé quand on change de page.
  const history = { cpu: [], ram: [], net: [] };
  const CAPACITY = 60;

  let liveTimer = null;
  let procTimer = null;
  let alive = false;
  let charts = {};
  let processes = [];
  const view = { sort: 'cpu', query: '', grouped: true };

  function remember(key, value) {
    history[key].push(value);
    if (history[key].length > CAPACITY) history[key].shift();
    charts[key]?.push(value);
  }

  const inFlight = { live: false, proc: false }; // évite d'empiler les requêtes sur un PC lent

  async function tickLive(root) {
    if (inFlight.live) return;
    inFlight.live = true;
    let live;
    try {
      live = await call(window.api.monitor.live);
    } catch {
      return;
    } finally {
      inFlight.live = false;
    }
    if (!alive) return;
    remember('cpu', live.cpu.load);
    remember('ram', live.memory.percent);
    remember('net', live.network.rxPerSec + live.network.txPerSec);

    root.querySelector('#cpu-val').textContent = fmtPct(live.cpu.load);
    root.querySelector('#cpu-sub').textContent = live.cpu.temperature ? `Température : ${Math.round(live.cpu.temperature)} °C` : `${live.cpu.perCore.length} cœurs logiques`;
    root.querySelector('#ram-val').textContent = fmtPct(live.memory.percent);
    root.querySelector('#ram-sub').textContent = `${fmtBytes(live.memory.used)} utilisés sur ${fmtBytes(live.memory.total)}`;
    root.querySelector('#net-val').textContent = `↓ ${fmtRate(live.network.rxPerSec)}`;
    root.querySelector('#net-sub').textContent = `↑ ${fmtRate(live.network.txPerSec)}`;

    const cores = root.querySelector('#cores');
    if (cores.children.length !== live.cpu.perCore.length) {
      cores.innerHTML = live.cpu.perCore.map((_, i) => `<div class="core" title="Cœur ${i + 1}"><span></span></div>`).join('');
    }
    live.cpu.perCore.forEach((v, i) => {
      cores.children[i].firstElementChild.style.height = `${Math.min(100, v)}%`;
      cores.children[i].title = `Cœur ${i + 1} : ${Math.round(v)} %`;
    });

    root.querySelector('#disks').innerHTML = live.disks
      .map(
        (d) => `
        <div style="margin-bottom:14px">
          <div class="row" style="margin-bottom:6px"><strong>${esc(d.mount)}</strong><span class="faint">${esc(d.type || '')}</span><span class="spacer"></span>
          <span class="muted">${esc(fmtBytes(d.free))} libres sur ${esc(fmtBytes(d.size))}</span></div>
          <div class="bar ${levelClass(d.percent, 80, 90)}"><span style="width:${Math.min(100, d.percent)}%"></span></div>
        </div>`,
      )
      .join('') || '<div class="muted">Aucun disque détecté.</div>';
  }

  async function tickProcesses(root) {
    if (inFlight.proc) return;
    inFlight.proc = true;
    try {
      const res = await call(window.api.monitor.processes);
      if (!alive) return;
      processes = res.list;
      root.querySelector('#proc-count').textContent = `${res.total} processus`;
      renderProcesses(root);
    } catch (err) {
      if (alive) root.querySelector('#proc-body').innerHTML = `<tr><td colspan="5" class="muted">${esc(err.message)}</td></tr>`;
    } finally {
      inFlight.proc = false;
    }
  }

  function rows() {
    const q = view.query.trim().toLowerCase();
    let list = processes.filter((p) => !q || p.name.toLowerCase().includes(q));
    if (view.grouped) {
      const groups = new Map();
      for (const p of list) {
        const g = groups.get(p.name) || { name: p.name, cpu: 0, memBytes: 0, memPercent: 0, pids: [], protected: p.protected, path: p.path };
        g.cpu += p.cpu;
        g.memBytes += p.memBytes;
        g.memPercent += p.memPercent;
        g.pids.push(p.pid);
        groups.set(p.name, g);
      }
      list = [...groups.values()];
    } else {
      list = list.map((p) => ({ ...p, pids: [p.pid] }));
    }
    const key = view.sort === 'mem' ? 'memBytes' : view.sort === 'name' ? 'name' : 'cpu';
    list.sort((a, b) => (key === 'name' ? a.name.localeCompare(b.name, 'fr') : b[key] - a[key]));
    return list.slice(0, 150);
  }

  function renderProcesses(root) {
    const body = root.querySelector('#proc-body');
    const list = rows();
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">Aucun processus ne correspond.</td></tr>';
      return;
    }
    body.innerHTML = list
      .map(
        (p) => `
        <tr>
          <td class="proc-name ellipsis" title="${esc(p.path || p.name)}">${esc(p.name)}${p.pids.length > 1 ? ` <span class="faint">(${p.pids.length})</span>` : ''}</td>
          <td class="num faint">${p.pids.length === 1 ? p.pids[0] : '—'}</td>
          <td class="num">${fmtPct(p.cpu)}</td>
          <td class="num">${esc(fmtBytes(p.memBytes))}</td>
          <td class="num">
            ${p.protected
              ? `<span class="badge" title="Processus système essentiel">${I.lock.replace('<svg', '<svg width="12" height="12"')} Système</span>`
              : `<button class="btn btn-sm btn-ghost btn-danger" data-kill="${esc(p.name)}" data-pids="${p.pids.join(',')}">Fermer</button>`}
          </td>
        </tr>`,
      )
      .join('');
    root.querySelectorAll('th.sortable').forEach((th) => th.classList.toggle('sorted', th.dataset.sort === view.sort));
  }

  async function kill(root, name, pids) {
    const ok = await confirmDialog({
      title: `Fermer « ${name} » ?`,
      message: `${pids.length > 1 ? `${pids.length} processus seront fermés.` : 'Le programme sera fermé immédiatement.'}\nLes données non enregistrées dans ce programme seront perdues.`,
      confirmLabel: 'Fermer',
      danger: true,
    });
    if (!ok) return;
    let done = 0;
    let lastError = null;
    for (const pid of pids) {
      try {
        await call(window.api.monitor.kill, pid, name);
        done++;
      } catch (err) {
        lastError = err;
      }
    }
    if (done) toast(`${name} : ${done} processus fermé(s).`, 'success');
    if (lastError) toast(lastError.message, 'error');
    tickProcesses(root);
  }

  window.Pages = window.Pages || {};
  window.Pages.monitor = {
    title: 'Surveillance',
    mount(root) {
      alive = true;
      root.innerHTML = `
        <div class="page-header"><div><h1>Surveillance en direct</h1><p>Utilisation des ressources actualisée en temps réel.</p></div></div>
        <div class="grid grid-3">
          <div class="card chart-card stat"><div class="label">${I.cpu} Processeur</div><div class="value" id="cpu-val">–</div><canvas id="cpu-chart"></canvas><div class="sub" id="cpu-sub"></div></div>
          <div class="card chart-card stat"><div class="label">${I.ram} Mémoire</div><div class="value" id="ram-val">–</div><canvas id="ram-chart"></canvas><div class="sub" id="ram-sub"></div></div>
          <div class="card chart-card stat"><div class="label">${I.network} Réseau</div><div class="value" id="net-val" style="font-size:22px">–</div><canvas id="net-chart"></canvas><div class="sub" id="net-sub"></div></div>
        </div>
        <div class="grid grid-2" style="margin-top:14px">
          <div class="card"><div class="stat"><div class="label">${I.cpu} Charge par cœur</div></div><div class="cores" id="cores" style="margin-top:14px"></div></div>
          <div class="card"><div class="stat"><div class="label" style="margin-bottom:14px">${I.disk} Espace disque</div></div><div id="disks">${loading('')}</div></div>
        </div>
        <h2 class="section">Processus <span class="muted" id="proc-count"></span></h2>
        <div class="row" style="margin-bottom:12px">
          <input type="search" id="proc-search" placeholder="Rechercher un programme…" aria-label="Rechercher un processus">
          <label class="row" style="gap:8px;cursor:pointer"><input type="checkbox" class="check" id="proc-group" ${view.grouped ? 'checked' : ''}> Regrouper par programme</label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th class="sortable" data-sort="name">Nom</th>
              <th class="num">PID</th>
              <th class="num sortable" data-sort="cpu">Processeur</th>
              <th class="num sortable" data-sort="mem">Mémoire</th>
              <th class="num"></th>
            </tr></thead>
            <tbody id="proc-body"><tr><td colspan="5">${loading('Lecture des processus…')}</td></tr></tbody>
          </table>
        </div>`;

      charts = {
        cpu: new window.Charts.Sparkline(root.querySelector('#cpu-chart'), { capacity: CAPACITY }),
        ram: new window.Charts.Sparkline(root.querySelector('#ram-chart'), { capacity: CAPACITY, colors: ['#8b7bff', '#c07bff'] }),
        net: new window.Charts.Sparkline(root.querySelector('#net-chart'), { capacity: CAPACITY, autoScale: true, colors: ['#3fcf8e', '#3fb6ff'] }),
      };
      for (const k of Object.keys(charts)) {
        charts[k].values = [...history[k]];
        requestAnimationFrame(() => charts[k].draw());
      }

      root.querySelector('#proc-search').addEventListener('input', (e) => {
        view.query = e.target.value;
        renderProcesses(root);
      });
      root.querySelector('#proc-group').addEventListener('change', (e) => {
        view.grouped = e.target.checked;
        renderProcesses(root);
      });
      root.querySelector('thead').addEventListener('click', (e) => {
        const th = e.target.closest('th.sortable');
        if (!th) return;
        view.sort = th.dataset.sort;
        renderProcesses(root);
      });
      root.querySelector('#proc-body').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-kill]');
        if (btn) kill(root, btn.dataset.kill, btn.dataset.pids.split(',').map(Number));
      });

      tickLive(root);
      tickProcesses(root);
      liveTimer = setInterval(() => tickLive(root), 1500);
      procTimer = setInterval(() => tickProcesses(root), 4000);
    },
    unmount() {
      alive = false;
      clearInterval(liveTimer);
      clearInterval(procTimer);
      charts = {};
    },
  };
})();
