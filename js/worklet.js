/* RJ-1202 - AudioWorkletProcessors
 *
 * Carregar depois de js/mixer.js (os dois no mesmo escopo do worklet).
 *
 *   rj1202-a   canais, aux, retornos e solo
 *     entradas: 0 a 4 canais, 5 Return 1, 6 Return 2, 7 direta (RJ-42), todas estéreo
 *     saídas:   0 main (antes do Tape, estéreo), 1 Aux 1 (mono), 2 Aux 2 (mono), 3 solo (estéreo)
 *     mensagens: { k: "ch", i, n, v } · { k: "g", n, v }
 *   rj1202-b   o master, depois do Tape
 *     entradas: 0 main (saída do Tape), 1 solo
 *     saídas:   0 main (com o fader Main), 1 fones (solo, ou o Main se não houver solo, vezes Phones)
 *     mensagens: { k: "set", n, v }
 *
 * Os dois devolvem os picos ~48 vezes por segundo para os medidores.
 */
class RJ1202A extends AudioWorkletProcessor {
  constructor(opt) {
    super();
    const o = (opt && opt.processorOptions) || {};
    this.m = new RJ1202.MixerA(sampleRate, o.state);
    this.blocks = 0;
    this.outs = null;
    this.port.onmessage = e => {
      const d = e.data;
      if (d.k === "ch") this.m.setCh(d.i, d.n, d.v);
      else if (d.k === "g") this.m.setGlobal(d.n, d.v);
    };
  }
  process(inputs, outputs) {
    const n = outputs[0][0] ? outputs[0][0].length : 128;
    this.m.process(inputs, { main: outputs[0], aux1: outputs[1], aux2: outputs[2], solo: outputs[3] }, n);
    if (++this.blocks % 8 === 0) this.port.postMessage(this.m.readPeaks());
    return true;
  }
}
registerProcessor("rj1202-a", RJ1202A);

class RJ1202B extends AudioWorkletProcessor {
  constructor(opt) {
    super();
    const o = (opt && opt.processorOptions) || {};
    this.m = new RJ1202.MasterB(sampleRate, o.state);
    this.m.set("solo", o.solo ? 1 : 0);
    this.blocks = 0;
    this.port.onmessage = e => { const d = e.data; if (d.k === "set") this.m.set(d.n, d.v); };
  }
  process(inputs, outputs) {
    const n = outputs[0][0] ? outputs[0][0].length : 128;
    this.m.process({ main: inputs[0] && inputs[0].length ? inputs[0] : [], solo: inputs[1] && inputs[1].length ? inputs[1] : [] }, { main: outputs[0], phones: outputs[1] }, n);
    if (++this.blocks % 8 === 0) this.port.postMessage(this.m.readPeaks());
    return true;
  }
}
registerProcessor("rj1202-b", RJ1202B);
