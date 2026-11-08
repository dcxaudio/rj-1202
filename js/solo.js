/* RJ-1202 - página solo
 *
 * Monta um host só com o RJ-1202 (RJ.Host.solo): armazenamento com o prefixo "rj1202/". As fontes vêm de um
 * host de teste (js/testhost.js); o encaixe no Studio e as fontes de verdade são da etapa 2.
 */
(function () {
  "use strict";
  const RJ = window.RJ;

  window.addEventListener("DOMContentLoaded", () => {
    const host = RJ.Host.solo("rj1202");
    const dev = new RJ.RJ1202(host.view("rj1202"), { soloMonitor: true });
    host.add("rj1202", dev, { label: "RJ-1202" });
    const root = RJ.m12Panel(document.getElementById("m12-mount"));
    dev.build(root);
    let bar = null;
    dev.bindLearnButton(() => bar);                                  // antes da barra: fica na frente dos ouvintes dela
    bar = new RJ.LearnBar(host, { root, bar: document.getElementById("learnbar") });
    const test = new RJ.TestHost(host.view("rj1202"), dev);

    // tela de ligar: o navegador só libera o som depois de um toque
    const power = document.getElementById("power");
    const on = () => { host.power(); power.classList.add("off"); dev.booted.then(() => test.start()).catch(e => console.error(e)); };
    document.getElementById("power-btn").addEventListener("click", on);
    window.addEventListener("keydown", e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!host.on && (e.code === "Space" || e.code === "Enter")) { e.preventDefault(); on(); }
    });

    // no console: RJ.solo (o host), RJ.rj1202 (o aparelho), RJ.test (o host de teste)
    RJ.solo = host; RJ.rj1202 = dev; RJ.test = test;
  });
})();
