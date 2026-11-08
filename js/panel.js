/* RJ-1202 - o painel (HTML)
 *
 * O mesmo painel serve a página solo (index.html) e o DCX Studio: RJ.m12Panel(elemento) põe o painel dentro do
 * elemento e devolve o <section class="m12">. Os dados e os eventos são do js/rj1202.js.
 */
window.RJ = window.RJ || {};
RJ.m12Panel = function (mount) {
  mount.innerHTML = `
<section class="m12" aria-label="RJ-1202 Studio Mixer">
        <i class="m12-hole" style="left:12px;top:10px"></i><i class="m12-hole" style="right:12px;top:10px"></i>
        <i class="m12-hole" style="left:12px;bottom:10px"></i><i class="m12-hole" style="right:12px;bottom:10px"></i>
    
        <!-- marca e energia -->
        <div class="m12-top">
          <div class="r9-brand"><span class="r9-maker">DCX</span><span class="r9-sub">Studio Mixer</span></div>
          <span class="r9-model" style="margin-bottom:-2px">RJ-1202</span>
          <span class="m12-sp"></span>
          <span class="r9-cap r42-dim" style="margin-bottom:5px">5 canais · 2 retornos · main estéreo</span>
          <span class="m12-pwr r42-lr"><i class="led r9-led on" data-led="power"></i>Power</span>
        </div>
    
        <div class="m12-main">
          <!-- 5 canais (montados pelo script); cada um tem um seletor de fonte -->
          <div class="m12-chs" id="chs"></div>
    
          <!-- retornos aux: o efeito vem do DCX 404 -->
          <div class="r42-group m12-ret"><span class="r42-gt">Aux</span>
            <div class="m12-kw det"><div class="knob m12-k" data-ctrl="aux1-master" data-kind="aux1m" role="slider" tabindex="0" aria-label="Aux 1 Master" style="--a:0deg"><i></i></div><span class="r9-cap">Aux 1 Mst<small>off · U · +10</small></span></div>
            <button class="sw" data-ctrl="aux1-prepost" data-pos="post" data-opts="pre,post" aria-label="Aux 1: pré ou pós-fader"><span class="slot"><span class="thumb"></span></span><span class="pos"><span>Pre</span><span>Post</span></span></button>
            <span class="r9-cap r42-dim" style="margin-top:-6px">Aux 1 select</span>
            <span class="m12-st">Returns</span>
            <div class="m12-pair">
              <div class="m12-kw det"><div class="knob m12-k" data-ctrl="ret1" data-kind="ret" role="slider" tabindex="0" aria-label="Return 1 (DCX 404)" style="--a:45deg"><i></i></div><span class="r9-cap">Ret 1<small>404 FX</small></span></div>
              <div class="m12-kw det"><div class="knob m12-k" data-ctrl="ret2" data-kind="ret" role="slider" tabindex="0" aria-label="Return 2" style="--a:-135deg"><i></i></div><span class="r9-cap">Ret 2<small>livre</small></span></div>
            </div>
            <span class="r42-lr" style="margin-top:-4px"><i class="led r9-led" data-led="ret1-sig"></i>FX in</span>
            <!-- caminho impresso no painel -->
            <table class="m12-path" aria-label="Caminho do efeito">
              <tr><td>Aux 1 send</td></tr><tr><td class="ar">↓</td></tr>
              <tr><td>DCX 404 in</td></tr><tr><td class="ar">↓</td></tr>
              <tr><td>404 out</td></tr><tr><td class="ar">↓</td></tr>
              <tr><td>Return 1 → Main</td></tr>
            </table>
            <div class="m12-jacks">
              <div class="kc"><i class="r9-jack"></i><span class="r9-cap">Send 1</span></div>
              <div class="kc"><i class="r9-jack"></i><span class="r9-cap">Send 2</span></div>
            </div>
          </div>
    
          <!-- master -->
          <div class="r42-group m12-mst"><span class="r42-gt">Main Mix</span>
            <div class="m12-mst-top">
              <div class="m12-read"><div class="r42-win" id="seg" aria-label="Visor"></div><span class="r9-cap" id="seg-cap">Main · dB</span></div>
              <div class="m12-btns">
                <span class="r42-lr"><i class="led r9-led" data-led="solo"></i>Solo (PFL)</span>
                <span class="r42-lr"><i class="led r9-led" data-led="clip"></i>Clip</span>
              </div>
            </div>
            <div class="m12-mid">
              <div class="m12-meter" aria-label="Medidores L e R">
                <div class="col" id="meter-l"></div>
                <div class="sc" id="meter-sc"></div>
                <div class="col" id="meter-r"></div>
                <div class="lr"><span>L</span><span>R</span></div>
              </div>
              <div class="m12-knobs2">
                <!-- Tape: a fita no master, antes do fader Main -->
                <div class="m12-kw m12-tape"><div class="knob r9-control m12-silver" data-ctrl="tape" data-kind="tape" role="slider" tabindex="0" aria-label="Tape (fita no master)" style="--a:-135deg"><i></i></div>
                  <span class="r9-cap tl"><i class="led r9-led" data-led="tape"></i>Tape</span><span class="r9-cap r42-dim" style="font-size:7.5px;margin-top:-3px">0 = limpo</span></div>
                <div class="m12-kw det"><div class="knob r9-control m12-silver" data-ctrl="phones" data-kind="phones" role="slider" tabindex="0" aria-label="Phones" style="--a:0deg"><i></i></div><span class="r9-cap">Phones</span></div>
                <div class="r42-bk m12-learn"><span class="r42-t">Learn<i class="led r9-led" data-led="learn"></i></span><button class="r9-btn" data-ctrl="learn" aria-label="MIDI Learn"></button><span class="r9-cap r42-dim">MIDI</span></div>
                <div class="r42-bk"><span class="r42-t">Solo<br>clear</span><button class="r9-btn" data-ctrl="solo-clear" aria-label="Apagar todos os solos"></button><span class="r9-cap r42-dim">&nbsp;</span></div>
              </div>
            </div>
            <div class="m12-mst-bot">
              <div class="m12-jacks" style="margin-top:0">
                <div class="kc"><i class="r9-jack"></i><span class="r9-cap">Phones</span></div>
                <div class="kc"><i class="r9-jack"></i><span class="r9-cap">Main L</span></div>
                <div class="kc"><i class="r9-jack"></i><span class="r9-cap">Main R</span></div>
              </div>
              <span class="m12-sp"></span>
              <div class="m12-mfcol">
                <div class="m12-fz m12-mf">
                  <div class="m12-scale" data-scale></div>
                  <div class="fader m12-f" data-ctrl="main" data-kind="fader" role="slider" tabindex="0" aria-label="Main Mix" style="--v:.75"><span class="cap-f"></span></div>
                </div>
                <div class="m12-name">Main</div>
              </div>
            </div>
          </div>
        </div>
      </section>
`;
  return mount.querySelector(".m12");
};
