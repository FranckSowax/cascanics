/* ==========================================================================
   CASCANICS — scrub.js
   Chargement des séquences de frames WebP + rendu cover dans un <canvas>.
   ========================================================================== */

const MOBILE_QUERY = "(max-width: 767px)";

export function isMobile() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

export class FrameScrubber {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} opts
   * @param {string} opts.path        Dossier des frames desktop (ex: "frames/seg1")
   * @param {number} opts.count       Nombre de frames du set
   */
  constructor(canvas, { path, count }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.base = isMobile() ? `${path}/m` : path;
    this.count = count;
    this.frames = new Array(count).fill(null);
    this.current = 0;
    this.loadedCount = 0;
    this._restStarted = false;

    this._onResize = () => this.resize();
    window.addEventListener("resize", this._onResize, { passive: true });
    this.resize();
  }

  src(i) {
    return `${this.base}/frame_${String(i + 1).padStart(3, "0")}.webp`;
  }

  _loadOne(i) {
    if (this.frames[i]) return Promise.resolve(this.frames[i]);
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        this.frames[i] = img;
        this.loadedCount++;
        // Si la frame affichée attendait celle-ci, redessiner
        if (Math.round(this.current) === i) this.draw(this.current);
        resolve(img);
      };
      img.onerror = () => resolve(null);
      img.src = this.src(i);
    });
  }

  /** Charge les `n` premières frames (priorité), avec callback de progression. */
  async loadPriority(n, onProgress) {
    const target = Math.min(n, this.count);
    let done = 0;
    const CONCURRENCY = 6;
    const queue = Array.from({ length: target }, (_, i) => i);
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const i = queue.shift();
        await this._loadOne(i);
        done++;
        if (onProgress) onProgress(done / target);
      }
    });
    await Promise.all(workers);
  }

  /** Charge le reste du set par petits lots pendant les temps morts. */
  loadRest() {
    if (this._restStarted) return Promise.resolve();
    this._restStarted = true;
    return new Promise((resolve) => {
      const pending = [];
      for (let i = 0; i < this.count; i++) if (!this.frames[i]) pending.push(i);
      const CHUNK = 10;
      const step = () => {
        if (!pending.length) { resolve(); return; }
        const batch = pending.splice(0, CHUNK);
        Promise.all(batch.map((i) => this._loadOne(i))).then(() => {
          if ("requestIdleCallback" in window) {
            requestIdleCallback(step, { timeout: 500 });
          } else {
            setTimeout(step, 60);
          }
        });
      };
      step();
    });
  }

  /** Frame chargée la plus proche de l'index demandé (évite les trous). */
  _nearestLoaded(i) {
    if (this.frames[i]) return i;
    for (let d = 1; d < this.count; d++) {
      if (i - d >= 0 && this.frames[i - d]) return i - d;
      if (i + d < this.count && this.frames[i + d]) return i + d;
    }
    return -1;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, isMobile() ? 1.5 : 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.draw(this.current);
  }

  /** Dessine la frame `f` (index flottant accepté) en cover plein canvas. */
  draw(f) {
    this.current = f;
    const idx = this._nearestLoaded(
      Math.max(0, Math.min(this.count - 1, Math.round(f)))
    );
    if (idx < 0) return;
    const img = this.frames[idx];
    const { width: cw, height: ch } = this.canvas;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    this.ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }
}
