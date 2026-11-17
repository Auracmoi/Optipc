'use strict';

(function () {
  const { esc, fmtBytes, fmtPct, fmtUptime, call, toast, loading, levelClass } = window.U;
  const I = window.Icons;

  let timer = null;
  let alive = false;
  let currentRoot = null; // la page peut être quittée puis rouverte pendant une analyse

  const SEVERITY_LABEL = { critical: 'Critique', warning: 'Attention', info: 'Conseil' };
  const SEVERITY_ICON = { critical: I.critical, warning: I.alert, info: I.info };

  function verdict(score) {
    if (score >= 90) return ['Votre PC est en excellente forme', 'Aucun problème important détecté. Continuez à le surveiller de temps en temps.'];
    if (score >= 75) return ['Votre PC est en bonne forme', 'Quelques améliorations sont possibles pour gagner en réactivité.'];
    if (score >= 55) return ['Votre PC peut être optimisé', 'Plusieurs points ralentissent votre machine. Suivez les recommandations ci-dessous.'];
    return ['Votre PC a besoin d\'attention', 'Des problèmes importants affectent les performances ou la sécurité.'];
  }

  function renderHero(root, state) {
    const hero = root.querySelector('#hero');
    const d = state.lastDiagnostic;
    if (state.diagnosing) {
      hero.innerHTML = `
        <div class="score-ring">${window.Charts.scoreRing(0)}<div class="value"><span class="spinner lg"></span><span>Analyse…</span></div></div>
        <div><h2>Analyse en cours</h2><p>Mesure du processeur, de la mémoire, des disques, du démarrage et de la sécurité. Cela prend quelques secondes.</p></div>`;
      return;
    }
    if (!d) {
      hero.innerHTML = `
        <div class="score-ring">${window.Charts.scoreRing(0)}<div class="value"><strong>–</strong><span>sur 100</span></div></div>
        <div><h2>Bienvenue dans OptiPC</h2><p>Lancez une analyse pour détecter ce qui ralentit votre PC.</p>
        <button class="btn btn-primary" data-action="diagnose">${I.radar} Analyser mon PC</button></div>`;
      return;
    }
    const [title, text] = verdict(d.score);
    const counts = d.issues.reduce((c, i) => ({ ...c, [i.severity]: (c[i.severity] || 0) + 1 }), {});
    hero.innerHTML = `
      <div class="score-ring">${window.Charts.scoreRing(d.score)}<div class="value"><strong>${d.score}</strong><span>sur 100</span></div></div>
      <div>
        <h2>${esc(title)}</h2>
        <p>${esc(text)}</p>
        <div class="row" style="margin-bottom:18px;flex-wrap:wrap">
          <span class="badge critical">${counts.critical || 0} critique(s)</span>
          <span class="badge warning">${counts.warning || 0} avertissement(s)</span>
          <span class="badge info">${counts.info || 0} conseil(s)</span>
          <span class="faint" style="font-size:12px">Analyse ${esc(window.U.fmtAgo(new Date(d.checkedAt).toISOString()))}</span>
        </div>
        <button class="btn btn-primary" data-action="diagnose">${I.refresh} Relancer l'analyse</button>
      </div>`;
  }

  function renderIssues(root, state) {
    const box = root.querySelector('#issues');
    const d = state.lastDiagnostic;
    if (!d) {
      box.innerHTML = '';
      return;
    }
    if (!d.issues.length) {
      box.innerHTML = `<div class="card empty">${I.check}<div>Aucun problème détecté. Bravo !</div></div>`;
      return;
    }
    box.innerHTML = d.issues
      .map(
        (i) => `
        <div class="issue ${esc(i.severity)}">
          <div class="icon">${SEVERITY_ICON[i.severity] || I.info}</div>
          <div class="body">
            <strong>${esc(i.title)}</strong>
            <p>${esc(i.detail)}</p>
          </div>
          <span class="badge ${esc(i.severity)}">${esc(SEVERITY_LABEL[i.severity])}</span>
          ${i.action ? `<button class="btn btn-sm" data-goto="${esc(i.action.page)}">${esc(i.action.label)}</button>` : ''}
        </div>`,
      )
      .join('');
  }

  async function refreshStats(root) {
    try {
      const live = await call(window.api.monitor.live);
      if (!alive) return;
      const sys = live.disks.find((d) => /^c:?\\?$/i.test(d.mount)) || live.disks.find((d) => d.mount === '/') || live.disks[0];
      root.querySelector('#stat-cpu').innerHTML = statCard(I.cpu, 'Processeur', fmtPct(live.cpu.load), live.cpu.load, live.cpu.temperature ? `${Math.round(live.cpu.temperature)} °C` : '');
      root.querySelector('#stat-ram').innerHTML = statCard(I.ram, 'Mémoire', fmtPct(live.memory.percent), live.memory.percent, `${fmtBytes(live.memory.used)} / ${fmtBytes(live.memory.total)}`);
      root.querySelector('#stat-disk').innerHTML = sys
        ? statCard(I.disk, `Disque ${sys.mount}`, fmtPct(sys.percent), sys.percent, `${fmtBytes(sys.free)} libres sur ${fmtBytes(sys.size)}`)
        : statCard(I.disk, 'Disque', '–', 0, '');
      root.querySelector('#stat-net').innerHTML = `
        <div class="label">${I.network} Réseau</div>
        <div class="value" style="font-size:20px">↓ ${esc(window.U.fmtRate(live.network.rxPerSec))}</div>
        <div class="sub">↑ ${esc(window.U.fmtRate(live.network.txPerSec))}</div>`;
    } catch {
      /* mesure ponctuelle ignorée */
    }
  }

  function statCard(icon, label, value, percent, sub) {
    return `
      <div class="label">${icon} ${esc(label)}</div>
      <div class="value">${esc(value)}</div>
      <div class="bar ${levelClass(percent)}"><span style="width:${Math.min(100, Math.max(0, percent))}%"></span></div>
      <div class="sub">${esc(sub)}</div>`;
  }

  async function renderSystem(root) {
    const box = root.querySelector('#system');
    try {
      const s = await call(window.api.monitor.staticInfo);
      if (!alive) return;
      const disks = s.disks.map((d) => `${d.name || 'Disque'} · ${d.type || '?'} · ${fmtBytes(d.size)}`).join('\n') || '—';
      box.innerHTML = `
        <dl class="kv">
          <dt>Système</dt><dd>${esc(`${s.os.name} ${s.os.release}`)} ${s.os.build ? `(build ${esc(s.os.build)})` : ''} · ${esc(s.os.arch)}</dd>
          <dt>Processeur</dt><dd>${esc(s.cpu.name)} · ${esc(s.cpu.cores)} cœurs / ${esc(s.cpu.threads)} threads</dd>
          <dt>Mémoire</dt><dd>${esc(fmtBytes(s.memoryTotal))}</dd>
          <dt>Carte graphique</dt><dd>${esc(s.gpus.map((g) => g.model).filter(Boolean).join(', ') || '—')}</dd>
          <dt>Stockage</dt><dd style="white-space:pre-line">${esc(disks)}</dd>
          <dt>Allumé depuis</dt><dd>${esc(fmtUptime(s.uptimeSeconds))}</dd>
        </dl>`;
    } catch (err) {
      box.innerHTML = `<div class="muted">${esc(err.message)}</div>`;
    }
  }

  async function diagnose(ctx) {
    const state = ctx.state;
    if (state.diagnosing) return;
    state.diagnosing = true;
    renderHero(currentRoot, state);
    try {
      state.lastDiagnostic = await call(window.api.diagnostics.run);
    } catch (err) {
      toast(`Analyse impossible : ${err.message}`, 'error');
    } finally {
      state.diagnosing = false;
      if (alive) {
        renderHero(currentRoot, state);
        renderIssues(currentRoot, state);
      }
    }
  }

  window.Pages = window.Pages || {};
  window.Pages.dashboard = {
    title: 'Tableau de bord',
    mount(root, ctx) {
      alive = true;
      currentRoot = root;
      root.innerHTML = `
        <div class="page-header"><div><h1>Tableau de bord</h1><p>État de santé de votre PC en un coup d'œil.</p></div></div>
        <div class="card hero" id="hero"></div>
        <div class="grid grid-4" style="margin-top:14px">
          <div class="card stat" id="stat-cpu">${loading('')}</div>
          <div class="card stat" id="stat-ram"></div>
          <div class="card stat" id="stat-disk"></div>
          <div class="card stat" id="stat-net"></div>
        </div>
        <h2 class="section">Recommandations</h2>
        <div id="issues"><div class="muted">Lancez une analyse pour obtenir des recommandations personnalisées.</div></div>
        <h2 class="section">Votre configuration</h2>
        <div class="card" id="system">${loading('Lecture de la configuration…')}</div>`;

      root.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="diagnose"]')) diagnose(ctx);
        const go = e.target.closest('[data-goto]');
        if (go) ctx.navigate(go.dataset.goto);
      });

      renderHero(root, ctx.state);
      renderIssues(root, ctx.state);
      refreshStats(root);
      renderSystem(root);
      timer = setInterval(() => refreshStats(root), 2000);

      // Première ouverture : analyse automatique.
      if (!ctx.state.lastDiagnostic && !ctx.state.autoDiagnosed) {
        ctx.state.autoDiagnosed = true;
        diagnose(ctx);
      }
    },
    unmount() {
      alive = false;
      clearInterval(timer);
    },
  };
})();
