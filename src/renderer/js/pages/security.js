'use strict';

(function () {
  const { esc, fmtAgo, fmtDate, call, toast, confirmDialog, busy, loading } = window.U;
  const I = window.Icons;

  let alive = false;
  let currentRoot = null;
  let unsubscribe = null;
  let pollTimer = null;
  let defenderUsable = true; // faux si un autre antivirus est actif ou hors Windows

  const SCAN_LABEL = { QuickScan: 'Analyse rapide', FullScan: 'Analyse complète', CustomScan: 'Analyse personnalisée' };
  const SEV_LABEL = { high: 'Élevé', medium: 'Moyen', low: 'Faible' };
  const KIND_LABEL = { process: 'Processus', startup: 'Démarrage', task: 'Tâche planifiée', hosts: 'Réseau', exclusion: 'Antivirus', proxy: 'Réseau' };

  function statusCard(level, icon, title, text) {
    return `<div class="card status-card ${level}"><div class="icon">${icon}</div><div><strong>${esc(title)}</strong><span>${esc(text)}</span></div></div>`;
  }

  // ---------- État de la protection ----------
  function renderStatus(root, s) {
    const box = root.querySelector('#status');
    // Réinitialise les verrous d'un affichage précédent (l'état a pu changer).
    root.querySelectorAll('[data-locked]').forEach((btn) => {
      delete btn.dataset.locked;
      btn.disabled = false;
      btn.title = '';
    });
    if (!s.supported) {
      box.innerHTML = `<div class="card empty" style="grid-column:1/-1">${I.info}<div>La sécurité n'est disponible que sous Windows pour le moment.</div></div>`;
      defenderUsable = false;
      root.querySelectorAll('[data-needs-win]').forEach((b) => {
        b.disabled = true;
        b.dataset.locked = '1';
      });
      return;
    }
    const d = s.defender || {};
    const otherAv = (s.products || []).filter((p) => p.enabled && !/^(windows|microsoft) defender/i.test(p.name));
    const cards = [];

    if (d.available && d.antivirusEnabled) cards.push(statusCard('ok', I.shield, 'Microsoft Defender actif', `Version des définitions ${d.signatureVersion || '?'}`));
    else if (otherAv.length) cards.push(statusCard('ok', I.shield, `${otherAv[0].name} actif`, 'Defender est en veille : un autre antivirus protège le PC.'));
    else cards.push(statusCard('crit', I.shieldOff, 'Aucun antivirus actif', 'Votre PC n\'est pas protégé.'));

    if (d.available && d.antivirusEnabled) {
      cards.push(d.realTime
        ? statusCard('ok', I.radar, 'Protection en temps réel', 'Les fichiers sont analysés à leur ouverture.')
        : statusCard('crit', I.radar, 'Temps réel désactivé', 'Réactivez-la dans Sécurité Windows.'));
      const age = d.signatureAgeDays;
      cards.push(statusCard(age === null ? 'warn' : age > 3 ? 'warn' : 'ok', I.download, 'Définitions antivirus', age === null ? 'Date inconnue' : `Mises à jour ${fmtAgo(d.signatureUpdated)}`));
    } else {
      cards.push(statusCard('warn', I.radar, 'Temps réel', 'Géré par votre antivirus.'));
      cards.push(statusCard('warn', I.download, 'Définitions', 'Gérées par votre antivirus.'));
    }
    cards.push(s.firewallAllEnabled
      ? statusCard('ok', I.fire, 'Pare-feu actif', 'Tous les profils réseau sont protégés.')
      : statusCard('crit', I.fire, 'Pare-feu incomplet', (s.firewall || []).filter((f) => !f.enabled).map((f) => f.name).join(', ') + ' désactivé(s)'));
    box.innerHTML = cards.join('');

    const last = [d.quickScanEnd, d.fullScanEnd].filter(Boolean).sort().pop();
    root.querySelector('#last-scan').textContent = d.available ? `Dernière analyse : ${fmtDate(last)}` : '';
    defenderUsable = Boolean(d.available && d.antivirusEnabled);
    if (!defenderUsable) {
      root.querySelectorAll('[data-defender]').forEach((b) => {
        b.disabled = true;
        b.dataset.locked = '1';
        b.title = 'Microsoft Defender n\'est pas l\'antivirus actif';
      });
    }
  }

  async function loadStatus(root) {
    try {
      const s = await call(window.api.security.status);
      if (!alive) return;
      renderStatus(root, s);
      // Ré-applique l'état « analyse en cours » sur les boutons.
      if (s.supported) renderScanState(root, await call(window.api.security.scanState));
    } catch (err) {
      if (alive) root.querySelector('#status').innerHTML = `<div class="card empty" style="grid-column:1/-1">${I.alert}<div>${esc(err.message)}</div></div>`;
    }
  }

  // ---------- Analyses ----------
  function renderScanState(root, st) {
    const box = root.querySelector('#scan-state');
    const running = Boolean(st?.running);
    root.querySelectorAll('[data-scan]').forEach((b) => { if (!b.dataset.locked) b.disabled = running; });
    if (running) {
      box.innerHTML = `
        <div class="card scan-progress">
          <span class="spinner lg"></span>
          <div style="min-width:220px"><strong>${esc(SCAN_LABEL[st.type])} en cours…</strong>
          <div class="muted" style="font-size:12.5px">${st.path ? esc(st.path) : `Démarrée ${esc(fmtAgo(new Date(st.startedAt).toISOString()))}`}. Vous pouvez continuer à utiliser votre PC.</div></div>
          <div class="bar indeterminate"><span></span></div>
        </div>`;
    } else if (st?.finishedAt) {
      box.innerHTML = st.error
        ? `<div class="card scan-progress" style="border-color:rgba(255,107,107,.4)">${I.alert.replace('<svg', '<svg width="24" height="24" style="color:var(--crit)"')}<div><strong>L'analyse a échoué</strong><div class="muted">${esc(st.error)}</div></div></div>`
        : `<div class="card scan-progress" style="border-color:rgba(63,207,142,.4)">${I.check.replace('<svg', '<svg width="24" height="24" style="color:var(--ok)"')}<div><strong>${esc(SCAN_LABEL[st.type])} terminée</strong><div class="muted">Consultez les menaces détectées ci-dessous.</div></div></div>`;
    } else {
      box.innerHTML = '';
    }
  }

  async function startScan(root, type, scanPath) {
    try {
      const st = await call(window.api.security.scan, { type, path: scanPath });
      renderScanState(root, st);
      toast(`${SCAN_LABEL[type]} lancée.`, 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function customScan(root, kind) {
    const p = await call(window.api.util.choosePath, kind).catch(() => null);
    if (p) startScan(root, 'CustomScan', p);
  }

  async function updateSignatures(root, button) {
    const restore = busy(button, 'Mise à jour…');
    try {
      await call(window.api.security.update);
      toast('Définitions antivirus à jour.', 'success');
      loadStatus(root);
    } catch (err) {
      toast(`Mise à jour impossible : ${err.message}`, 'error');
    } finally {
      restore();
    }
  }

  // ---------- Menaces ----------
  async function loadThreats(root) {
    const box = root.querySelector('#threats');
    box.innerHTML = loading('Lecture de l\'historique des menaces…');
    try {
      const { supported, threats } = await call(window.api.security.threats);
      if (!alive) return;
      if (!supported) {
        box.innerHTML = '';
        return;
      }
      const active = threats.filter((t) => t.active);
      root.querySelector('#remove-threats').hidden = active.length === 0;
      if (!threats.length) {
        box.innerHTML = `<div class="card empty">${I.check}<div>Aucune menace détectée sur ce PC.</div></div>`;
        return;
      }
      box.innerHTML = `<div class="list">${threats
        .map(
          (t) => `
          <div class="list-item">
            <div class="grow">
              <div class="title">${esc(t.name)}
                <span class="badge ${t.severity >= 4 ? 'crit' : t.severity >= 2 ? 'warn' : 'info'}">Gravité : ${esc(t.severityLabel)}</span>
                ${t.active ? '<span class="badge crit">Active</span>' : `<span class="badge ok">${t.actionSuccess ? 'Neutralisée' : 'Traitée'}</span>`}
              </div>
              <div class="meta mono selectable">${t.resources.map((r) => esc(r)).join('<br>')}</div>
              <div class="meta">Détectée le ${esc(fmtDate(t.detected))}</div>
            </div>
          </div>`,
        )
        .join('')}</div>`;
    } catch (err) {
      if (alive) box.innerHTML = `<div class="card empty">${I.alert}<div>${esc(err.message)}</div></div>`;
    }
  }

  async function removeThreats(root, button) {
    const ok = await confirmDialog({
      title: 'Supprimer les menaces actives ?',
      message: 'Microsoft Defender va mettre en quarantaine ou supprimer les fichiers infectés.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const restore = busy(button, 'Suppression…');
    try {
      await call(window.api.security.removeThreats);
      toast('Menaces traitées.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      restore();
      loadThreats(root);
    }
  }

  // ---------- Analyse avancée ----------
  function renderFindings(root, state) {
    const box = root.querySelector('#findings');
    const a = state.audit;
    if (!a) {
      box.innerHTML = `<div class="card muted">L'analyse avancée recherche les signes d'infection que l'antivirus peut manquer : programmes non signés lancés depuis des dossiers temporaires, démarrage automatique ou tâches planifiées suspectes (commandes obfusquées), fichier hosts détourné, exclusions ajoutées à Defender, proxy imposé.</div>`;
      return;
    }
    if (!a.supported) {
      box.innerHTML = `<div class="card empty">${I.info}<div>L'analyse avancée n'est disponible que sous Windows pour le moment.</div></div>`;
      return;
    }
    if (!a.findings.length) {
      box.innerHTML = `<div class="card empty">${I.check}<div>Aucun élément suspect trouvé.</div></div>`;
      return;
    }
    box.innerHTML = `<div class="list">${a.findings
      .map(
        (f) => `
        <div class="list-item finding" style="align-items:flex-start">
          <div class="grow">
            <div class="title"><span class="badge ${esc(f.severity)}">${esc(SEV_LABEL[f.severity])}</span> ${esc(f.title)} <span class="faint" style="font-weight:400;font-size:12px">${esc(KIND_LABEL[f.kind] || '')}</span></div>
            <div class="desc detail">${esc(f.detail)}</div>
            ${f.path ? `<div class="meta mono selectable">${esc(f.path)}</div>` : ''}
            ${f.sha256 ? `<div class="hash">SHA-256 : ${esc(f.sha256)}</div>` : ''}
          </div>
          <div class="row" style="flex-wrap:wrap;justify-content:flex-end;max-width:280px">
            ${f.path ? `<button class="btn btn-sm" data-scan-file="${esc(f.path)}" data-write data-defender data-scan ${defenderUsable ? '' : 'disabled data-locked="1"'}>${I.radar} Analyser</button>` : ''}
            ${f.path ? `<button class="btn btn-sm btn-ghost" data-show="${esc(f.path)}" title="Ouvrir l'emplacement">${I.folder}</button>` : ''}
            ${f.sha256 ? `<button class="btn btn-sm btn-ghost" data-vt="${esc(f.sha256)}" title="Vérifier l'empreinte sur VirusTotal (site web)">VirusTotal</button>` : ''}
          </div>
        </div>`,
      )
      .join('')}</div>
      <p class="faint" style="font-size:12.5px;margin-top:12px">Un élément signalé n'est pas forcément malveillant (logiciels de développement, outils maison…). En cas de doute, analysez-le avec Defender ou vérifiez son empreinte sur VirusTotal.</p>`;
  }

  async function runAudit(root, state, button) {
    const restore = busy(button, 'Analyse en cours…');
    root.querySelector('#findings').innerHTML = loading('Inspection des processus, du démarrage, des tâches planifiées et du réseau… (jusqu\'à 1 minute)');
    try {
      state.audit = await call(window.api.security.audit);
      const high = state.audit.findings.filter((f) => f.severity === 'high').length;
      toast(state.audit.findings.length ? `${state.audit.findings.length} élément(s) à vérifier${high ? `, dont ${high} important(s)` : ''}.` : 'Aucun élément suspect.', high ? 'error' : 'success');
    } catch (err) {
      toast(`Analyse avancée impossible : ${err.message}`, 'error');
    } finally {
      restore();
      if (alive) renderFindings(currentRoot, state);
    }
  }

  window.Pages = window.Pages || {};
  window.Pages.security = {
    title: 'Sécurité',
    mount(root, ctx) {
      alive = true;
      currentRoot = root;
      root.innerHTML = `
        <div class="page-header">
          <div><h1>Sécurité</h1><p>Protection antivirus Microsoft Defender et recherche avancée de menaces.</p></div>
          <div class="page-actions"><button class="btn" id="refresh">${I.refresh} Actualiser</button></div>
        </div>
        <div class="grid grid-4" id="status"><div class="card" style="grid-column:1/-1">${loading('Vérification de la protection…')}</div></div>

        <h2 class="section">Analyse antivirus <span class="muted" id="last-scan" style="font-size:12.5px"></span></h2>
        <div class="row" style="flex-wrap:wrap">
          <button class="btn btn-primary" data-write data-scan data-defender data-needs-win data-type="QuickScan">${I.play} Analyse rapide</button>
          <button class="btn" data-write data-scan data-defender data-needs-win data-type="FullScan">${I.radar} Analyse complète</button>
          <button class="btn" data-write data-scan data-defender data-needs-win data-custom="folder">${I.folder} Analyser un dossier</button>
          <button class="btn" data-write data-scan data-defender data-needs-win data-custom="file">${I.search} Analyser un fichier</button>
          <span class="spacer"></span>
          <button class="btn" id="update-sig" data-write data-defender data-needs-win>${I.download} Mettre à jour les définitions</button>
        </div>
        <div id="scan-state"></div>

        <h2 class="section">Analyse avancée des menaces</h2>
        <div class="row" style="margin-bottom:12px">
          <button class="btn btn-primary" id="audit-btn" data-needs-win>${I.bug} Lancer l'analyse avancée</button>
          <span class="faint" style="font-size:12.5px">Lecture seule : rien n'est modifié sur votre PC.</span>
        </div>
        <div id="findings"></div>

        <h2 class="section">Historique des menaces <span class="spacer"></span>
          <button class="btn btn-sm btn-danger" id="remove-threats" data-write hidden>${I.x} Supprimer les menaces actives</button></h2>
        <div id="threats"></div>`;

      root.addEventListener('click', (e) => {
        const t = e.target.closest('button');
        if (!t || t.disabled) return;
        if (t.dataset.type) startScan(root, t.dataset.type);
        else if (t.dataset.custom) customScan(root, t.dataset.custom);
        else if (t.dataset.scanFile) startScan(root, 'CustomScan', t.dataset.scanFile);
        else if (t.dataset.show) call(window.api.util.showItem, t.dataset.show).catch((err) => toast(err.message, 'error'));
        else if (t.dataset.vt) window.open(`https://www.virustotal.com/gui/file/${encodeURIComponent(t.dataset.vt)}`);
        else if (t.id === 'update-sig') updateSignatures(root, t);
        else if (t.id === 'audit-btn') runAudit(root, ctx.state, t);
        else if (t.id === 'remove-threats') removeThreats(root, t);
        else if (t.id === 'refresh') {
          loadStatus(root);
          loadThreats(root);
        }
      });

      renderFindings(root, ctx.state);
      loadStatus(root);
      loadThreats(root);
      call(window.api.security.scanState).then((st) => alive && renderScanState(root, st)).catch(() => {});

      unsubscribe = window.api.security.onScanFinished((st) => {
        if (!alive) return;
        renderScanState(currentRoot, st);
        toast(st.error ? `Analyse échouée : ${st.error}` : `${SCAN_LABEL[st.type]} terminée.`, st.error ? 'error' : 'success');
        loadStatus(currentRoot);
        loadThreats(currentRoot);
      });
      // Filet de sécurité si l'événement de fin est manqué.
      pollTimer = setInterval(() => {
        call(window.api.security.scanState).then((st) => alive && st.running && renderScanState(currentRoot, st)).catch(() => {});
      }, 15000);
    },
    unmount() {
      alive = false;
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      clearInterval(pollTimer);
    },
  };
})();
