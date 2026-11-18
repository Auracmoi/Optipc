'use strict';

(function () {
  const { esc, call, toast, busy, loading } = window.U;
  const I = window.Icons;

  let alive = false;

  async function ensureRestorePoint(ctx) {
    if (ctx.state.restorePointDone) return true;
    const auto = document.getElementById('auto-restore');
    if (!auto || !auto.checked) return true;
    toast('Création d\'un point de restauration (jusqu\'à 1 minute)…', 'info', 8000);
    try {
      const r = await call(window.api.tweaks.restorePoint);
      ctx.state.restorePointDone = true;
      toast(r?.created ? 'Point de restauration créé.' : 'Un point de restauration récent existe déjà : il sera utilisé.', 'success');
      return true;
    } catch (err) {
      // En lecture seule, le refus n'a rien à voir avec le point de restauration : message tel quel.
      toast(err.code === 'READ_ONLY' ? err.message : `${err.message} Décochez l'option pour continuer sans point de restauration.`, 'error', 12000);
      return false;
    }
  }

  function render(root, ctx, data) {
    const box = root.querySelector('#content');
    if (!data.supported) {
      box.innerHTML = `<div class="card empty">${I.info}<div>Les réglages système ne sont disponibles que sous Windows pour le moment.</div></div>`;
      return;
    }
    box.innerHTML = `
      <div class="list">
        ${data.tweaks
          .map((t) => {
            // Déjà actif avant OptiPC : rien à annuler, l'interrupteur est verrouillé.
            const locked = t.applied && !t.canRevert;
            return `
            <div class="list-item">
              <div class="grow">
                <div class="title">${esc(t.title)}
                  <span class="badge info">Impact : ${esc(t.impact)}</span>
                  ${t.needsRelogin ? '<span class="badge">Après reconnexion</span>' : ''}
                  ${locked ? '<span class="badge ok">Déjà actif</span>' : ''}
                </div>
                <div class="desc">${esc(t.description)}</div>
              </div>
              <label class="switch" data-write title="${locked ? 'Ce réglage était déjà actif avant OptiPC' : t.applied ? 'Annuler (restaurer la valeur d\'origine)' : 'Appliquer'}">
                <input type="checkbox" data-id="${esc(t.id)}" ${t.applied ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="${esc(t.title)}">
                <span class="track"></span>
              </label>
            </div>`;
          })
          .join('')}
      </div>
      <p class="faint" style="font-size:12.5px;margin-top:12px">Chaque réglage est réversible : OptiPC sauvegarde la valeur d'origine avant de la modifier et la restaure quand vous désactivez l'interrupteur.</p>`;

    box.querySelectorAll('input[data-id]').forEach((input) => {
      input.addEventListener('change', async () => {
        const wanted = input.checked;
        const all = box.querySelectorAll('input[data-id]');
        all.forEach((i) => { i.disabled = true; });
        try {
          if (wanted) {
            if (!(await ensureRestorePoint(ctx))) throw new Error('');
            const r = await call(window.api.tweaks.apply, input.dataset.id);
            toast(r?.needsRelogin ? 'Réglage appliqué. Il prendra effet à la prochaine ouverture de session.' : 'Réglage appliqué.', 'success');
          } else {
            await call(window.api.tweaks.revert, input.dataset.id);
            toast('Valeur d\'origine restaurée.', 'success');
          }
        } catch (err) {
          if (err.message) toast(err.message, 'error');
        }
        if (alive) load(root, ctx);
      });
    });
  }

  async function load(root, ctx) {
    try {
      const data = await call(window.api.tweaks.list);
      if (alive) render(root, ctx, data);
    } catch (err) {
      if (alive) root.querySelector('#content').innerHTML = `<div class="card empty">${I.alert}<div>${esc(err.message)}</div></div>`;
    }
  }

  window.Pages = window.Pages || {};
  window.Pages.tweaks = {
    title: 'Réglages',
    mount(root, ctx) {
      alive = true;
      const win = ctx.info.isWindows;
      root.innerHTML = `
        <div class="page-header">
          <div><h1>Réglages de performance</h1><p>Optimisations Windows sûres, documentées et réversibles.</p></div>
        </div>
        <div class="card row" style="margin-bottom:18px;flex-wrap:wrap">
          <div style="color:var(--accent)">${I.restore.replace('<svg', '<svg width="28" height="28"')}</div>
          <div class="grow" style="flex:1;min-width:240px">
            <strong>Point de restauration système</strong>
            <div class="muted" style="font-size:13px">Permet de remettre Windows dans son état actuel en cas de problème (nécessite les droits administrateur).</div>
            <label class="row" style="gap:8px;margin-top:8px;cursor:pointer;font-size:13px">
              <input type="checkbox" class="check" id="auto-restore" checked ${win ? '' : 'disabled'}> Créer automatiquement un point avant la première modification
            </label>
          </div>
          <button class="btn" id="restore-btn" data-write ${win ? '' : 'disabled'}>${I.restore} Créer maintenant</button>
        </div>
        <div id="content">${loading('Lecture des réglages…')}</div>`;

      root.querySelector('#restore-btn').addEventListener('click', async (e) => {
        const restore = busy(e.currentTarget, 'Création…');
        try {
          const r = await call(window.api.tweaks.restorePoint);
          ctx.state.restorePointDone = true;
          toast(r?.created ? 'Point de restauration créé.' : r?.message || 'Un point récent existe déjà.', 'success', 8000);
        } catch (err) {
          toast(err.message, 'error', 12000);
        } finally {
          restore();
        }
      });
      load(root, ctx);
    },
    unmount() {
      alive = false;
    },
  };
})();
