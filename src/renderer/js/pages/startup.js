'use strict';

(function () {
  const { esc, call, toast, loading } = window.U;
  const I = window.Icons;

  let alive = false;

  function render(root, ctx, data) {
    const box = root.querySelector('#content');
    if (!data.supported) {
      box.innerHTML = `<div class="card empty">${I.info}<div>La gestion du démarrage n'est disponible que sous Windows pour le moment.</div></div>`;
      return;
    }
    const enabled = data.items.filter((i) => i.enabled).length;
    root.querySelector('#summary').textContent = `${enabled} programme(s) actif(s) sur ${data.items.length}`;
    if (!data.items.length) {
      box.innerHTML = `<div class="card empty">${I.check}<div>Aucun programme ne se lance au démarrage.</div></div>`;
      return;
    }
    const isAdmin = ctx.info.isAdmin;
    box.innerHTML = `
      <div class="list">
        ${data.items
          .map((i) => {
            const locked = i.requiresAdmin && !isAdmin;
            return `
            <div class="list-item">
              <div class="grow">
                <div class="title">${esc(i.name)} ${i.enabled ? '<span class="badge ok">Actif</span>' : '<span class="badge">Désactivé</span>'}</div>
                <div class="desc">${esc(i.publisher || 'Éditeur inconnu')} · ${esc(i.location)}</div>
                <div class="meta mono ellipsis selectable" title="${esc(i.command)}">${esc(i.command)}</div>
              </div>
              ${locked ? '<span class="badge warn" title="Relancez OptiPC en administrateur">Admin requis</span>' : ''}
              <label class="switch" title="${i.enabled ? 'Désactiver au démarrage' : 'Activer au démarrage'}">
                <input type="checkbox" data-id="${esc(i.id)}" ${i.enabled ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="Lancer ${esc(i.name)} au démarrage">
                <span class="track"></span>
              </label>
            </div>`;
          })
          .join('')}
      </div>
      <p class="faint" style="font-size:12.5px;margin-top:12px">Désactiver un programme ne le désinstalle pas : il ne se lance simplement plus automatiquement. Vous pouvez le réactiver à tout moment. Les modifications prennent effet au prochain démarrage.</p>`;

    box.querySelectorAll('input[data-id]').forEach((input) => {
      input.addEventListener('change', async () => {
        const wanted = input.checked;
        input.disabled = true;
        try {
          await call(window.api.startup.toggle, input.dataset.id, wanted);
          const item = data.items.find((x) => x.id === input.dataset.id);
          if (item) item.enabled = wanted;
          toast(`${item ? item.name : 'Programme'} ${wanted ? 'activé' : 'désactivé'} au démarrage.`, 'success');
          if (alive) render(root, ctx, data);
        } catch (err) {
          input.checked = !wanted;
          input.disabled = false;
          toast(err.message, 'error');
        }
      });
    });
  }

  async function load(root, ctx) {
    root.querySelector('#content').innerHTML = loading('Lecture des programmes au démarrage…');
    try {
      const data = await call(window.api.startup.list);
      if (alive) render(root, ctx, data);
    } catch (err) {
      if (alive) root.querySelector('#content').innerHTML = `<div class="card empty">${I.alert}<div>${esc(err.message)}</div></div>`;
    }
  }

  window.Pages = window.Pages || {};
  window.Pages.startup = {
    title: 'Démarrage',
    mount(root, ctx) {
      alive = true;
      root.innerHTML = `
        <div class="page-header">
          <div><h1>Programmes au démarrage</h1><p id="summary">Moins de programmes au démarrage = un PC prêt plus vite.</p></div>
          <div class="page-actions"><button class="btn" id="reload">${I.refresh} Actualiser</button></div>
        </div>
        <div id="content"></div>`;
      root.querySelector('#reload').addEventListener('click', () => load(root, ctx));
      load(root, ctx);
    },
    unmount() {
      alive = false;
    },
  };
})();
