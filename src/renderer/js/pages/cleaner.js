'use strict';

(function () {
  const { esc, fmtBytes, fmtNum, call, toast, confirmDialog, busy, loading } = window.U;
  const I = window.Icons;

  let alive = false;

  function selectedIds(root) {
    return [...root.querySelectorAll('input[data-cat]:checked')].map((c) => c.dataset.cat);
  }

  function updateTotal(root, categories) {
    const ids = new Set(selectedIds(root));
    const total = categories.filter((c) => ids.has(c.id)).reduce((s, c) => s + c.bytes, 0);
    root.querySelector('#total').textContent = fmtBytes(total);
    root.querySelector('#clean-btn').disabled = ids.size === 0;
  }

  function render(root, state) {
    const box = root.querySelector('#content');
    const scan = state.cleanerScan;
    if (!scan) {
      box.innerHTML = loading('Recherche des fichiers inutiles…');
      return;
    }
    if (!scan.supported) {
      box.innerHTML = `<div class="card empty">${I.info}<div>Le nettoyage n'est disponible que sous Windows pour le moment.</div></div>`;
      return;
    }
    const result = state.cleanerResult;
    const resultHtml = result
      ? `<div class="card result-card">
           ${I.check.replace('<svg', '<svg width="40" height="40" style="color:var(--ok)"')}
           <div><div class="big">${esc(fmtBytes(result.totals.freed))} libérés</div>
           <div class="muted">${fmtNum(result.totals.deleted)} fichier(s) supprimé(s)${result.totals.failed ? ` · ${fmtNum(result.totals.failed)} en cours d'utilisation, ignoré(s)` : ''}</div></div>
         </div>`
      : '';

    box.innerHTML = `${resultHtml}
      <div class="list">
        ${scan.categories
          .map((c) => {
            const disabled = c.blocked || c.bytes === 0;
            const checked = !disabled && c.id !== 'recycle-bin';
            return `
            <label class="list-item ${disabled ? 'disabled' : ''}" style="cursor:${disabled ? 'default' : 'pointer'}">
              <input type="checkbox" class="check" data-cat="${esc(c.id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
              <div class="grow">
                <div class="title">${esc(c.label)} ${c.blocked ? '<span class="badge warn">Administrateur requis</span>' : ''}</div>
                <div class="desc">${esc(c.description)}</div>
                <div class="meta">${c.blocked ? 'Relancez OptiPC en administrateur pour analyser cette catégorie.' : `${fmtNum(c.files)} élément(s)`}</div>
              </div>
              <div class="size">${c.blocked ? '—' : esc(fmtBytes(c.bytes))}</div>
            </label>`;
          })
          .join('')}
        <div class="list-footer">
          <div><div class="faint" style="font-size:12px">Espace récupérable sélectionné</div><div class="total" id="total">0 o</div></div>
          <span class="spacer"></span>
          <button class="btn btn-primary" id="clean-btn">${I.cleaner} Nettoyer</button>
        </div>
      </div>
      <p class="faint" style="font-size:12.5px;margin-top:12px">Les fichiers récents (moins de 24 h) et ceux en cours d'utilisation ne sont jamais supprimés. La corbeille n'est pas cochée par défaut : son contenu sera définitivement effacé.</p>`;

    box.querySelectorAll('input[data-cat]').forEach((c) => c.addEventListener('change', () => updateTotal(root, scan.categories)));
    box.querySelector('#clean-btn').addEventListener('click', (e) => clean(root, state, e.currentTarget));
    updateTotal(root, scan.categories);
  }

  async function scan(root, state) {
    state.cleanerScan = null;
    render(root, state);
    const btn = root.querySelector('#rescan');
    btn.disabled = true;
    try {
      state.cleanerScan = await call(window.api.cleaner.scan);
    } catch (err) {
      state.cleanerScan = { supported: true, categories: [] };
      toast(`Analyse impossible : ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
    if (alive) render(root, state);
  }

  async function clean(root, state, button) {
    const ids = selectedIds(root);
    if (!ids.length) return;
    const labels = state.cleanerScan.categories.filter((c) => ids.includes(c.id)).map((c) => `• ${c.label}`).join('\n');
    const ok = await confirmDialog({
      title: 'Supprimer ces fichiers ?',
      message: `${labels}\n\nCette opération est définitive.`,
      confirmLabel: 'Nettoyer',
    });
    if (!ok) return;
    const restore = busy(button, 'Nettoyage…');
    try {
      state.cleanerResult = await call(window.api.cleaner.clean, ids);
      toast(`${fmtBytes(state.cleanerResult.totals.freed)} libérés.`, 'success');
      await scan(root, state);
    } catch (err) {
      toast(err.message, 'error');
      restore();
    }
  }

  window.Pages = window.Pages || {};
  window.Pages.cleaner = {
    title: 'Nettoyage',
    mount(root, ctx) {
      alive = true;
      ctx.state.cleanerResult = null;
      root.innerHTML = `
        <div class="page-header">
          <div><h1>Nettoyage du disque</h1><p>Supprimez les fichiers temporaires et caches qui encombrent votre disque.</p></div>
          <div class="page-actions"><button class="btn" id="rescan">${I.refresh} Analyser à nouveau</button></div>
        </div>
        <div id="content"></div>`;
      root.querySelector('#rescan').addEventListener('click', () => {
        ctx.state.cleanerResult = null;
        scan(root, ctx.state);
      });
      if (ctx.state.cleanerScan) render(root, ctx.state);
      else scan(root, ctx.state);
    },
    unmount() {
      alive = false;
    },
  };
})();
