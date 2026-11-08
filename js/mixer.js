/* RJ-1202 - o mixer (DSP e regras)
 *
 * Roda no AudioWorklet (js/worklet.js) e, igual, no Node (tests/sim.js), para o
 * teste não precisar de som. Não depende de nada do navegador.
 *
 * Dois estágios, porque o Tape (RJ.Tape do dcx-core) fica ENTRE eles:
 *
 *   MixerA  5 canais + Return 1 + Return 2 + entrada direta (RJ-42)
 *           -> main (antes do Tape), Aux 1, Aux 2, barramento de solo
 *   (Tape)  só no master, antes do fader Main
 *   MasterB fader Main, barramento de fones (solo ou main) e medidor
 *
 * Caminho de cada canal (a ordem do 1202-VLZ, pesquisa/mackie-1202vlz-referencia.md):
 *   entrada estéreo -> Trim -> Low Cut -> EQ (Low, Mid, Hi) -+-> Aux 1 PRE (antes do fader e do mute)
 *                                                           +-> solo (PFL: depois do EQ, antes do fader)
 *                                                           -> fader -> Mute -+-> Aux 1 POST, Aux 2
 *                                                                             -> Pan -> main
 *
 * Valores dos controles: knobs de 0 a 1 (centro = 0,5 = detente "U" ou plano), faders de 0 a 1
 * (U em 0,75), teclas 0 ou 1. As funções de mapa (levelDb, faderDb...) são as do mockup aprovado.
 *
 * Escala dos medidores: 0 dB do medidor = -12 dBFS; +10 = -2 dBFS; CLIP = perto de 0 dBFS.
 */
(function (g) {
  "use strict";
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dbToGain = db => Math.pow(10, db / 20);

  /* ------------------------------------------------------------------ fontes e regras */

  /** Fontes que um canal pode escolher. O RJ-42 não entra: vai direto ao master. */
  const SOURCES = [
    { id: "rj2000",  name: "RJ-2000", sub: "inteiro" },
    { id: "rj2000a", name: "2000 · A", sub: "banco A" },
    { id: "rj2000b", name: "2000 · B", sub: "banco B" },
    { id: "rj2000c", name: "2000 · C", sub: "banco C" },
    { id: "rj2000d", name: "2000 · D", sub: "banco D" },
    { id: "rj950",   name: "RJ-950",  sub: "sampler" },
    { id: "dcx404",  name: "DCX 404", sub: "pads" },
    { id: "line",    name: "Line",    sub: "mic / line" },
  ];
  const srcIndex = id => SOURCES.findIndex(s => s.id === id);
  const NCH = 5;
  const CH_CTRLS = ["source", "trim", "lowcut", "aux1", "aux2", "hi", "mid", "low", "pan", "mute", "solo", "fader"];
  const MASTER_CTRLS = ["aux1-master", "ret1", "ret2", "tape", "phones", "main"];

  /** Todos os controles que aprendem pelo MIDI Learn: 12 por canal + 6 do master = 66. */
  function learnIds() {
    const ids = [];
    for (let c = 1; c <= NCH; c++) CH_CTRLS.forEach(k => ids.push("ch" + c + "-" + k));
    return ids.concat(MASTER_CTRLS);
  }

  /** O DCX 404 como fonte trava o Aux 1 do canal em zero (senão o 404 realimenta a si mesmo). */
  const aux1Locked = srcId => srcId === "dcx404";

  /** Estado de partida. Tudo no U ou plano; fontes da mostra do mockup. */
  function defaultState() {
    const ch = (src) => ({ src, trim: 0.2, lowcut: 0, aux1: 0, aux2: 0, hi: 0.5, mid: 0.5, low: 0.5, pan: 0.5, mute: 0, solo: 0, fader: 0.75 });
    return {
      v: 1,
      ch: [ch("rj2000a"), ch("rj2000b"), ch("rj950"), ch("dcx404"), ch("line")],
      aux1m: 0.5, aux1post: 1, ret1: 0.5, ret2: 0, tape: 0, phones: 0.5, main: 0.75,
    };
  }

  /** Lê um estado salvo (JSON ou objeto) e devolve um estado válido: o que faltar ou vier errado volta ao padrão. */
  function sanitize(raw) {
    const d = defaultState();
    let s = raw;
    if (typeof s === "string") { try { s = JSON.parse(s); } catch (e) { return d; } }
    if (!s || typeof s !== "object") return d;
    const num = (v, def) => (typeof v === "number" && isFinite(v) ? clamp(v, 0, 1) : def);
    const bit = (v, def) => (v === 0 || v === 1 || v === true || v === false ? (v ? 1 : 0) : def);
    ["aux1m", "ret1", "ret2", "tape", "phones", "main"].forEach(k => { d[k] = num(s[k], d[k]); });
    d.aux1post = bit(s.aux1post, d.aux1post);
    if (Array.isArray(s.ch)) d.ch.forEach((c, i) => {
      const r = s.ch[i];
      if (!r || typeof r !== "object") return;
      if (srcIndex(r.src) >= 0) c.src = r.src;
      ["trim", "aux1", "aux2", "hi", "mid", "low", "pan", "fader"].forEach(k => { c[k] = num(r[k], c[k]); });
      ["lowcut", "mute", "solo"].forEach(k => { c[k] = bit(r[k], c[k]); });
    });
    return d;
  }

  /* ------------------------------------------------------------------ mapas dos controles */

  /** Knob de nível: apagado em 0, U no centro, `max` dB no fim. Abaixo do centro, -40 dB. */
  function levelDb(t, max) { return t < 0.01 ? -Infinity : t >= 0.5 ? (t - 0.5) / 0.5 * max : -40 * (0.5 - t) / 0.5; }
  /** Fader: apagado perto de 0, U em 0,75, +10 dB no topo, -60 dB em 0,0. */
  function faderDb(v) { return v < 0.01 ? -Infinity : v >= 0.75 ? (v - 0.75) / 0.25 * 10 : -60 * (0.75 - v) / 0.75; }
  const trimDb = t => -10 + 50 * t;            // -10 a +40 dB; U (0 dB) em t = 0,2
  const eqDb = (t, range) => (t * 2 - 1) * range;
  const gainOf = db => (db === -Infinity ? 0 : dbToGain(db));
  const levelGain = (t, max) => gainOf(levelDb(t, max));
  const faderGain = v => gainOf(faderDb(v));

  /**
   * Pan de loudness constante, 4 dB abaixo no centro (manual p.19). Em cada lado, cos/sin^(4/3):
   * no centro 0,707^(4/3) = -4,0 dB; no canto, 0 dB e o outro lado zero. O canal é estéreo, então o lado
   * esquerdo da entrada vai com o ganho esquerdo, o direito com o direito (um balanço; com a mesma
   * coisa nos dois lados é o pan de um canal mono).
   */
  function panGains(t) {
    if (t <= 0) return [1, 0];
    if (t >= 1) return [0, 1];
    const th = t * Math.PI / 2;
    return [Math.pow(Math.cos(th), 4 / 3), Math.pow(Math.sin(th), 4 / 3)];
  }

  /* ------------------------------------------------------------------ filtros */

  class Biquad {
    constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
    set(b0, b1, b2, a0, a1, a2) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; }
    reset() { this.x1 = this.x2 = this.y1 = this.y2 = 0; }
    run(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      return y;
    }
    /** Resposta em magnitude (ganho linear) na frequência f. */
    mag(f, fs) {
      const w = 2 * Math.PI * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
      const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2);
      const dr = 1 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
      return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
  }

  // Coeficientes do Audio EQ Cookbook (Robert Bristow-Johnson), escritos aqui.
  function lowShelf(bq, f0, db, fs) {
    const A = Math.pow(10, db / 40), w = 2 * Math.PI * f0 / fs, cs = Math.cos(w), sn = Math.sin(w);
    const al = sn / 2 * Math.SQRT2, sA = 2 * Math.sqrt(A) * al;   // inclinação S = 1
    bq.set(A * ((A + 1) - (A - 1) * cs + sA), 2 * A * ((A - 1) - (A + 1) * cs), A * ((A + 1) - (A - 1) * cs - sA),
      (A + 1) + (A - 1) * cs + sA, -2 * ((A - 1) + (A + 1) * cs), (A + 1) + (A - 1) * cs - sA);
  }
  function highShelf(bq, f0, db, fs) {
    const A = Math.pow(10, db / 40), w = 2 * Math.PI * f0 / fs, cs = Math.cos(w), sn = Math.sin(w);
    const al = sn / 2 * Math.SQRT2, sA = 2 * Math.sqrt(A) * al;
    bq.set(A * ((A + 1) + (A - 1) * cs + sA), -2 * A * ((A - 1) + (A + 1) * cs), A * ((A + 1) + (A - 1) * cs - sA),
      (A + 1) - (A - 1) * cs + sA, 2 * ((A - 1) - (A + 1) * cs), (A + 1) - (A - 1) * cs - sA);
  }
  function peaking(bq, f0, db, Q, fs) {
    const A = Math.pow(10, db / 40), w = 2 * Math.PI * f0 / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * Q);
    bq.set(1 + al * A, -2 * cs, 1 - al * A, 1 + al / A, -2 * cs, 1 - al / A);
  }
  function highPass(bq, f0, Q, fs) {
    const w = 2 * Math.PI * f0 / fs, cs = Math.cos(w), al = Math.sin(w) / (2 * Q);
    bq.set((1 + cs) / 2, -(1 + cs), (1 + cs) / 2, 1 + al, -2 * cs, 1 - al);
  }
  /** Passa-altas de 1ª ordem (bilinear) como um biquad. */
  function highPass1(bq, f0, fs) {
    const K = Math.tan(Math.PI * f0 / fs);
    bq.set(1, -1, 0, 1 + K, K - 1, 0);
  }

  const EQ = { lowHz: 80, midHz: 2500, hiHz: 12000, lowRange: 15, midRange: 12, hiRange: 15, midQ: 0.7 };   // Q do médio: o manual não publica
  const LOWCUT_HZ = 75;                    // 18 dB/oitava = Butterworth de 3ª ordem
  const SMOOTH_MS = 5;

  /* ------------------------------------------------------------------ canal */

  class Channel {
    constructor(fs, st) {
      this.fs = fs;
      this.k = 1 - Math.exp(-1 / (SMOOTH_MS / 1000 * fs));
      this.src = st.src;
      this.t = { trim: st.trim, lowcut: st.lowcut, aux1: st.aux1, aux2: st.aux2, hi: st.hi, mid: st.mid, low: st.low, pan: st.pan, mute: st.mute, solo: st.solo, fader: st.fader };
      this.lock = aux1Locked(st.src);
      // ganhos suavizados (por amostra)
      this.gTrim = dbToGain(trimDb(st.trim));
      this.gFadRaw = faderGain(st.fader);
      this.gMute = st.mute ? 0 : 1;
      this.gA1 = this.lock ? 0 : levelGain(st.aux1, 15);
      this.gA2 = levelGain(st.aux2, 15);
      [this.gPl, this.gPr] = panGains(st.pan);
      this.gLc = st.lowcut ? 1 : 0;
      // filtros (um conjunto por lado)
      this.lc2 = [new Biquad(), new Biquad()];
      this.lc1 = [new Biquad(), new Biquad()];
      this.eqLow = [new Biquad(), new Biquad()];
      this.eqMid = [new Biquad(), new Biquad()];
      this.eqHi = [new Biquad(), new Biquad()];
      this.dLow = eqDb(st.low, EQ.lowRange); this.dMid = eqDb(st.mid, EQ.midRange); this.dHi = eqDb(st.hi, EQ.hiRange);   // dB atuais (suavizados por bloco)
      this.on = { low: false, mid: false, hi: false };
      this.lowcut = !!st.lowcut;
      lc(this);
      this.updateEq(true);
      this.peak = 0;       // pico depois do EQ e antes do fader (Sig, OL, solo), desde a última leitura
      this.sig = 0;
    }
    set(name, v) {
      if (name === "src") { this.src = v; this.lock = aux1Locked(v); return; }
      this.t[name] = v;
      if (name === "lowcut") { this.lowcut = !!v; if (!v) { this.lc2.forEach(b => b.reset()); this.lc1.forEach(b => b.reset()); } }
    }
    /** Coeficientes do EQ para o dB atual de cada banda. Banda em 0 dB fica de fora (cópia exata). */
    updateEq(force) {
      const t = this.t, fs = this.fs;
      const tg = { low: eqDb(t.low, EQ.lowRange), mid: eqDb(t.mid, EQ.midRange), hi: eqDb(t.hi, EQ.hiRange) };
      const step = (cur, target) => { const d = target - cur; return Math.abs(d) < 0.005 ? target : cur + d * 0.35; };   // chega em poucos blocos, sem degrau
      const nl = force ? tg.low : step(this.dLow, tg.low), nm = force ? tg.mid : step(this.dMid, tg.mid), nh = force ? tg.hi : step(this.dHi, tg.hi);
      if (nl !== this.dLow || force) { this.dLow = nl; this.on.low = Math.abs(nl) > 1e-4; if (this.on.low) this.eqLow.forEach(b => lowShelf(b, EQ.lowHz, nl, fs)); else this.eqLow.forEach(b => b.reset()); }
      if (nm !== this.dMid || force) { this.dMid = nm; this.on.mid = Math.abs(nm) > 1e-4; if (this.on.mid) this.eqMid.forEach(b => peaking(b, EQ.midHz, nm, EQ.midQ, fs)); else this.eqMid.forEach(b => b.reset()); }
      if (nh !== this.dHi || force) { this.dHi = nh; this.on.hi = Math.abs(nh) > 1e-4; if (this.on.hi) this.eqHi.forEach(b => highShelf(b, EQ.hiHz, nh, fs)); else this.eqHi.forEach(b => b.reset()); }
    }
    get settling() { const t = this.t; return Math.abs(this.dLow - eqDb(t.low, EQ.lowRange)) > 0.004 || Math.abs(this.dMid - eqDb(t.mid, EQ.midRange)) > 0.004 || Math.abs(this.dHi - eqDb(t.hi, EQ.hiRange)) > 0.004; }
  }
  function lc(ch) {
    ch.lc2.forEach(b => highPass(b, LOWCUT_HZ, 1, ch.fs));
    ch.lc1.forEach(b => highPass1(b, LOWCUT_HZ, ch.fs));
  }

  /* ------------------------------------------------------------------ estágio A */

  class MixerA {
    /** fs: taxa de amostragem. st: estado (sanitize). */
    constructor(fs, st) {
      st = sanitize(st);
      this.fs = fs;
      this.k = 1 - Math.exp(-1 / (SMOOTH_MS / 1000 * fs));
      this.ch = st.ch.map(c => new Channel(fs, c));
      this.t = { aux1m: st.aux1m, aux1post: st.aux1post, ret1: st.ret1, ret2: st.ret2 };
      this.gM = levelGain(st.aux1m, 10);
      this.gR1 = levelGain(st.ret1, 20);
      this.gR2 = levelGain(st.ret2, 20);
      this.rpk = [0, 0];   // pico dos retornos
      this.anySolo = false;
      this.blocks = 0;
    }
    setCh(i, name, v) { if (this.ch[i]) this.ch[i].set(name, v); }
    setGlobal(name, v) { this.t[name] = v; }

    /**
     * ins: 8 entradas [canal 1..5, Return 1, Return 2, direta], cada uma [L, R] (ou vazia = silêncio).
     * outs: { main: [L, R], aux1: [a], aux2: [a], solo: [L, R] }. Substitui o conteúdo.
     */
    process(ins, outs, n) {
      const k = this.k, mL = outs.main[0], mR = outs.main[1], a1 = outs.aux1[0], a2 = outs.aux2[0], sL = outs.solo[0], sR = outs.solo[1];
      mL.fill(0, 0, n); mR.fill(0, 0, n); a1.fill(0, 0, n); a2.fill(0, 0, n); sL.fill(0, 0, n); sR.fill(0, 0, n);
      const post = this.t.aux1post ? 1 : 0;
      const tM = levelGain(this.t.aux1m, 10), gM0 = this.gM, gM1 = gM0 + (tM - gM0) * (1 - Math.pow(1 - k, n)), dgM = (gM1 - gM0) / n;
      let anySolo = false;
      for (let ci = 0; ci < NCH; ci++) {
        const c = this.ch[ci], t = c.t;
        const inp = ins[ci] || [], xl = inp[0], xr = inp[1] || inp[0];
        c.updateEq(false);
        const tTrim = dbToGain(trimDb(t.trim)), tFad = faderGain(t.fader), tMute = t.mute ? 0 : 1;
        const tA1 = c.lock ? 0 : levelGain(t.aux1, 15), tA2 = levelGain(t.aux2, 15);
        const [tPl, tPr] = panGains(t.pan);
        const lcOn = c.lowcut, eq = c.on, solo = !!t.solo;
        if (solo) anySolo = true;
        let pk = 0;
        for (let i = 0; i < n; i++) {
          c.gTrim += (tTrim - c.gTrim) * k; c.gFadRaw += (tFad - c.gFadRaw) * k; c.gMute += (tMute - c.gMute) * k;
          c.gA1 += (tA1 - c.gA1) * k; c.gA2 += (tA2 - c.gA2) * k; c.gPl += (tPl - c.gPl) * k; c.gPr += (tPr - c.gPr) * k;
          let l = (xl ? xl[i] : 0) * c.gTrim, r = (xr ? xr[i] : 0) * c.gTrim;
          if (lcOn) { l = c.lc1[0].run(c.lc2[0].run(l)); r = c.lc1[1].run(c.lc2[1].run(r)); }
          if (eq.low) { l = c.eqLow[0].run(l); r = c.eqLow[1].run(r); }
          if (eq.mid) { l = c.eqMid[0].run(l); r = c.eqMid[1].run(r); }
          if (eq.hi) { l = c.eqHi[0].run(l); r = c.eqHi[1].run(r); }
          const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
          if (al > pk) pk = al; if (ar > pk) pk = ar;
          // Aux 1 PRE: depois do EQ, antes do fader e do mute
          let aux = 0;
          if (!post) aux += (l + r) * 0.5 * c.gA1;
          if (solo) { sL[i] += l; sR[i] += r; }
          const fg = c.gFadRaw * c.gMute, yl = l * fg, yr = r * fg;
          const mono = (yl + yr) * 0.5;
          if (post) aux += mono * c.gA1;
          a1[i] += aux * (gM0 + dgM * (i + 1));
          a2[i] += mono * c.gA2;
          mL[i] += yl * c.gPl; mR[i] += yr * c.gPr;
        }
        if (pk > c.peak) c.peak = pk;
      }
      this.gM = gM1;   // Aux 1 Master: rampa linear dentro do bloco (o knob é de ajuste, não de gesto)
      // retornos e entrada direta vão direto ao main
      const tR1 = levelGain(this.t.ret1, 20), tR2 = levelGain(this.t.ret2, 20);
      for (let ri = 0; ri < 3; ri++) {
        const inp = ins[NCH + ri] || [], xl = inp[0], xr = inp[1] || inp[0];
        if (!xl) continue;
        let pk = 0;
        for (let i = 0; i < n; i++) {
          if (ri === 0) this.gR1 += (tR1 - this.gR1) * k; else if (ri === 1) this.gR2 += (tR2 - this.gR2) * k;
          const gg = ri === 0 ? this.gR1 : ri === 1 ? this.gR2 : 1;
          const l = xl[i] * gg, r = xr[i] * gg;
          mL[i] += l; mR[i] += r;
          const al = l < 0 ? -l : l; if (al > pk) pk = al;
        }
        if (ri < 2 && pk > this.rpk[ri]) this.rpk[ri] = pk;
      }
      this.anySolo = anySolo;
      this.blocks++;
    }

    /** Picos desde a última leitura (e zera): canais (depois do EQ, antes do fader) e retornos. */
    readPeaks() {
      const out = { ch: this.ch.map(c => c.peak), ret: this.rpk.slice(), solo: this.anySolo };
      this.ch.forEach(c => { c.peak = 0; });
      this.rpk = [0, 0];
      return out;
    }
  }

  /* ------------------------------------------------------------------ estágio B (master) */

  class MasterB {
    constructor(fs, st) {
      st = sanitize(st);
      this.fs = fs;
      this.k = 1 - Math.exp(-1 / (SMOOTH_MS / 1000 * fs));
      this.t = { main: st.main, phones: st.phones, solo: 0 };
      this.gMain = faderGain(st.main);
      this.gPh = levelGain(st.phones, 10);
      this.solo = 0;          // 0..1, rampa entre main e solo no barramento de fones/medidor
      this.pkMain = [0, 0]; this.pkSolo = [0, 0];
    }
    set(name, v) { this.t[name] = v; }
    /** ins: { main: [L, R] (saída do Tape), solo: [L, R] }. outs: { main: [L, R], phones: [L, R] }. */
    process(ins, outs, n) {
      const k = this.k, tG = faderGain(this.t.main), tP = levelGain(this.t.phones, 10), tS = this.t.solo ? 1 : 0;
      const iL = ins.main[0], iR = ins.main[1] || ins.main[0], sL = ins.solo[0], sR = ins.solo[1] || ins.solo[0];
      const oL = outs.main[0], oR = outs.main[1], pL = outs.phones[0], pR = outs.phones[1];
      let mpl = 0, mpr = 0, spl = 0, spr = 0;
      for (let i = 0; i < n; i++) {
        this.gMain += (tG - this.gMain) * k; this.gPh += (tP - this.gPh) * k; this.solo += (tS - this.solo) * k * 2;
        const l = (iL ? iL[i] : 0) * this.gMain, r = (iR ? iR[i] : 0) * this.gMain;
        oL[i] = l; oR[i] = r;
        const xl = sL ? sL[i] : 0, xr = sR ? sR[i] : 0;
        pL[i] = (l + (xl - l) * this.solo) * this.gPh; pR[i] = (r + (xr - r) * this.solo) * this.gPh;
        const a = l < 0 ? -l : l, b = r < 0 ? -r : r;
        if (a > mpl) mpl = a; if (b > mpr) mpr = b;
        const c = xl < 0 ? -xl : xl, d = xr < 0 ? -xr : xr;
        if (c > spl) spl = c; if (d > spr) spr = d;
      }
      if (mpl > this.pkMain[0]) this.pkMain[0] = mpl; if (mpr > this.pkMain[1]) this.pkMain[1] = mpr;
      if (spl > this.pkSolo[0]) this.pkSolo[0] = spl; if (spr > this.pkSolo[1]) this.pkSolo[1] = spr;
    }
    readPeaks() {
      const o = { main: this.pkMain.slice(), solo: this.pkSolo.slice() };
      this.pkMain = [0, 0]; this.pkSolo = [0, 0];
      return o;
    }
  }

  /* ------------------------------------------------------------------ medidor */

  /** Escala do medidor: 0 dB = -12 dBFS. Devolve dB do medidor. */
  const METER_REF = -12;
  const meterDb = peak => (peak <= 0 ? -Infinity : 20 * Math.log10(peak) - METER_REF);
  /** Limiar de cada um dos 12 LEDs, do alto (CLIP) para baixo. */
  const METER_DB = [28, 10, 7, 4, 2, 0, -2, -4, -7, -10, -20, -30];
  const CLIP_PEAK = 0.97;      // CLIP: pico perto de 0 dBFS (a escala impressa põe CLIP em +28, bem acima do +10)
  /** Quais LEDs acendem para um pico (0 a 1). Retorna um array de 12 booleanos. */
  function meterLeds(peak) {
    const d = meterDb(peak);
    return METER_DB.map((th, i) => (i === 0 ? peak >= CLIP_PEAK : d >= th));
  }
  const SIG_PEAK = dbToGain(-45), OL_PEAK = dbToGain(-3);   // LEDs Sig e OL do canal (depois do EQ, antes do fader)

  const api = {
    SOURCES, srcIndex, NCH, CH_CTRLS, MASTER_CTRLS, learnIds, aux1Locked, defaultState, sanitize,
    levelDb, faderDb, trimDb, eqDb, levelGain, faderGain, panGains, dbToGain,
    Biquad, lowShelf, highShelf, peaking, highPass, highPass1, EQ, LOWCUT_HZ,
    MixerA, MasterB, meterDb, meterLeds, METER_DB, METER_REF, CLIP_PEAK, SIG_PEAK, OL_PEAK,
  };
  const ns = typeof module === "object" && module.exports ? module.exports : (g.RJ1202 = g.RJ1202 || {});
  Object.assign(ns, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
