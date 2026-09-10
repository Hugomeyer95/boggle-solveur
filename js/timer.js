/**
 * Minuteur de manche.
 *
 * Le décompte est calculé à partir d'un horodatage de fin, pas d'un compteur
 * décrémenté : il reste juste même si iOS met l'onglet en veille pendant la
 * partie. On garde l'écran allumé via Wake Lock quand le navigateur le permet.
 */

export class RoundTimer {
  /**
   * @param {{onTick:(remainingMs:number, ratio:number)=>void, onEnd:()=>void}} handlers
   */
  constructor({ onTick, onEnd }) {
    this.onTick = onTick;
    this.onEnd = onEnd;
    this.durationMs = 180000;
    this.remainingMs = 180000;
    this.endsAt = 0;
    this.running = false;
    this._raf = 0;
    this._wakeLock = null;
    this._audio = null;
  }

  get ratio() {
    return this.durationMs ? this.remainingMs / this.durationMs : 0;
  }

  /** Définit la durée (en secondes). Sans effet pendant une manche. */
  setDuration(seconds) {
    if (this.running) return;
    this.durationMs = Math.max(5000, Math.min(3600000, Math.round(seconds) * 1000));
    this.remainingMs = this.durationMs;
    this.onTick(this.remainingMs, this.ratio);
  }

  start() {
    if (this.running || this.remainingMs <= 0) return;
    this._unlockAudio();
    this.endsAt = Date.now() + this.remainingMs;
    this.running = true;
    this._requestWakeLock();
    this._loop();
  }

  pause() {
    if (!this.running) return;
    this.remainingMs = Math.max(0, this.endsAt - Date.now());
    this.running = false;
    cancelAnimationFrame(this._raf);
    this._releaseWakeLock();
    this.onTick(this.remainingMs, this.ratio);
  }

  reset() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this._releaseWakeLock();
    this.remainingMs = this.durationMs;
    this.onTick(this.remainingMs, this.ratio);
  }

  _loop = () => {
    if (!this.running) return;
    this.remainingMs = Math.max(0, this.endsAt - Date.now());
    this.onTick(this.remainingMs, this.ratio);
    if (this.remainingMs <= 0) {
      this.running = false;
      this._releaseWakeLock();
      this.chime();
      this.onEnd();
      return;
    }
    this._raf = requestAnimationFrame(this._loop);
  };

  /* ------------------------------------------------------------ écran */

  async _requestWakeLock() {
    try {
      if ('wakeLock' in navigator) this._wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* refusé ou non supporté : sans conséquence */ }
  }

  _releaseWakeLock() {
    try { this._wakeLock?.release(); } catch { /* ignore */ }
    this._wakeLock = null;
  }

  /** À rappeler quand l'app redevient visible : iOS relâche le verrou. */
  async refreshWakeLock() {
    if (this.running && !this._wakeLock) await this._requestWakeLock();
  }

  /* ------------------------------------------------------------- son */

  /** Le contexte audio doit naître d'un geste utilisateur sur iOS. */
  _unlockAudio() {
    if (!this._audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this._audio = new Ctx();
    }
    this._audio?.resume?.();
  }

  /** Trois notes ascendantes à la fin de la manche. */
  chime() {
    const ctx = this._audio;
    if (!ctx) return;
    const now = ctx.currentTime;
    [880, 1108.73, 1318.51].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }
}

/** Formate un nombre de millisecondes en MM:SS. */
export function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
