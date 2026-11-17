'use strict';

(function () {
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Échappe tout texte inséré dans le HTML (noms de processus, chemins…). */
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  }

  const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

  function fmtBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return `${nf0.format(b)} o`;
    const units = ['Ko', 'Mo', 'Go', 'To'];
    let v = b / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${(v >= 100 ? nf0 : nf1).format(v)} ${units[i]}`;
  }

  function fmtRate(bytesPerSec) {
    return `${fmtBytes(bytesPerSec)}/s`;
  }

  function fmtPct(n) {
    return `${nf0.format(Number(n) || 0)} %`;
  }

  function fmtNum(n) {
    return nf0.format(Number(n) || 0);
  }

  function fmtDate(iso) {
    if (!iso) return 'jamais';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000) return 'jamais';
    return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function fmtAgo(iso) {
    if (!iso) return 'jamais';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t) || new Date(iso).getFullYear() < 2000) return 'jamais';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return "à l'instant";
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    const days = Math.round(s / 86400);
    return `il y a ${days} jour${days > 1 ? 's' : ''}`;
  }

  function fmtUptime(seconds) {
    const s = Number(seconds) || 0;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d} j ${h} h`;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min`;
  }

  /** Appelle l'API du processus principal et lève une erreur lisible en cas d'échec. */
  async function call(fn, ...args) {
    const res = await fn(...args);
    if (!res || !res.ok) {
      const err = new Error(res?.error || 'Erreur inconnue.');
      err.code = res?.code;
      throw err;
    }
    return res.data;
  }

  function toast(message, type = 'info', timeout = 5000) {
    const host = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const dotClass = type === 'error' ? 'crit' : type === 'success' ? 'ok' : 'warn';
    el.innerHTML = `<span class="dot ${dotClass}"></span><div>${esc(message)}</div>`;
    host.appendChild(el);
    setTimeout(() => el.remove(), timeout);
  }

  function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      back.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h3 id="modal-title">${esc(title)}</h3>
          <p>${esc(message)}</p>
          <div class="actions">
            <button class="btn" data-r="0">Annuler</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(confirmLabel)}</button>
          </div>
        </div>`;
      const close = (value) => {
        document.removeEventListener('keydown', onKey);
        back.remove();
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
      };
      back.addEventListener('click', (e) => {
        if (e.target === back) close(false);
        const r = e.target.closest('[data-r]');
        if (r) close(r.dataset.r === '1');
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(back);
      back.querySelector('[data-r="1"]').focus();
    });
  }

  /** Met un bouton en état « occupé » (désactivé + indicateur) et renvoie une fonction de restauration. */
  function busy(button, label) {
    if (!button) return () => {};
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span>${esc(label || '')}`;
    return () => {
      button.disabled = false;
      button.innerHTML = original;
    };
  }

  function loading(text) {
    return `<div class="loading"><span class="spinner lg"></span>${esc(text)}</div>`;
  }

  function levelClass(percent, warn = 75, crit = 90) {
    return percent >= crit ? 'crit' : percent >= warn ? 'warn' : '';
  }

  window.U = { esc, fmtBytes, fmtRate, fmtPct, fmtNum, fmtDate, fmtAgo, fmtUptime, call, toast, confirmDialog, busy, loading, levelClass };
})();
