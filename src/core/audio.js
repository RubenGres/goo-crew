// Fully procedural audio: Web Audio oscillators + filtered noise. No files.
// Every call is fire-and-forget; the context lazily resumes on first gesture.

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.muted = false;
    this._musicTimer = null;
    this._noiseBuf = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    // shared noise buffer
    const len = this.ctx.sampleRate * 1.2;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
    this._startMusic();
    return true;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  }

  _osc(type, freq, t0, dur, gain = 0.2, freqEnd = null, dest = null) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  _noise(t0, dur, gain = 0.3, filterFreq = 1200, filterEnd = null, type = "lowpass") {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filterFreq, t0);
    if (filterEnd != null) f.frequency.exponentialRampToValueAtTime(Math.max(20, filterEnd), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t0, Math.random() * 0.8);
    src.stop(t0 + dur + 0.02);
  }

  play(name) {
    if (!this.ensure() || this.muted) return;
    const t = this.ctx.currentTime + 0.001;
    switch (name) {
      case "ui":
        this._osc("square", 660, t, 0.06, 0.06, 880);
        break;
      case "uiBack":
        this._osc("square", 440, t, 0.07, 0.06, 300);
        break;
      case "select":
        this._osc("sine", 520, t, 0.09, 0.12, 760);
        break;
      case "order":
        this._osc("sine", 380, t, 0.08, 0.1, 560);
        this._osc("sine", 570, t + 0.06, 0.08, 0.08, 760);
        break;
      case "power":
        this._osc("square", 220, t, 0.05, 0.08, 330);
        break;
      case "laser":
        this._osc("sawtooth", 900, t, 0.18, 0.16, 140);
        this._osc("square", 1300, t, 0.1, 0.07, 300);
        break;
      case "missile":
        this._noise(t, 0.5, 0.22, 400, 3200, "bandpass");
        this._osc("sawtooth", 180, t, 0.5, 0.1, 90);
        break;
      case "hitHull":
        this._noise(t, 0.4, 0.5, 900, 90);
        this._osc("sine", 120, t, 0.3, 0.35, 40);
        break;
      case "hitShield":
        this._osc("sine", 900, t, 0.25, 0.2, 400);
        this._osc("sine", 1350, t, 0.18, 0.12, 600);
        break;
      case "miss":
        this._noise(t, 0.25, 0.12, 2400, 600, "bandpass");
        break;
      case "explosion":
        this._noise(t, 1.1, 0.7, 1400, 60);
        this._osc("sine", 90, t, 0.8, 0.5, 30);
        break;
      case "fire":
        this._noise(t, 0.6, 0.14, 800, 500, "bandpass");
        break;
      case "alarm":
        this._osc("square", 620, t, 0.16, 0.07);
        this._osc("square", 470, t + 0.18, 0.16, 0.07);
        break;
      case "repair":
        this._osc("square", 190 + Math.random() * 60, t, 0.05, 0.09, 120);
        break;
      case "heal":
        this._osc("sine", 700, t, 0.2, 0.07, 1050);
        break;
      case "door":
        this._noise(t, 0.12, 0.1, 2600, 900, "bandpass");
        break;
      case "jump":
        this._osc("sawtooth", 120, t, 1.3, 0.16, 1400);
        this._noise(t + 0.4, 1.0, 0.3, 500, 5200, "bandpass");
        break;
      case "ftlReady":
        this._osc("sine", 520, t, 0.14, 0.12, 620);
        this._osc("sine", 780, t + 0.14, 0.22, 0.12, 1040);
        break;
      case "scrap":
        this._osc("square", 880, t, 0.06, 0.09, 1180);
        this._osc("square", 1320, t + 0.07, 0.09, 0.09, 1760);
        break;
      case "crewDie":
        this._osc("sawtooth", 320, t, 0.7, 0.14, 60);
        break;
      case "victory":
        [523, 659, 784, 1046].forEach((f, i) => this._osc("square", f, t + i * 0.13, 0.3, 0.1));
        break;
      case "defeat":
        [392, 330, 262, 196].forEach((f, i) => this._osc("sawtooth", f, t + i * 0.22, 0.4, 0.1));
        break;
    }
  }

  // Slow ambient pad: a random minor chord swells every few seconds.
  _startMusic() {
    const chords = [
      [110, 130.8, 164.8],
      [98, 123.5, 146.8],
      [87.3, 110, 130.8],
      [116.5, 146.8, 174.6],
    ];
    let idx = 0;
    const step = () => {
      if (!this.ctx || this.ctx.state !== "running") return;
      const chord = chords[idx % chords.length];
      idx += Math.random() < 0.6 ? 1 : 2;
      const t = this.ctx.currentTime;
      for (const f of chord) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "triangle";
        o.frequency.value = f * (Math.random() < 0.3 ? 2 : 1);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 2.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 7.5);
        o.connect(g);
        g.connect(this.musicGain);
        o.start(t);
        o.stop(t + 8);
      }
    };
    step();
    this._musicTimer = setInterval(step, 6000);
  }
}

export const sfx = new Sfx();
