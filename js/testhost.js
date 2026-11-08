/* RJ-1202 - host de teste (só na página solo)
 *
 * O mixer solo não tem as outras máquinas. Este arquivo põe no lugar de cada fonte um som de mentira,
 * ligado em host.output(<id da fonte>), o mesmo ponto onde o RJ-2000, o RJ-950 e o DCX 404 vão ligar no Studio
 * (etapa 2). Também faz o papel do DCX 404 como efeito (um eco entre o Aux 1 e o Return 1) e do RJ-42
 * (um som direto no master). Nada daqui entra no Studio.
 *
 *   rj2000a..d  quatro bancos: A baixo, B acordes, C arpejo, D sino (2 s em loop, 120 BPM)
 *   rj2000      os quatro bancos juntos
 *   rj950       bateria
 *   dcx404      melodia
 *   line        mudo (o botão "Line = microfone" liga o microfone)
 */
window.RJ = window.RJ || {};

RJ.TestHost = class {
  constructor(host, dev) { this.host = host; this.dev = dev; this.started = false; this.echoOn = false; this.directOn = false; this.mic = null; }

  start() {
    if (this.started) return;
    this.started = true;
    const host = this.host, dev = this.dev, ctx = host.engine.ctx, sr = ctx.sampleRate;
    // as fontes não podem tocar fora da mesa: o sorvedouro mantém cada saída fora do limitador do host
    this.sink = ctx.createGain(); this.sink.gain.value = 0;
    ["rj2000", "rj2000a", "rj2000b", "rj2000c", "rj2000d", "rj950", "dcx404", "line"].forEach(id => { host.output(id); host.route(id, this.sink, { dry: false }); });

    const LEN = Math.round(2 * sr), BEAT = sr / 2;
    const buf = fn => { const b = ctx.createBuffer(2, LEN, sr), d = [b.getChannelData(0), b.getChannelData(1)]; for (let i = 0; i < LEN; i++) { const [l, r] = fn(i / sr, i); d[0][i] = l; d[1][i] = r; } return b; };
    const env = (t, at, dec) => (t < at ? 0 : Math.exp(-(t - at) / dec));
    const tri = x => 2 * Math.abs(2 * (x - Math.floor(x + 0.5))) - 1;
    const saw = x => 2 * (x - Math.floor(x + 0.5));
    let seed = 1; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
    const loopAt = (t, times, dec) => { let s = 0; for (const a of times) s = Math.max(s, env(t, a, dec)); return s; };
    const near = (t, a, len) => (t >= a && t < a + len);

    // bancos
    const bassNotes = [55, 55, 82.4, 73.4];
    const A = buf(t => { const k = Math.min(3, Math.floor(t / 0.5)), tt = t - k * 0.5, f = bassNotes[k]; const v = 0.3 * Math.exp(-tt / 0.28) * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t)); return [v, v]; });
    const chords = [[220, 277, 330], [196, 247, 294]];
    const B = buf(t => { let v = 0; [0.5, 1.5].forEach((a, j) => { if (t >= a) chords[j].forEach(f => { v += 0.07 * env(t, a, 0.18) * (saw(f * t) + saw(f * 1.005 * t)); }); }); return [v, v * 0.9]; });
    const arp = [880, 1108, 1318, 1760];
    const C = buf(t => { const k = Math.floor(t / 0.25), tt = t - k * 0.25, f = arp[k % 4]; const v = 0.12 * Math.exp(-tt / 0.07) * tri(f * t); return [v, v * 0.7]; });
    const D = buf(t => { let v = 0; [0, 1].forEach(a => { v += 0.18 * env(t, a, 0.5) * (Math.sin(2 * Math.PI * 1320 * (t - a)) + 0.5 * Math.sin(2 * Math.PI * 1320 * 2.76 * (t - a))); }); return [v * 0.5, v]; });
    // bateria
    const kick = t => (t < 0.25 ? 0.5 * Math.sin(2 * Math.PI * (45 * t + 85 * (1 - Math.exp(-t * 30)) / 30)) * Math.exp(-t / 0.09) : 0);
    const drums = buf((t, i) => {
      let v = 0;
      [0, 1].forEach(a => { if (t >= a) v += kick(t - a); });
      [0.5, 1.5].forEach(a => { if (t >= a && t < a + 0.2) v += 0.25 * rnd() * Math.exp(-(t - a) / 0.05); });
      for (let k = 0; k < 4; k++) { const a = k * 0.5 + 0.25; if (t >= a && t < a + 0.05) v += 0.1 * rnd() * Math.exp(-(t - a) / 0.012); }
      return [v, v];
    });
    // melodia
    const mel = [[0, 523], [0.25, 659], [0.75, 784], [1, 659], [1.5, 880]];
    const lead = buf(t => { let v = 0; mel.forEach(([a, f]) => { if (t >= a && t < a + 0.6) v += 0.2 * Math.exp(-(t - a) / 0.14) * saw(f * (t - a)); }); return [v, v]; });
    // RJ-42 direto: um clique suave por tempo
    const click = buf(t => { const v = near(t % 0.5, 0, 0.04) ? 0.2 * Math.sin(2 * Math.PI * 1500 * t) * Math.exp(-(t % 0.5) / 0.01) : 0; return [v, v]; });

    const loop = (b, node) => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.connect(node); return s; };
    const t0 = ctx.currentTime + 0.15;
    const bankOuts = { rj2000a: A, rj2000b: B, rj2000c: C, rj2000d: D };
    const srcs = [];
    Object.entries(bankOuts).forEach(([id, b]) => {
      const g = ctx.createGain(); g.connect(host.output(id)); g.connect(host.output("rj2000"));
      srcs.push(loop(b, g));
    });
    srcs.push(loop(drums, host.output("rj950")));
    srcs.push(loop(lead, host.output("dcx404")));
    this.clickOut = ctx.createGain(); this.clickOut.gain.value = 0; this.clickOut.connect(dev.directIn);
    this.clickSrc = loop(click, this.clickOut);
    srcs.push(this.clickSrc);
    srcs.forEach(s => s.start(t0));

    // eco de teste: Aux 1 -> atraso com realimentação -> Return 1 (o papel do DCX 404 como efeito)
    this.echoIn = ctx.createGain();
    const dl = ctx.createDelay(1); dl.delayTime.value = 0.375;
    const fb = ctx.createGain(); fb.gain.value = 0.4;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200;
    this.echoIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(dev.ret1In);

    const tog = (id, fn) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.addEventListener("click", async () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", on ? "true" : "false"); try { await fn(on); } catch (e) { console.warn(e); b.setAttribute("aria-pressed", "false"); } });
    };
    tog("t-echo", on => { this.echoOn = on; if (on) dev.aux1.connect(this.echoIn); else try { dev.aux1.disconnect(this.echoIn); } catch (e) { /* já solto */ } });
    tog("t-42", on => { this.directOn = on; this.clickOut.gain.value = on ? 1 : 0; });
    tog("t-mic", async on => {
      if (on) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        const node = ctx.createMediaStreamSource(stream); node.connect(host.output("line"));
        this.mic = { stream, node };
      } else if (this.mic) { this.mic.stream.getTracks().forEach(t => t.stop()); this.mic.node.disconnect(); this.mic = null; }
    });
    this.ready = true;
  }
};
