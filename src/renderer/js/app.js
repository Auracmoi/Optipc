'use strict';

(function () {
  const { esc, call } = window.U;
  const I = window.Icons;

  const NAV = [
    { id: 'dashboard', label: 'Tableau de bord', icon: I.dashboard },
    { id: 'monitor', label: 'Surveillance', icon: I.monitor },
    { id: 'cleaner', label: 'Nettoyage', icon: I.cleaner },
    { id: 'startup', label: 'Démarrage', icon: I.startup },
    { id: 'security', label: 'Sécurité', icon: I.security },
    { id: 'tweaks', label: 'Réglages', icon: I.tweaks },
  ];

  const ctx = {
    info: { isWindows: false, isAdmin: false, platform: 'unknown' },
    state: {}, // état partagé conservé entre les pages (dernier diagnostic, analyses…)
    navigate,
  };
  let current = null;

  function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    const adminText = !ctx.info.isWindows
      ? '<span class="dot warn"></span> Mode aperçu (hors Windows)'
      : ctx.info.isAdmin
        ? '<span class="dot ok"></span> Administrateur'
        : '<span class="dot warn"></span> Droits limités';
    sidebar.innerHTML = `
      ${NAV.map((n) => `<button class="nav-btn" data-page="${n.id}">${n.icon}<span>${esc(n.label)}</span></button>`).join('')}
      <div class="sidebar-footer">
        <div class="admin-state">${adminText}</div>
        <div>${esc(ctx.info.hostname || '')}</div>
      </div>`;
    sidebar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-page]');
      if (b) navigate(b.dataset.page);
    });
  }

  function banner() {
    if (!ctx.info.isWindows) {
      return `<div class="banner info">${I.info}<div>OptiPC est conçu pour Windows. Sur ce système, seule la surveillance en direct fonctionne ; les autres fonctions arriveront avec la version macOS.</div></div>`;
    }
    if (!ctx.info.isAdmin) {
      return `<div class="banner">${I.alert}<div>OptiPC fonctionne sans droits administrateur : certaines fonctions sont limitées (cache Windows Update, démarrage pour tous les utilisateurs, point de restauration…). Faites un clic droit sur OptiPC puis « Exécuter en tant qu'administrateur ».</div></div>`;
    }
    return '';
  }

  function navigate(pageId) {
    const page = window.Pages[pageId];
    if (!page) return;
    if (current) {
      try {
        current.unmount();
      } catch (err) {
        console.error(err);
      }
    }
    document.querySelectorAll('.nav-btn').forEach((b) => {
      const active = b.dataset.page === pageId;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    const main = document.getElementById('main');
    main.innerHTML = banner();
    // Nouveau conteneur à chaque affichage : aucun écouteur d'événement ne s'accumule.
    const root = document.createElement('div');
    main.appendChild(root);
    main.scrollTop = 0;
    current = page;
    document.title = `${page.title} · OptiPC`;
    page.mount(root, ctx);
  }

  async function boot() {
    try {
      ctx.info = await call(window.api.appInfo);
    } catch {
      /* valeurs par défaut */
    }
    renderSidebar();
    navigate('dashboard');
  }

  boot();
})();
