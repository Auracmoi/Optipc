'use strict';

(function () {
  /** Courbe temps réel légère dessinée sur <canvas> (aucune dépendance externe). */
  class Sparkline {
    constructor(canvas, { capacity = 60, max = 100, colors = ['#3fb6ff', '#8b7bff'], autoScale = false } = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.capacity = capacity;
      this.max = max;
      this.autoScale = autoScale;
      this.colors = colors;
      this.values = [];
    }

    push(value) {
      this.values.push(Number.isFinite(value) ? value : 0);
      if (this.values.length > this.capacity) this.values.shift();
      this.draw();
    }

    draw() {
      const { canvas, ctx } = this;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Lignes de repère
      ctx.strokeStyle = 'rgba(154,167,182,0.12)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = Math.round((h * i) / 4) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const n = this.values.length;
      if (n < 2) return;
      const max = this.autoScale ? Math.max(1, ...this.values) * 1.15 : this.max;
      const step = w / (this.capacity - 1);
      const x0 = w - (n - 1) * step;
      const pts = this.values.map((v, i) => [x0 + i * step, h - 2 - (Math.min(v, max) / max) * (h - 4)]);

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, this.colors[0]);
      grad.addColorStop(1, this.colors[1] || this.colors[0]);

      const fill = ctx.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, 'rgba(63,182,255,0.28)');
      fill.addColorStop(1, 'rgba(139,123,255,0)');

      ctx.beginPath();
      ctx.moveTo(pts[0][0], h);
      pts.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(pts[n - 1][0], h);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  /** Anneau de score (0-100) en SVG. */
  function scoreRing(score) {
    const r = 86;
    const c = 2 * Math.PI * r;
    const s = Math.max(0, Math.min(100, Number(score) || 0));
    const color = s >= 80 ? '#3fcf8e' : s >= 55 ? '#f5b84a' : '#ff6b6b';
    return `
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="${r}" fill="none" stroke="#212b38" stroke-width="14"/>
        <circle cx="100" cy="100" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - s / 100)}" style="transition: stroke-dashoffset 1s ease"/>
      </svg>`;
  }

  window.Charts = { Sparkline, scoreRing };
})();
