/* RJ-1202 - teste sem som
 *
 *   node tests/sim.js
 *
 * Renderiza o mixer fora do navegador (nenhum som sai), com senos de amplitude conhecida, e mede
 * contra os valores do manual do 1202-VLZ (pesquisa/mackie-1202vlz-referencia.md, citado como [M p.N]):
 * EQ de 3 bandas, low cut de 75 Hz a 18 dB/oitava, aux, retornos, pan, mute, solo, master, medidores e o Tape
 * (o worklet do vendor/dcx-core/js/tape.js, executado como está). Cada medição tem a tolerância escrita ao lado.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const M = require("../js/mixer.js");

const SR = 48000, BLOCK = 128;
let fails = 0, checks = 0;
const ok = (c, msg) => { checks++; console.log("  " + (c ? "ok    " : "FALHA ") + msg); if (!c) fails++; };
const dB = x => (x <= 0 ? -Infinity : 20 * Math.log10(x));
const f1 = x => (x === -Infinity ? "-inf" : x.toFixed(2));

/* ---------------------------------------------------------------- o Tape do vendor, como está */
function loadTape() {
  let src = null;
  const ctx = vm.createContext({
    window: {}, console, Blob: class { constructor(p) { this.src = p[0]; } }, AudioWorkletNode: function () {},
    URL: { createObjectURL: b => { src = b.src; return "blob:teste"; }, revokeObjectURL() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../vendor/dcx-core/js/tape.js"), "utf8"), ctx);
  ctx.window.RJ.Tape.load({ audioWorklet: { addModule: () => Promise.resolve() } });
  if (!src) throw new Error("não achei o worklet do Tape");
  let Cls = null;
  const wctx = vm.createContext({ AudioWorkletProcessor: class { constructor() { this.port = {}; } }, registerProcessor: (n, c) => { Cls = c; }, sampleRate: SR, Math: Object.assign(Object.create(Math), { random: () => 0.25 }), Float64Array });   // fase do wow fixa: duas execuções comparáveis
  vm.runInContext(src, wctx);
  return Cls;
}
const TapeProc = loadTape();

/* ---------------------------------------------------------------- a bancada: A -> (Tape) -> B */
function bench(state, o = {}) {
  const st = M.sanitize(state || {});
  const A = new M.MixerA(SR, st), B = new M.MasterB(SR, st);
  B.set("solo", st.ch.some(c => c.solo) ? 1 : 0);
  const tape = new TapeProc({ processorOptions: {} });
  const bufs = () => ({ main: [new Float32Array(BLOCK), new Float32Array(BLOCK)], aux1: [new Float32Array(BLOCK)], aux2: [new Float32Array(BLOCK)], solo: [new Float32Array(BLOCK), new Float32Array(BLOCK)] });
  const a = bufs(), tm = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const b = { main: [new Float32Array(BLOCK), new Float32Array(BLOCK)], phones: [new Float32Array(BLOCK), new Float32Array(BLOCK)] };
  const drive = { v: o.tape || 0 };
  /**
   * gen(i, t0, n) -> entrada i (0..7) como [L, R] ou undefined. Roda `secs` segundos e devolve os últimos `keep` segundos
   * de cada saída (main, aux1, aux2, solo, phones, tapeIn) e os picos lidos no fim.
   */
  function run(secs, gen, keep = 0.5, opt = {}) {
    const total = Math.round(secs * SR), start = total - Math.round(keep * SR);
    const rec = { main: [[], []], aux1: [], aux2: [], solo: [[], []], phones: [[], []], pre: [[], []] };
    for (let t0 = 0; t0 < total; t0 += BLOCK) {
      const ins = []; for (let i = 0; i < 8; i++) ins.push(gen(i, t0, BLOCK));
      A.process(ins, a, BLOCK);
      for (let c = 0; c < 2; c++) {
        tape.process([a.main], [tm], { drive: [drive.v] });
        break;
      }
      B.process({ main: tm, solo: a.solo }, b, BLOCK);
      if (t0 >= start) {
        for (let c = 0; c < 2; c++) { rec.main[c].push(...b.main[c]); rec.solo[c].push(...a.solo[c]); rec.phones[c].push(...b.phones[c]); rec.pre[c].push(...a.main[c]); }
        rec.aux1.push(...a.aux1[0]); rec.aux2.push(...a.aux2[0]);
      }
    }
    return rec;
  }
  return { A, B, tape, drive, run, st };
}

const sine = (f, amp = 0.1) => (t0, n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * f * (t0 + i) / SR); return x; };
/** Entrada i recebe o seno (nos dois lados); as outras ficam vazias. */
const only = (i0, f, amp = 0.1) => { const g = sine(f, amp); return (i, t0, n) => (i === i0 ? (x => [x, x])(g(t0, n)) : undefined); };
const rms = a => { let s = 0; for (const v of a) s += v * v; return Math.sqrt(s / a.length); };
const gainDb = (out, amp = 0.1) => dB(rms(out) / (amp / Math.SQRT2));

/** Estado com o canal 1 limpo (tudo no U, pan todo à esquerda: ganho esquerdo 1,0). */
const clean = (over = {}, g = {}) => { const s = M.defaultState(); s.ch[0] = Object.assign(s.ch[0], { pan: 0, src: "line" }, over); return Object.assign(s, g); };
/** Ganho do canal 1 (lado esquerdo) numa frequência. */
const chGain = (over, f, g) => { const b = bench(clean(over, g)); return gainDb(b.run(1.2, only(0, f), 0.6).main[0]); };

console.log("RJ-1202 · teste sem som (offline, " + SR + " Hz, blocos de " + BLOCK + " amostras)");

/* ---------------------------------------------------------------- caminho plano */
console.log("\ncaminho plano (tudo no U, EQ no centro)");
{
  const d = chGain({}, 1000);
  ok(Math.abs(d) < 0.01, `canal inteiro no U, pan todo à esquerda: ganho ${f1(d)} dB (tolerância 0,01 dB)`);
  const b = bench(clean({ trim: 0.2 }));
  const out = b.run(0.6, only(0, 1000, 0.5), 0.3).main[0], ref = Array.from({ length: out.length }, (_, i) => out[i]);
  ok(out.every(Number.isFinite) && Math.max(...ref.map(Math.abs)) < 0.5001, "saída finita, pico igual ao da entrada (0,5)");
  ok(Math.abs(M.trimDb(0.2)) < 1e-9, "Trim: U (0 dB) em 20% do curso (9h); -10 dB em 0 e +40 dB no fim [M p.11]");
  ok(M.trimDb(0) === -10 && M.trimDb(1) === 40, "Trim: -10 dB a +40 dB");
}

/* ---------------------------------------------------------------- EQ */
console.log("\nEQ de 3 bandas [M p.20, 31]: Hi 12 kHz shelf ±15 · Mid 2,5 kHz sino ±12 · Low 80 Hz shelf ±15");
{
  const T = 0.15;   // tolerância dB
  const pts = [
    ["Hi +15", { hi: 1 }, 12000, 7.5, 0.3, "no canto (12 kHz) um shelf está na metade do ganho"],
    ["Hi +15", { hi: 1 }, 20000, 15, 1.0, "no platô (20 kHz; perto de Nyquist o bilinear pesa)"],
    ["Hi -15", { hi: 0 }, 12000, -7.5, 0.3, ""],
    ["Hi +15", { hi: 1 }, 1000, 0, 0.1, "longe da banda: plano"],
    ["Mid +12", { mid: 1 }, 2500, 12, T, "no pico (2,5 kHz) a faixa inteira"],
    ["Mid -12", { mid: 0 }, 2500, -12, T, ""],
    ["Mid +12", { mid: 1 }, 100, 0, 0.5, "longe do sino: quase plano"],
    ["Low +15", { low: 1 }, 80, 7.5, 0.3, "no canto (80 Hz) a metade"],
    ["Low +15", { low: 1 }, 20, 15, 0.6, "no platô (20 Hz)"],
    ["Low -15", { low: 0 }, 80, -7.5, 0.3, ""],
    ["Low +15", { low: 1 }, 5000, 0, 0.1, "longe da banda: plano"],
  ];
  pts.forEach(([name, over, f, want, tol, why]) => {
    const d = chGain(over, f);
    ok(Math.abs(d - want) <= tol, `${name} em ${f} Hz: ${f1(d)} dB, esperado ${want} ±${tol}${why ? " (" + why + ")" : ""}`);
  });
  // centro = plano exato, e o botão no centro não passa pelo filtro (cópia exata)
  const b = bench(clean({})); const o = b.run(0.4, only(0, 3000, 0.3), 0.2).main[0];
  const ref = sine(3000, 0.3); let maxd = 0; const r = ref(Math.round(0.2 * SR) , o.length);
  ok(Math.abs(gainDb(o, 0.3)) < 0.001, "EQ no centro: ganho exato (" + f1(gainDb(o, 0.3)) + " dB, tolerância 0,001)");
  // as três bandas juntas: soma em dB nos pontos distantes
  const all = chGain({ hi: 1, mid: 0, low: 1 }, 2500);
  ok(Math.abs(all - (-12)) < 1.5, `as três ao mesmo tempo, em 2,5 kHz: ${f1(all)} dB (mid -12 dominante, ±1,5 pelas caudas)`);
}

/* ---------------------------------------------------------------- low cut */
console.log("\nLow cut [M p.11]: 75 Hz, 18 dB/oitava (Butterworth de 3ª ordem)");
{
  const ideal = f => -10 * Math.log10(1 + Math.pow(75 / f, 6));
  let worst = 0;
  [10, 20, 37.5, 60, 75, 100, 150, 300, 1000].forEach(f => {
    const d = chGain({ lowcut: 1 }, f), e = ideal(f);
    worst = Math.max(worst, Math.abs(d - e));
  });
  const at75 = chGain({ lowcut: 1 }, 75);
  ok(Math.abs(at75 - -3.01) < 0.1, `em 75 Hz: ${f1(at75)} dB (esperado -3,01 ±0,1)`);
  ok(worst < 0.2, `contra o Butterworth ideal em 9 frequências (10 Hz a 1 kHz): pior desvio ${worst.toFixed(3)} dB (tolerância 0,2)`);
  const s = chGain({ lowcut: 1 }, 10) - chGain({ lowcut: 1 }, 20);
  ok(Math.abs(s + 18) < 0.6, `inclinação de 10 Hz a 20 Hz: ${f1(-s)} dB/oitava (esperado 18 ±0,6)`);
  ok(Math.abs(chGain({ lowcut: 1 }, 1000)) < 0.01, "acima de 300 Hz: plano (em 1 kHz " + f1(chGain({ lowcut: 1 }, 1000)) + " dB)");
  ok(Math.abs(chGain({ lowcut: 0 }, 40)) < 0.01, "low cut desligado: 40 Hz passa inteiro");
}

/* ---------------------------------------------------------------- pan */
console.log("\nPan [M p.19]: loudness constante, ~4 dB abaixo no centro");
{
  const mk = pan => { const b = bench(clean({ pan })); const r = b.run(0.8, only(0, 1000), 0.4).main; return [gainDb(r[0]), gainDb(r[1])]; };
  const c = mk(0.5), l = mk(0), r = mk(1);
  ok(Math.abs(c[0] + 4) < 0.1 && Math.abs(c[1] + 4) < 0.1, `centro: L ${f1(c[0])} dB e R ${f1(c[1])} dB (esperado -4,0 ±0,1)`);
  ok(Math.abs(l[0]) < 0.01 && l[1] === -Infinity, `todo à esquerda: L ${f1(l[0])} dB, R ${f1(l[1])} dB (R zero exato)`);
  ok(Math.abs(r[1]) < 0.01 && r[0] === -Infinity, `todo à direita: R ${f1(r[1])} dB, L ${f1(r[0])} dB`);
  const q = mk(0.25);
  ok(q[0] > q[1] && q[0] < 0 && q[0] > -4 && q[1] < -4, `meio caminho: L ${f1(q[0])} dB, R ${f1(q[1])} dB (entre o canto e o centro)`);
  let mx = 0; for (let t = 0; t <= 1; t += 0.01) { const [a, b] = M.panGains(t); mx = Math.max(mx, a * a + b * b); }
  ok(mx <= 1.0001, "a potência total nunca passa de 1 (máximo " + mx.toFixed(4) + ")");
}

/* ---------------------------------------------------------------- fader, trim */
console.log("\nFader e Trim");
{
  const f = v => chGain({ fader: v }, 1000);
  ok(Math.abs(f(0.75)) < 0.01, "fader em U (0,75): " + f1(f(0.75)) + " dB");
  ok(Math.abs(f(1) - 10) < 0.01, "fader no topo: +10 dB (" + f1(f(1)) + ")");
  ok(Math.abs(f(0.375) + 30) < 0.01, "fader na metade abaixo de U: -30 dB (" + f1(f(0.375)) + ")");
  ok(f(0) === -Infinity, "fader no fundo: silêncio exato");
  const t = tr => chGain({ trim: tr }, 1000);
  ok(Math.abs(t(1) - 40) < 0.01 && Math.abs(t(0) + 10) < 0.01, `Trim: +40 dB no fim (${f1(t(1))}) e -10 dB no começo (${f1(t(0))})`);
}

/* ---------------------------------------------------------------- mute */
console.log("\nMute [M p.18]: tira o canal do Main; o Aux 1 PRE continua");
{
  const b = bench(clean({ mute: 1, aux1: 0.5, aux2: 0.5 }, { aux1post: 0 }));
  const r = b.run(1, only(0, 1000), 0.5);
  ok(rms(r.main[0]) === 0 && rms(r.main[1]) === 0, "canal mudo: Main em silêncio exato");
  ok(Math.abs(gainDb(r.aux1)) < 0.3, "Aux 1 em PRE continua mandando com o canal mudo (" + f1(gainDb(r.aux1)) + " dB)");
  ok(rms(r.aux2) === 0, "Aux 2 (pós-fader e mute) cala com o mute");
  const b2 = bench(clean({ mute: 1, aux1: 0.5 }, { aux1post: 1 }));
  ok(rms(b2.run(1, only(0, 1000), 0.5).aux1) === 0, "Aux 1 em POST cala com o mute");
  // sem estalo ao ligar o mute: a rampa vem de 5 ms
  const b3 = bench(clean({})); const g = sine(200, 0.5); let last = 0, jump = 0;
  const A = b3.A, ob = { main: [new Float32Array(BLOCK), new Float32Array(BLOCK)], aux1: [new Float32Array(BLOCK)], aux2: [new Float32Array(BLOCK)], solo: [new Float32Array(BLOCK), new Float32Array(BLOCK)] };
  for (let t0 = 0; t0 < SR / 2; t0 += BLOCK) {
    if (t0 === 24064) A.setCh(0, "mute", 1);
    const x = g(t0, BLOCK); A.process([[x, x]], ob, BLOCK);
    for (let i = 0; i < BLOCK; i++) { if (t0 > 0) jump = Math.max(jump, Math.abs(ob.main[0][i] - last)); last = ob.main[0][i]; }
  }
  ok(jump < 0.03, "ligar o Mute em movimento: maior salto entre amostras " + jump.toFixed(4) + " (seno de 0,5 a 200 Hz salta no máximo 0,013; sem rampa seria até 0,5)");
}

/* ---------------------------------------------------------------- aux */
console.log("\nAux 1 e Aux 2 [M p.20, 24]");
{
  const aux = (over, g) => { const b = bench(clean(over, g)); return b.run(1.2, only(0, 1000), 0.6); };
  ok(Math.abs(gainDb(aux({ aux1: 0.5 }).aux1)) < 0.02, "Aux 1 no U (centro): envio igual à entrada, em mono (" + f1(gainDb(aux({ aux1: 0.5 }).aux1)) + " dB)");
  ok(Math.abs(gainDb(aux({ aux1: 1 }).aux1) - 15) < 0.02, "Aux 1 no fim: +15 dB (" + f1(gainDb(aux({ aux1: 1 }).aux1)) + ")");
  ok(rms(aux({ aux1: 0 }).aux1) === 0, "Aux 1 desligado: silêncio exato");
  ok(Math.abs(gainDb(aux({ aux2: 0.5 }).aux2)) < 0.02 && Math.abs(gainDb(aux({ aux2: 1 }).aux2) - 15) < 0.02, "Aux 2: U e +15 dB");
  // mono: soma dos dois lados (L=1, R=0 manda a metade)
  { const b = bench(clean({ aux1: 0.5 })); const x = sine(1000)(0, 1); const g = (i, t0, n) => (i === 0 ? [sine(1000)(t0, n), new Float32Array(n)] : undefined);
    ok(Math.abs(gainDb(b.run(1.2, g, 0.6).aux1) + 6.02) < 0.05, "canal estéreo manda a soma mono: só o lado esquerdo cheio dá -6,02 dB"); }
  // PRE x POST com o fader abaixo
  const pre = aux({ aux1: 0.5, fader: 0.375 }, { aux1post: 0 }), post = aux({ aux1: 0.5, fader: 0.375 }, { aux1post: 1 });
  ok(Math.abs(gainDb(pre.aux1)) < 0.02, "Aux 1 PRE: fader em -30 dB não muda o envio (" + f1(gainDb(pre.aux1)) + " dB)");
  ok(Math.abs(gainDb(post.aux1) + 30) < 0.05, "Aux 1 POST: o envio segue o fader (" + f1(gainDb(post.aux1)) + " dB, esperado -30)");
  ok(Math.abs(gainDb(aux({ aux2: 0.5, fader: 0.375 }).aux2) + 30) < 0.05, "Aux 2 é sempre pós-fader");
  // aux depois do EQ e do low cut
  const e = aux({ aux1: 0.5, low: 1 }, { aux1post: 0 }), eFlat = aux({ aux1: 0.5 }, { aux1post: 0 });
  const nf = (over, f) => { const b = bench(clean(Object.assign({ aux1: 0.5 }, over), { aux1post: 0 })); return gainDb(b.run(1.2, only(0, f), 0.6).aux1); };
  ok(Math.abs(nf({ low: 1 }, 80) - 7.5) < 0.3 && Math.abs(nf({ lowcut: 1 }, 75) + 3.01) < 0.1, "o envio sai depois do EQ e do low cut (Low +15 em 80 Hz: " + f1(nf({ low: 1 }, 80)) + " dB; low cut em 75 Hz: " + f1(nf({ lowcut: 1 }, 75)) + " dB)");
  // Aux 1 master
  const am = v => gainDb(aux({ aux1: 0.5 }, { aux1m: v }).aux1);
  ok(Math.abs(am(0.5)) < 0.02 && Math.abs(am(1) - 10) < 0.02 && aux({ aux1: 0.5 }, { aux1m: 0 }).aux1.every(v => v === 0), `Aux 1 Master: U (${f1(am(0.5))}), +10 dB (${f1(am(1))}), desligado = zero [M p.24]`);
  ok(Math.abs(gainDb(aux({ aux2: 0.5 }, { aux1m: 0 }).aux2)) < 0.02, "o Aux 2 não tem master");
  // 404 como fonte: Aux 1 travado em zero
  const lock = aux({ aux1: 1, src: "dcx404" });
  ok(rms(lock.aux1) === 0, "canal com fonte DCX 404: Aux 1 travado em zero mesmo com o knob no máximo");
  ok(Math.abs(gainDb(aux({ aux2: 0.5, src: "dcx404" }).aux2)) < 0.02, "…e o Aux 2 desse canal continua livre");
  // trocar de fonte devolve o valor guardado
  const bl = bench(clean({ aux1: 1, src: "dcx404" })); bl.A.setCh(0, "src", "line");
  ok(Math.abs(gainDb(bl.run(1.2, only(0, 1000), 0.6).aux1) - 15) < 0.05, "ao trocar a fonte, o Aux 1 volta ao valor do knob (+15 dB)");
  ok(M.aux1Locked("dcx404") && !["rj2000", "rj2000a", "rj2000b", "rj2000c", "rj2000d", "rj950", "line"].some(M.aux1Locked), "só o DCX 404 trava o Aux 1");
}

/* ---------------------------------------------------------------- retornos e entrada direta */
console.log("\nRetornos [M p.13, 25] e entrada direta (RJ-42)");
{
  const ret = (i, v, g) => { const b = bench(clean({ fader: 0 }, Object.assign({ [i === 5 ? "ret1" : "ret2"]: v }, g))); return b.run(1.2, only(i, 1000), 0.6).main; };
  const l = ret(5, 0.5)[0];
  ok(Math.abs(gainDb(l)) < 0.02 && Math.abs(gainDb(ret(5, 0.5)[1])) < 0.02, "Return 1 no U: entra no Main sem mudar o nível, nos dois lados (" + f1(gainDb(l)) + " dB)");
  ok(Math.abs(gainDb(ret(5, 1)[0]) - 20) < 0.02, "Return 1 no fim: +20 dB (" + f1(gainDb(ret(5, 1)[0])) + ")");
  ok(rms(ret(5, 0)[0]) === 0, "Return 1 desligado: silêncio exato");
  ok(Math.abs(gainDb(ret(6, 0.5)[0])) < 0.02, "Return 2 no U");
  ok(Math.abs(gainDb(ret(7, 0)[0])) < 0.02, "entrada direta (RJ-42): sempre ganho unitário, sem controle");
  // retorno não passa por pan, mute nem EQ
  const b = bench(clean({ fader: 0, mute: 1, pan: 0, low: 1 })); const r = b.run(1.2, only(5, 80), 0.6).main;
  ok(Math.abs(gainDb(r[0])) < 0.02 && Math.abs(gainDb(r[1])) < 0.02, "o retorno não tem mute, pan nem EQ: 80 Hz sai igual nos dois lados");
}

/* ---------------------------------------------------------------- solo */
console.log("\nSolo (PFL) [M p.22]: depois do EQ, antes do fader; não altera o Main");
{
  const sBench = over => { const s = clean(over); s.ch[1] = Object.assign(s.ch[1], { src: "line", pan: 0 }); return bench(s); };
  const gen = (i, t0, n) => (i === 0 ? (x => [x, x])(sine(1000, 0.1)(t0, n)) : i === 1 ? (x => [x, x])(sine(2000, 0.1)(t0, n)) : undefined);
  const b = sBench({ solo: 1, fader: 0.375, low: 1 });
  const r = b.run(1.2, gen, 0.6);
  const mainRms = rms(r.main[0]), soloRms = rms(r.solo[0]);
  ok(b.A.anySolo === true, "A.anySolo acende com um canal em solo");
  ok(Math.abs(dB(soloRms / (0.1 / Math.SQRT2))) < 0.1, "o barramento de solo traz só o canal 1, pré-fader: ainda " + f1(dB(soloRms / (0.1 / Math.SQRT2))) + " dB com o fader em -30 dB");
  { const want = Math.sqrt((0.1 * Math.pow(10, -30 / 20)) ** 2 / 2 + 0.1 ** 2 / 2), got = rms(r.main[0]);   // canal 1 a -30 dB e canal 2 no U, os dois à esquerda
    ok(Math.abs(dB(got / want)) < 0.05, "o Main continua ouvindo os dois canais, com o fader (RMS " + got.toFixed(4) + ", esperado " + want.toFixed(4) + ")"); }
  const m2 = sBench({ solo: 0, fader: 0.375 }), m1 = sBench({ solo: 1, fader: 0.375 });
  const a1 = m2.run(1.2, gen, 0.6).main[0], a2 = m1.run(1.2, gen, 0.6).main[0];
  let same = true; for (let i = 0; i < a1.length; i++) if (a1[i] !== a2[i]) { same = false; break; }
  ok(same, "ligar o solo não muda o Main (bit a bit)");
  const ph = r.phones[0];
  ok(Math.abs(rms(ph) - rms(r.solo[0]) * M.levelGain(0.5, 10)) < 1e-4, "fones: com solo ligado, recebem o barramento de solo (× Phones no U)");
  const bn = sBench({ solo: 0 }), rn = bn.run(1.2, gen, 0.6);
  ok(rms(rn.solo[0]) === 0 && Math.abs(rms(rn.phones[0]) - rms(rn.main[0])) < 1e-4, "sem solo: o barramento de solo é zero e os fones seguem o Main");
  // o solo ignora o mute (PFL)
  const bm = sBench({ solo: 1, mute: 1 }); ok(Math.abs(dB(rms(bm.run(1.2, gen, 0.6).solo[0]) / (0.1 / Math.SQRT2))) < 0.1, "solo ignora o mute do canal");
  // dois solos somam
  const s2 = clean({ solo: 1 }); s2.ch[1] = Object.assign(s2.ch[1], { src: "line", pan: 0, solo: 1 }); const b2 = bench(s2);
  ok(Math.abs(dB(rms(b2.run(1.2, gen, 0.6).solo[0]) / (0.1))) < 0.1, "vários solos ao mesmo tempo somam (2 senos de 0,1: RMS total 0,1)");
}

/* ---------------------------------------------------------------- master */
console.log("\nMaster [M p.21]: fader Main e medidores");
{
  const mf = v => { const b = bench(clean({}, { main: v })); return gainDb(b.run(1.2, only(0, 1000), 0.6).main[0]); };
  ok(Math.abs(mf(0.75)) < 0.01 && Math.abs(mf(1) - 10) < 0.01, `fader Main: U ${f1(mf(0.75))} dB, topo +10 dB (${f1(mf(1))})`);
  ok(mf(0) === -Infinity, "fader Main no fundo: silêncio");
  const ph = v => { const s = clean({ solo: 1 }, { phones: v }); const b = bench(s); return gainDb(b.run(1.2, only(0, 1000), 0.6).phones[0]); };
  ok(Math.abs(ph(0.5)) < 0.05 && Math.abs(ph(1) - 10) < 0.05, `Phones: U ${f1(ph(0.5))} dB, topo +10 dB (${f1(ph(1))})`);
  // medidor: pico 0,25 (-12 dBFS) = 0 dB no medidor; 0,794 (-2 dBFS) = +10
  [[0.25, 0], [0.7943, 10], [0.0631, -12], [0.0079, -30]].forEach(([p, want]) => ok(Math.abs(M.meterDb(p) - want) < 0.05, `medidor: pico ${p} lê ${f1(M.meterDb(p))} dB (esperado ${want} ±0,05; 0 dB = -12 dBFS)`));
  const led = x => M.meterLeds(x).filter(Boolean).length, dbfs = M.dbToGain;
  ok(led(dbfs(-12)) === 7 && led(dbfs(-2)) === 11 && led(0.99) === 12 && led(0.001) === 0 && led(dbfs(-43)) === 0, `LEDs acesos: -12 dBFS = ${led(dbfs(-12))} de 12 (o 0 dB e tudo abaixo), -2 dBFS = ${led(dbfs(-2))} (+10, só falta o CLIP), 0 dBFS = ${led(0.99)} (CLIP), silêncio = ${led(0.001)}`);
  // leitura de picos do próprio mixer
  const b = bench(clean({}), {}); b.run(0.5, only(0, 1000, 0.25), 0.1);
  const pk = b.A.readPeaks(), pm = b.B.readPeaks();
  ok(Math.abs(pk.ch[0] - 0.25) < 0.01 && pk.ch[1] === 0, `pico do canal 1 (depois do EQ, antes do fader) = ${pk.ch[0].toFixed(3)} (esperado 0,25); canal vazio = 0`);
  ok(Math.abs(pm.main[0] - 0.25) < 0.01 && pm.main[1] === 0, `pico do Main L = ${pm.main[0].toFixed(3)}, R = ${pm.main[1]} (pan à esquerda)`);
  ok(b.A.readPeaks().ch[0] === 0, "a leitura de pico zera depois de ler");
  ok(M.SIG_PEAK < 0.0057 && M.OL_PEAK > 0.7, "Sig acende acima de -45 dBFS e OL acima de -3 dBFS");
}

/* ---------------------------------------------------------------- Tape */
console.log("\nTape no master, antes do fader Main (RJ.Tape do dcx-core, o worklet como está)");
{
  const gen = (i, t0, n) => (i === 0 ? (x => [x, x])(sine(300, 0.3)(t0, n)) : undefined);
  const a = bench(clean({}), { tape: 0 }).run(0.6, gen, 0.3);
  const b0 = bench(clean({}), { tape: 0 });
  // Tape 0: o processador copia a entrada; comparar com a saída sem passar pelo Tape
  const noTape = (() => { const st = M.sanitize(clean({})); const A = new M.MixerA(SR, st), B = new M.MasterB(SR, st); const ao = { main: [new Float32Array(BLOCK), new Float32Array(BLOCK)], aux1: [new Float32Array(BLOCK)], aux2: [new Float32Array(BLOCK)], solo: [new Float32Array(BLOCK), new Float32Array(BLOCK)] }; const bo = { main: [new Float32Array(BLOCK), new Float32Array(BLOCK)], phones: [new Float32Array(BLOCK), new Float32Array(BLOCK)] }; const out = [];
    for (let t0 = 0; t0 < Math.round(0.6 * SR); t0 += BLOCK) { A.process([(x => [x, x])(sine(300, 0.3)(t0, BLOCK))], ao, BLOCK); B.process({ main: ao.main, solo: ao.solo }, bo, BLOCK); if (t0 >= Math.round(0.3 * SR)) out.push(...bo.main[0]); } return out; })();
  let identical = a.main[0].length === noTape.length; for (let i = 0; identical && i < noTape.length; i++) if (a.main[0][i] !== noTape[i]) identical = false;
  ok(identical, `Tape 0: a saída é bit a bit igual à mesa sem o Tape (${noTape.length} amostras comparadas)`);
  const on = bench(clean({}), { tape: 0.8 }).run(0.6, gen, 0.3).main[0];
  let diff = 0; for (let i = 0; i < on.length; i++) diff = Math.max(diff, Math.abs(on[i] - noTape[i]));
  ok(diff > 0.01, `Tape em 0,8 muda o som (maior diferença ${diff.toFixed(3)})`);
  // antes do fader: com o fader a -20 dB a saída é a mesma forma de onda, só mais baixa
  const hi = bench(clean({}, { main: 0.75 }), { tape: 0.8 }).run(0.6, gen, 0.3).main[0];
  const lo = bench(clean({}, { main: 0.75 - 0.75 / 3 }), { tape: 0.8 }).run(0.6, gen, 0.3).main[0];   // -20 dB
  let worst = 0; const sc = M.faderGain(0.75 - 0.75 / 3);
  for (let i = 0; i < hi.length; i++) worst = Math.max(worst, Math.abs(lo[i] - hi[i] * sc));
  ok(Math.abs(M.faderDb(0.75 - 0.75 / 3) + 20) < 1e-9 && worst < 1e-4, `Tape antes do fader: com o Main em -20 dB a forma de onda é a mesma, só 10x menor (desvio máximo ${worst.toExponential(1)}; se o Tape viesse depois, a saturação seria outra)`);
  // Tape pega a mistura toda: o retorno também satura
  const gR = (i, t0, n) => (i === 5 ? (x => [x, x])(sine(300, 0.3)(t0, n)) : undefined);
  const rr = bench(clean({ fader: 0 }), { tape: 0.8 }).run(0.6, gR, 0.3).main[0];
  const rr0 = bench(clean({ fader: 0 }), { tape: 0 }).run(0.6, gR, 0.3).main[0];
  let d2 = 0; for (let i = 0; i < rr.length; i++) d2 = Math.max(d2, Math.abs(rr[i] - rr0[i]));
  ok(d2 > 0.01, "o Tape age na mistura inteira, retornos incluídos (diferença " + d2.toFixed(3) + ")");
}

/* ---------------------------------------------------------------- estado, fontes e MIDI Learn */
console.log("\nestado, fontes e controles que aprendem");
{
  ok(M.SOURCES.length === 8 && M.SOURCES.map(s => s.id).join() === "rj2000,rj2000a,rj2000b,rj2000c,rj2000d,rj950,dcx404,line", "8 fontes por canal: RJ-2000 inteiro, bancos A a D, RJ-950, DCX 404, Line (o RJ-42 não entra)");
  ok(M.NCH === 5 && M.defaultState().ch.length === 5, "5 canais");
  const ids = M.learnIds();
  ok(ids.length === 66 && new Set(ids).size === 66, "66 controles aprendem: 12 por canal × 5 + 6 do master (" + ids.length + ", todos com id único)");
  ok(M.CH_CTRLS.length === 12 && M.MASTER_CTRLS.length === 6, "12 por canal (Fonte, Trim, Low Cut, Aux 1, Aux 2, Hi, Mid, Low, Pan, Mute, Solo, fader) e 6 do master (Aux 1 Master, Return 1, Return 2, Tape, Phones, Main)");
  const d = M.defaultState(); d.ch[2].src = "rj2000c"; d.ch[2].fader = 0.4; d.tape = 0.3;
  const back = M.sanitize(JSON.stringify(d));
  ok(JSON.stringify(back) === JSON.stringify(d), "o estado salvo em JSON volta igual");
  const bad = M.sanitize({ ch: [{ src: "nada", trim: 9, fader: "x", mute: 5 }], tape: -3, main: NaN });
  ok(bad.ch[0].src === "rj2000a" && bad.ch[0].trim === 1 && bad.ch[0].fader === 0.75 && bad.ch[0].mute === 0 && bad.tape === 0 && bad.main === 0.75 && bad.ch.length === 5, "estado estragado: o que está errado volta ao padrão, o resto fica no limite");
  ok(JSON.stringify(M.sanitize("{lixo")) === JSON.stringify(M.defaultState()) && JSON.stringify(M.sanitize(null)) === JSON.stringify(M.defaultState()), "JSON ilegível ou vazio: estado padrão");
  // o valor de Tape antigo do projeto (slider 0 a 1) continua válido
  ok(M.sanitize({ tape: 0.55 }).tape === 0.55, "um valor de Tape de 0 a 1 do projeto antigo é aceito como está");
}

console.log("\n" + (fails ? fails + " falha(s) em " + checks : "tudo certo (" + checks + " verificações)"));
process.exit(fails ? 1 : 0);
