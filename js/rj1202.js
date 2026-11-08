/* RJ-1202 - o aparelho (interface e ligação com o áudio)
 *
 * O som mesmo é do mixer (js/mixer.js), que roda no AudioWorklet (js/worklet.js). Aqui ficam o painel do
 * mockup aprovado, a ligação das fontes, o Tape (RJ.Tape do dcx-core), o MIDI Learn e o armazenamento.
 *
 * Grafo de áudio:
 *   chIn[0..4], ret1In, ret2In, directIn  ->  [rj1202-a]  -> out 0 main -> Tape -> [rj1202-b] -> main, phones
 *                                                         -> out 1 Aux 1 (aux1)   out 2 Aux 2 (aux2)
 *                                                         -> out 3 solo ---------> [rj1202-b]
 * Cada canal recebe a fonte pela rota do host: host.route(<id da fonte>, chIn[i], { dry: false }).
 * Pontas que o Studio vai usar (etapa 2): chIn[i], ret1In, ret2In, directIn (entradas); aux1, aux2, main, phones (saídas).
 *
 * Estado salvo no navegador com o prefixo "rj1202/" (chave "state"); o mapa do MIDI Learn é "rj1202/midimap".
 */
(function () {
  "use strict";
  const RJ = window.RJ, M = window.RJ1202;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const STATE_KEY = "state";
  const SILENT = /[?&]silent\b/.test(location.search);   // gancho de teste: nada sai pelo alto-falante
  const LOCK_TIP = "Travado em zero: o DCX 404 é a fonte deste canal";
  const FALL_DB_S = 40;            // queda dos medidores, dB por segundo

  RJ.RJ1202 = class {
    /**
     * opts.soloMonitor  enquanto houver solo, o alto-falante toca os fones (só na página solo)
     * opts.base         pasta do aparelho em relação à página, com barra no fim ("vendor/rj-1202/"); padrão "" (a própria página)
     * opts.outputId     src => id da saída no host (o Studio traduz "rj2000a" em "rj2000-A"); padrão: o próprio id
     * opts.onSources    set => chamado quando as fontes dos canais mudam (depois de ligado)
     * opts.learnPrefix  prefixo dos ids no MIDI Learn ("m12:" no Studio); padrão ""
     * opts.state        estado de partida quando nada está salvo
     */
    constructor(host, opts = {}) {
      this.host = host;
      this.id = host.id;
      this.opts = opts;
      this.on = false;
      this.st = M.defaultState();
      this.ctl = new Map();           // id do controle -> { id, el, kind, get, set, ... }
      this.unroute = [];              // desfaz a rota da fonte de cada canal
      this.tele = { ch: [0, 0, 0, 0, 0], ret: [0, 0], main: [0, 0], solo: [0, 0] };
      this.lvl = { l: -99, r: -99 };
      this.until = { clip: 0, sig: [0, 0, 0, 0, 0], ol: [0, 0, 0, 0, 0], ret: 0 };
      this.dirtyT = null;
      this.lastFrame = 0;
      this.msgs = 0;
    }

    /* =========================================================== montagem */

    build(root) {
      this.root = root;
      this.loaded = this.host.store.get(STATE_KEY).then(s => { if (s) this.st = M.sanitize(s); else if (this.opts.state) this.st = M.sanitize(this.opts.state); }).catch(e => console.warn("Estado do RJ-1202 ilegível, usando o padrão", e));
      this.seg = $("#seg", root); this.segCap = $("#seg-cap", root);
      this.buildChannels();
      $$("[data-scale]", root).forEach(el => { el.innerHTML = this.scaleHTML(); });
      this.buildMeters();
      this.bindMaster();
      this.bindMisc();
      this.drawSeg("U");
      this.loaded.then(() => { this.paintAll(); });
      this.paintAll();
      requestAnimationFrame(t => this.frame(t));
    }

    scaleHTML() {
      const S = [["+10", 1], ["U", 0.75], ["−10", 0.55], ["−20", 0.38], ["−40", 0.18], ["∞", 0]];
      return S.map(([t, v]) => `<span class="${t === "U" ? "u" : ""}" style="bottom:calc(10px + ${v} * (100% - 20px))">${t}</span>`).join("");
    }

    buildChannels() {
      const knob = (ch, ctl, kind, label, cap, small, det) =>
        `<div class="m12-kw${det ? " det" : ""}"><div class="knob m12-k" data-ctrl="${ch}-${ctl}" data-kind="${kind}" role="slider" tabindex="0" aria-label="${label}" style="--a:0deg"><i></i></div><span class="r9-cap">${cap}${small ? `<small>${small}</small>` : ""}</span></div>`;
      $("#chs", this.root).innerHTML = this.st.ch.map((c, n) => {
        const id = "ch" + (n + 1), nm = "canal " + (n + 1), so = M.SOURCES[M.srcIndex(c.src)];
        return `<div class="m12-ch" data-ch="${id}" data-src="${so.id}" aria-label="Canal ${n + 1}">
      <span class="m12-num">${n + 1}</span>
      <div class="m12-srcwrap"><button class="m12-src" data-ctrl="${id}-source" aria-label="Fonte do canal ${n + 1}" title="Fonte do canal (clique: próxima; Shift+clique: anterior)"><i class="led r9-led on" data-led="${id}-src"></i><span>${so.name}</span></button><span class="r9-cap r42-dim" data-srcsub style="font-size:7.5px">Fonte · ${so.sub}</span></div>
      ${knob(id, "trim", "trim", "Trim " + nm, "Trim", "−10 · +40", false)}
      <div class="m12-lc"><button class="r9-btn" data-ctrl="${id}-lowcut" aria-label="Low Cut ${nm}"></button><span class="r42-lr" style="flex-direction:column;gap:3px;font-size:7.5px"><i class="led r9-led" data-led="${id}-lc"></i>75 Hz</span></div>
      <span class="r9-cap" style="margin-top:-4px">Low Cut</span>
      <span class="m12-st">Aux</span>
      <div class="m12-pair">${knob(id, "aux1", "aux", "Aux 1 " + nm, "1", "FX", true)}${knob(id, "aux2", "aux", "Aux 2 " + nm, "2", "post", true)}</div>
      <span class="m12-st">EQ</span>
      <div class="m12-eq">
        ${knob(id, "hi", "eq15", "Hi 12 kHz " + nm, "Hi", "12 kHz", true)}
        ${knob(id, "mid", "eq12", "Mid 2,5 kHz " + nm, "Mid", "2.5 kHz", true)}
        ${knob(id, "low", "eq15", "Low 80 Hz " + nm, "Low", "80 Hz", true)}
      </div>
      <span class="m12-st">Pan</span>
      ${knob(id, "pan", "pan", "Pan " + nm, "L · R", "", true)}
      <div class="m12-ms">
        <div class="r42-bk"><i class="led r9-led" data-led="${id}-mute"></i><button class="r9-btn sm" data-ctrl="${id}-mute" aria-label="Mute ${nm}"></button><span class="r9-cap">Mute</span></div>
        <div class="r42-bk"><i class="led r9-led" data-led="${id}-solo"></i><button class="r9-btn sm red" data-ctrl="${id}-solo" aria-label="Solo ${nm}"></button><span class="r9-cap">Solo</span></div>
      </div>
      <div class="m12-fz">
        <div class="m12-fleds"><span class="r42-lr"><i class="led r9-led" data-led="${id}-ol"></i>OL</span><span class="r42-lr"><i class="led r9-led" data-led="${id}-sig"></i>Sig</span></div>
        <div class="fader m12-f" data-ctrl="${id}-fader" data-kind="fader" role="slider" tabindex="0" aria-label="Fader ${nm}" style="--v:.75"><span class="cap-f"></span></div>
        <div class="m12-scale" data-scale></div>
      </div>
      <div class="m12-name" data-namestrip>${so.name}</div>
    </div>`;
      }).join("");

      this.st.ch.forEach((_, c) => {
        const id = "ch" + (c + 1), N = "RJ-1202 Ch" + (c + 1) + " ";
        const chv = () => this.st.ch[c];
        const knobCtl = (key, label) => this.addKnob(id + "-" + key, N + label, () => chv()[key], v => this.setCh(c, key, v), key);
        knobCtl("trim", "Trim"); knobCtl("aux1", "Aux 1"); knobCtl("aux2", "Aux 2");
        knobCtl("hi", "Hi"); knobCtl("mid", "Mid"); knobCtl("low", "Low"); knobCtl("pan", "Pan");
        this.addToggle(id + "-lowcut", N + "Low Cut", () => chv().lowcut, v => this.setCh(c, "lowcut", v), `${id}-lc`);
        this.addToggle(id + "-mute", N + "Mute", () => chv().mute, v => this.setCh(c, "mute", v), `${id}-mute`);
        this.addToggle(id + "-solo", N + "Solo", () => chv().solo, v => this.setCh(c, "solo", v), `${id}-solo`);
        this.addFader(id + "-fader", N + "Fader", () => chv().fader, v => this.setCh(c, "fader", v));
        this.addSource(c, N + "Source");
      });
    }

    buildMeters() {
      const MSC = ["CLIP", "+10", "+7", "+4", "+2", "0", "−2", "−4", "−7", "−10", "−20", "−30"];
      ["l", "r"].forEach(side => { $(`#meter-${side}`, this.root).innerHTML = M.METER_DB.map((_, i) => `<i class="led" data-led="meter-${side}-${i}"></i>`).join(""); });
      $("#meter-sc", this.root).innerHTML = MSC.map(t => `<span>${t}</span>`).join("");
      this.leds = {};
      $$("[data-led]", this.root).forEach(el => { this.leds[el.dataset.led] = el; });
    }

    bindMaster() {
      const r = this.root;
      const kn = (id, name, key, onSet) => this.addKnob(id, name, () => this.st[key], v => { this.st[key] = v; onSet(v); }, key);
      kn("aux1-master", "RJ-1202 Aux 1 Master", "aux1m", v => this.postA({ k: "g", n: "aux1m", v }));
      kn("ret1", "RJ-1202 Return 1", "ret1", v => this.postA({ k: "g", n: "ret1", v }));
      kn("ret2", "RJ-1202 Return 2", "ret2", v => this.postA({ k: "g", n: "ret2", v }));
      kn("tape", "RJ-1202 Tape", "tape", v => { if (this.tape) this.tape.setDrive(v); });
      kn("phones", "RJ-1202 Phones", "phones", v => this.postB({ k: "set", n: "phones", v }));
      this.addFader("main", "RJ-1202 Main Mix", () => this.st.main, v => { this.st.main = v; this.postB({ k: "set", n: "main", v }); });
      // chave Pre/Post do Aux 1 (a do RJ-45): ajuste de ligação, não aprende
      const sw = $('[data-ctrl="aux1-prepost"]', r);
      this.sw = sw;
      sw.addEventListener("click", () => this.setPost(!this.st.aux1post));
    }

    bindMisc() {
      const r = this.root;
      const learn = $('[data-ctrl="learn"]', r), clear = $('[data-ctrl="solo-clear"]', r);
      clear.addEventListener("click", () => this.soloClear());
      this.learnBtn = learn;
      this.paintLearn();
    }

    /**
     * O botão Learn do painel liga o mesmo modo da barra do alto da página. Chamar ANTES de criar a LearnBar:
     * no Learn a barra engole os cliques dentro do aparelho, e este ouvinte (registrado primeiro) fica na frente.
     * getBar() devolve a LearnBar.
     */
    bindLearnButton(getBar) {
      const b = this.learnBtn;
      window.addEventListener("pointerdown", e => { if (b.contains(e.target)) e.stopImmediatePropagation(); }, true);
      window.addEventListener("click", e => {
        if (!b.contains(e.target)) return;
        e.stopImmediatePropagation(); e.preventDefault();
        const bar = getBar(); if (bar) bar.toggle();
      }, true);
    }

    /* =========================================================== controles */

    /** Id do controle no MIDI Learn (o Studio põe um prefixo para não bater com os ids das outras máquinas). */
    lid(id) { return (this.opts.learnPrefix || "") + id; }

    reg(id, c) { this.ctl.set(id, c); return c; }

    /** Knob de 0 a 1: arrastar na vertical, roda do mouse e setas; duplo clique volta ao valor de partida. */
    addKnob(id, name, get, set, key) {
      const el = $(`[data-ctrl="${id}"]`, this.root), det = !!el.closest(".det");
      const home = key in M.defaultState() ? M.defaultState()[key] : (M.defaultState().ch[0][key]);
      const c = this.reg(id, { id, el, kind: "knob", name, get, set, det, home, key, lock: false });
      const put = (v, snap) => {
        if (!this.host.on) return;
        if (c.lock) { this.lockNote(c); return; }
        v = clamp(v, 0, 1);
        if (snap && det && Math.abs(v - 0.5) < 5 / 270) v = 0.5;
        set(v); this.paintCtl(c); this.touch(c); this.dirty();
      };
      c.put = put;
      this.host.learn.add(this.lid(id), el, name, "value", { get, set: v => { if (!c.lock) put(v, false); } });
      let y0 = 0, v0 = 0;
      el.addEventListener("pointerdown", e => {
        if (c.lock) { this.lockNote(c); return; }
        e.preventDefault(); el.setPointerCapture(e.pointerId); y0 = e.clientY; v0 = get(); el.dataset.drag = "1"; this.touch(c);
      });
      el.addEventListener("pointermove", e => { if (el.dataset.drag) put(v0 + (y0 - e.clientY) * 1.6 / 270, true); });
      ["pointerup", "pointercancel"].forEach(ev => el.addEventListener(ev, () => { delete el.dataset.drag; }));
      el.addEventListener("dblclick", () => put(c.home, false));
      el.addEventListener("wheel", e => { e.preventDefault(); put(get() - Math.sign(e.deltaY) * 0.02, true); }, { passive: false });
      el.addEventListener("keydown", e => {
        const d = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 }[e.key];
        if (d == null) return;
        e.preventDefault(); e.stopPropagation(); put(get() + d, true);
      });
      return c;
    }

    addFader(id, name, get, set) {
      const el = $(`[data-ctrl="${id}"]`, this.root);
      const c = this.reg(id, { id, el, kind: "fader", name, get, set });
      const put = v => { if (!this.host.on) return; set(clamp(v, 0, 1)); this.paintCtl(c); this.touch(c); this.dirty(); };
      this.host.learn.add(this.lid(id), el, name, "value", { get, set: put });
      const at = e => { const r = el.getBoundingClientRect(); let v = clamp((r.bottom - e.clientY - 10) / (r.height - 20), 0, 1); if (Math.abs(v - 0.75) < 0.02) v = 0.75; return v; };
      el.addEventListener("pointerdown", e => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.dataset.drag = "1"; put(at(e)); });
      el.addEventListener("pointermove", e => { if (el.dataset.drag) put(at(e)); });
      ["pointerup", "pointercancel"].forEach(ev => el.addEventListener(ev, () => { delete el.dataset.drag; }));
      el.addEventListener("wheel", e => { e.preventDefault(); put(get() - Math.sign(e.deltaY) * 0.02); }, { passive: false });
      el.addEventListener("keydown", e => {
        const d = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 }[e.key];
        if (d == null) return;
        e.preventDefault(); e.stopPropagation(); put(get() + d);
      });
      return c;
    }

    /** Tecla travada (Low Cut, Mute, Solo): clique ou MIDI (aperta) liga e desliga. */
    addToggle(id, name, get, set, led) {
      const el = $(`[data-ctrl="${id}"]`, this.root);
      const c = this.reg(id, { id, el, kind: "toggle", name, get, set, led });
      const flip = () => { if (!this.host.on) return; set(get() ? 0 : 1); this.paintCtl(c); this.touch(c); this.dirty(); };
      el.addEventListener("click", flip);
      this.host.learn.add(this.lid(id), el, name, "button", { down: flip });
      return c;
    }

    /** Seletor de fonte do canal: clique passa para a próxima, Shift+clique volta. */
    addSource(ch, name) {
      const id = "ch" + (ch + 1) + "-source", el = $(`[data-ctrl="${id}"]`, this.root);
      const c = this.reg(id, { id, el, kind: "source", name, ch, get: () => M.srcIndex(this.st.ch[ch].src) / (M.SOURCES.length - 1), set: () => {} });
      el.addEventListener("click", e => { if (this.host.on) this.stepSource(ch, e.shiftKey ? -1 : 1); });
      this.host.learn.add(this.lid(id), el, name, "button", { down: () => { if (this.host.on) this.stepSource(ch, 1); } });
      return c;
    }

    /* =========================================================== ações */

    postA(m) { if (this.nodeA) { this.nodeA.port.postMessage(m); this.msgs++; } }
    postB(m) { if (this.nodeB) { this.nodeB.port.postMessage(m); this.msgs++; } }

    setCh(c, key, v) {
      const ch = this.st.ch[c];
      ch[key] = v;
      this.postA({ k: "ch", i: c, n: key, v });
      if (key === "solo") this.soloChanged();
    }

    setPost(on) {
      this.st.aux1post = on ? 1 : 0;
      this.postA({ k: "g", n: "aux1post", v: this.st.aux1post });
      this.paintSwitch(); this.dirty();
      this.show(on ? "P5t" : "PrE", "Aux 1: " + (on ? "post-fader" : "pré-fader"));
    }

    soloChanged() {
      const any = this.st.ch.some(c => c.solo);
      this.postB({ k: "set", n: "solo", v: any ? 1 : 0 });
      if (this.opts.soloMonitor && this.mainGate) {
        const t = this.host.engine.ctx.currentTime;
        this.mainGate.gain.setTargetAtTime(any ? 0 : 1, t, 0.01);
        this.phGate.gain.setTargetAtTime(any && !SILENT ? 1 : 0, t, 0.01);
      }
    }

    soloClear() {
      if (!this.host.on) return;
      this.st.ch.forEach((_, c) => { if (this.st.ch[c].solo) { this.setCh(c, "solo", 0); this.paintCtl(this.ctl.get(`ch${c + 1}-solo`)); } });
      this.dirty(); this.show("OFF", "Solo clear");
    }

    stepSource(ch, d) {
      const n = M.SOURCES.length, i = (M.srcIndex(this.st.ch[ch].src) + d + n) % n;
      this.setSource(ch, M.SOURCES[i].id);
    }

    /** Troca a fonte do canal: desfaz a rota antiga e faz a nova. Com o 404, o Aux 1 do canal trava em zero. */
    setSource(ch, srcId, quiet) {
      if (M.srcIndex(srcId) < 0) return;
      this.st.ch[ch].src = srcId;
      this.postA({ k: "ch", i: ch, n: "src", v: srcId });
      this.routeChannel(ch);
      this.paintSource(ch);
      if (!quiet) { this.dirty(); this.show("Fnt", `Canal ${ch + 1}: ${M.SOURCES[M.srcIndex(srcId)].name}`); }
    }

    routeChannel(ch) {
      if (this.unroute[ch]) { this.unroute[ch](); this.unroute[ch] = null; }
      if (!this.chIn) return;
      const src = this.st.ch[ch].src;
      this.unroute[ch] = this.host.route(this.opts.outputId ? this.opts.outputId(src) : src, this.chIn[ch], { dry: false });
      if (this.ready) this.sourcesChanged();
    }

    /** As fontes que algum canal usa agora (ids do mixer: "rj2000", "rj2000a", "rj950", "dcx404", "line"). */
    usedSources() { return new Set(this.st.ch.map(c => c.src)); }
    sourcesChanged() { if (this.opts.onSources) this.opts.onSources(this.usedSources()); }

    /** Tape do master (0 a 1), por quem não é o knob: o Studio, ao abrir um projeto antigo com o Tape da barra. */
    setTape(v) {
      v = clamp(+v || 0, 0, 1);
      this.st.tape = v;
      if (this.tape) this.tape.setDrive(v);
      this.paintAll(); this.dirty();
    }

    /** Põe um estado inteiro (disquete do projeto do Studio): controles, fontes, Tape. O que faltar volta ao padrão. */
    applyState(raw) {
      const st = M.sanitize(raw);
      this.st = st;
      if (this.nodeA) {
        st.ch.forEach((c, i) => ["trim", "aux1", "aux2", "hi", "mid", "low", "pan", "fader", "lowcut", "mute", "solo"].forEach(n => this.postA({ k: "ch", i, n, v: c[n] })));
        st.ch.forEach((c, i) => this.postA({ k: "ch", i, n: "src", v: c.src }));
        ["aux1m", "ret1", "ret2", "aux1post"].forEach(n => this.postA({ k: "g", n, v: st[n] }));
        this.postB({ k: "set", n: "main", v: st.main }); this.postB({ k: "set", n: "phones", v: st.phones });
        if (this.tape) this.tape.setDrive(st.tape);
        st.ch.forEach((_, i) => this.routeChannel(i));
        this.soloChanged();
      }
      this.paintAll(); this.dirty();
    }

    /* =========================================================== liga */

    boot() {
      if (this.booted || !this.host.on) return this.booted;
      this.booted = this.bootNow();
      return this.booted;
    }

    async bootNow() {
      this.on = true;
      this.root.classList.add("on");
      const ctx = this.host.engine.ensure();
      await this.loaded;
      const url = f => new URL((this.opts.base || "") + f, document.baseURI).href;
      await ctx.audioWorklet.addModule(url("js/mixer.js"));
      await ctx.audioWorklet.addModule(url("js/worklet.js"));
      const state = JSON.parse(JSON.stringify(this.st));
      const any = this.st.ch.some(c => c.solo);
      this.nodeA = new AudioWorkletNode(ctx, "rj1202-a", {
        numberOfInputs: 8, numberOfOutputs: 4, outputChannelCount: [2, 1, 1, 2],
        channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers", processorOptions: { state },
      });
      this.nodeB = new AudioWorkletNode(ctx, "rj1202-b", {
        numberOfInputs: 2, numberOfOutputs: 2, outputChannelCount: [2, 2],
        channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers", processorOptions: { state, solo: any },
      });
      this.nodeA.port.onmessage = e => {
        const d = e.data, t = this.tele;
        d.ch.forEach((p, i) => { if (p > t.ch[i]) t.ch[i] = p; });
        d.ret.forEach((p, i) => { if (p > t.ret[i]) t.ret[i] = p; });
      };
      this.nodeB.port.onmessage = e => {
        const d = e.data, t = this.tele;
        for (let i = 0; i < 2; i++) { if (d.main[i] > t.main[i]) t.main[i] = d.main[i]; if (d.solo[i] > t.solo[i]) t.solo[i] = d.solo[i]; }
      };
      // entradas: um ganho por entrada do worklet, que é onde as rotas do host chegam
      const gain = () => { const g = ctx.createGain(); g.gain.value = 1; return g; };
      this.chIn = this.st.ch.map((_, i) => { const g = gain(); g.connect(this.nodeA, 0, i); return g; });
      this.ret1In = gain(); this.ret1In.connect(this.nodeA, 0, 5);
      this.ret2In = gain(); this.ret2In.connect(this.nodeA, 0, 6);
      this.directIn = gain(); this.directIn.connect(this.nodeA, 0, 7);
      // saídas
      this.aux1 = gain(); this.nodeA.connect(this.aux1, 1, 0);
      this.aux2 = gain(); this.nodeA.connect(this.aux2, 2, 0);
      this.tape = new RJ.Tape(ctx, { drive: this.st.tape });
      this.nodeA.connect(this.tape.input, 0, 0);
      this.tape.output.connect(this.nodeB, 0, 0);
      this.nodeA.connect(this.nodeB, 3, 1);
      this.main = gain(); this.nodeB.connect(this.main, 0, 0);
      this.phones = gain(); this.nodeB.connect(this.phones, 1, 0);
      // saída do aparelho no host: o Main (e, na página solo, os fones no lugar dele durante o solo)
      this.mainGate = gain(); this.main.connect(this.mainGate); this.mainGate.connect(this.host.output());
      this.phGate = gain(); this.phGate.gain.value = 0; this.phones.connect(this.phGate); this.phGate.connect(this.host.output());
      if (SILENT) { this.mainGate.gain.value = 0; this.phGate.gain.value = 0; }
      this.st.ch.forEach((_, i) => this.routeChannel(i));
      this.soloChanged();
      this.paintAll();
      this.ready = true;
      this.sourcesChanged();
    }

    /* =========================================================== desenho */

    angle(v) { return -135 + clamp(v, 0, 1) * 270; }

    paintCtl(c) {
      if (!c) return;
      if (c.kind === "knob") {
        const locked = c.lock;
        c.el.style.setProperty("--a", this.angle(locked ? 0 : c.get()) + "deg");
        c.el.setAttribute("aria-valuenow", Math.round(c.get() * 100));
      } else if (c.kind === "fader") {
        c.el.style.setProperty("--v", c.get().toFixed(3));
        c.el.setAttribute("aria-valuenow", Math.round(c.get() * 100));
      } else if (c.kind === "toggle") {
        const on = !!c.get();
        c.el.classList.toggle("on", on);
        c.el.setAttribute("aria-pressed", on ? "true" : "false");
        if (this.leds[c.led]) this.leds[c.led].classList.toggle("on", on);
        if (c.id.endsWith("-solo")) { const any = this.st.ch.some(x => x.solo); if (this.leds.solo) this.leds.solo.classList.toggle("on", any); }
      }
    }

    paintSource(ch) {
      const id = "ch" + (ch + 1), s = this.st.ch[ch], so = M.SOURCES[M.srcIndex(s.src)];
      const el = $(`.m12-ch[data-ch="${id}"]`, this.root);
      el.dataset.src = so.id;
      $(".m12-src span", el).textContent = so.name;
      $("[data-srcsub]", el).textContent = "Fonte · " + so.sub;
      $("[data-namestrip]", el).textContent = so.name;
      const c = this.ctl.get(id + "-aux1"), locked = M.aux1Locked(s.src), small = c.el.parentElement.querySelector("small");
      c.lock = locked;
      c.el.classList.toggle("locked", locked);
      if (locked) { c.el.setAttribute("aria-disabled", "true"); c.el.title = LOCK_TIP; c.el.removeAttribute("data-learn"); }
      else { c.el.removeAttribute("aria-disabled"); c.el.removeAttribute("title"); c.el.dataset.learn = this.lid(c.id); }
      small.textContent = locked ? "zero" : "FX";
      this.paintCtl(c);
    }

    paintSwitch() {
      const sw = this.sw, post = this.st.aux1post ? 1 : 0, slot = $(".slot", sw), th = $(".thumb", sw);
      sw.dataset.pos = post ? "post" : "pre";
      th.style.left = 3 + (slot.clientWidth - 6 - th.offsetWidth) * post + "px";
      $$(".pos span", sw).forEach((s, j) => s.classList.toggle("sel", j === post));
    }

    paintLearn() {
      const on = !!this.host.learn.learning;
      if (this.learnBtn) this.learnBtn.classList.toggle("on", on);
      if (this.leds.learn) this.leds.learn.classList.toggle("on", on);
    }

    paintAll() {
      this.ctl.forEach(c => this.paintCtl(c));
      this.st.ch.forEach((_, i) => this.paintSource(i));
      if (this.sw) this.paintSwitch();
      if (this.leds.tape) this.leds.tape.classList.toggle("on", this.st.tape > 0.001);
    }

    /* ---- visor de 7 segmentos (o mesmo desenho do RJ-42 e do 404) ---- */

    drawSeg(txt) {
      const SEG = { a: "4,2 18,2 15,5 7,5", b: "19,3 19,18 16,16 16,6", c: "19,20 19,35 16,32 16,22", d: "4,36 18,36 15,33 7,33", e: "3,20 6,22 6,32 3,35", f: "3,3 6,6 6,16 3,18", g: "4,19 7,17 15,17 18,19 15,21 7,21" };
      const DIG = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcfgd",
        "F": "aefg", "O": "abcdef", "L": "def", "r": "eg", "C": "adef", "U": "bcdef", "n": "ceg", "t": "defg", "P": "abefg", "E": "adefg", "-": "g", " ": "" };
      const chars = [];
      for (const ch of txt) { if (ch === "." && chars.length) chars[chars.length - 1].dp = true; else chars.push({ ch, dp: false }); }
      while (chars.length < 4) chars.unshift({ ch: " ", dp: false });
      this.seg.innerHTML = chars.slice(-4).map(({ ch, dp }) => {
        const on = DIG[ch] || "";
        return `<svg viewBox="0 0 24 40">${Object.keys(SEG).map(k => `<polygon class="r42-seg${on.includes(k) ? " on" : ""}" points="${SEG[k]}"/>`).join("")}<circle class="r42-seg${dp ? " on" : ""}" cx="22" cy="36" r="1.8"/></svg>`;
      }).join("");
      this.segTxt = txt;
    }

    show(txt, cap) { this.drawSeg(txt); this.segCap.textContent = cap; }

    /** Valor do controle em texto para o visor (as mesmas contas do mockup). */
    readout(c) {
      const kind = c.el.dataset.kind, v = c.get();
      const db = x => (x === -Infinity ? "OFF" : (x >= 0 ? "+" : "") + x.toFixed(0));
      let t;
      if (c.kind === "toggle") t = v ? "On" : "OFF";
      else if (kind === "fader") { const d = M.faderDb(v); t = d === -Infinity ? "OFF" : Math.abs(d) < 0.05 ? "U" : (d > 0 ? "+" : "") + d.toFixed(1); }
      else if (kind === "trim") t = (M.trimDb(v) >= 0 ? "" : "") + M.trimDb(v).toFixed(0);
      else if (kind === "eq15") t = M.eqDb(v, 15).toFixed(1);
      else if (kind === "eq12") t = M.eqDb(v, 12).toFixed(1);
      else if (kind === "aux") t = db(M.levelDb(v, 15));
      else if (kind === "aux1m" || kind === "phones") t = db(M.levelDb(v, 10));
      else if (kind === "ret") t = db(M.levelDb(v, 20));
      else if (kind === "tape") t = "t" + Math.round(v * 100);
      else if (kind === "pan") { const a = (v - 0.5) * 2; t = Math.abs(a) < 0.03 ? "C" : (a < 0 ? "L" : "r") + Math.round(Math.abs(a) * 50); }
      else t = "";
      if (t === "+0" || t === "0") t = kind === "trim" ? "0" : "U";
      return t.replace("+", "");
    }

    touch(c) {
      if (!c || !c.el) return;
      this.drawSeg(this.readout(c));
      this.segCap.textContent = c.el.getAttribute("aria-label") || c.name;
    }

    lockNote() { this.show("0", LOCK_TIP); }

    /* ---- medidores e LEDs (~60 vezes por segundo) ---- */

    frame(t) {
      requestAnimationFrame(tt => this.frame(tt));
      const dt = this.lastFrame ? Math.min(0.1, (t - this.lastFrame) / 1000) : 0.016;
      this.lastFrame = t;
      if (!this.nodeA) return;
      const tele = this.tele, now = t;
      this.paintLearn();
      const any = this.st.ch.some(c => c.solo);
      // canais
      this.st.ch.forEach((_, i) => {
        const p = tele.ch[i]; tele.ch[i] = 0;
        if (p >= M.SIG_PEAK) this.until.sig[i] = now + 160;
        if (p >= M.OL_PEAK) this.until.ol[i] = now + 300;
        const id = "ch" + (i + 1);
        this.leds[id + "-sig"].classList.toggle("on", now < this.until.sig[i]);
        this.leds[id + "-ol"].classList.toggle("on", now < this.until.ol[i]);
      });
      const r1 = tele.ret[0]; tele.ret[0] = 0; tele.ret[1] = 0;
      if (r1 >= M.SIG_PEAK) this.until.ret = now + 160;
      this.leds["ret1-sig"].classList.toggle("on", now < this.until.ret);
      // medidor: o Main, ou o barramento de solo enquanto houver solo
      const src = any ? tele.solo : tele.main, pk = [src[0], src[1]];
      tele.main[0] = tele.main[1] = tele.solo[0] = tele.solo[1] = 0;
      const peakAll = Math.max(pk[0], pk[1]);
      if (peakAll >= M.CLIP_PEAK) this.until.clip = now + 500;
      ["l", "r"].forEach((side, s) => {
        const d = M.meterDb(pk[s]);
        this.lvl[side] = Math.max(d, this.lvl[side] - FALL_DB_S * dt);
        const lv = this.lvl[side];
        M.METER_DB.forEach((th, i) => {
          const lit = i === 0 ? now < this.until.clip : lv >= th;
          this.leds[`meter-${side}-${i}`].classList.toggle("on", lit);
        });
      });
      this.leds.clip.classList.toggle("on", now < this.until.clip);
      this.leds.solo.classList.toggle("on", any);
      this.leds.tape.classList.toggle("on", this.st.tape > 0.001);
    }

    /* =========================================================== armazenamento */

    dirty() { clearTimeout(this.dirtyT); this.dirtyT = setTimeout(() => this.saveNow(), 400); }
    saveNow() {
      clearTimeout(this.dirtyT); this.dirtyT = null;
      try { this.host.store.put(STATE_KEY, JSON.stringify(this.st)); } catch (e) { console.warn(e); }
    }
  };
})();
