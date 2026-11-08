# Changelog

## v0.2 (rascunho local): etapa 2, o mixer no DCX Studio

- **No DCX Studio** (`dcx-studio/js/rj1202-studio.js`): o RJ-1202 vira uma máquina do rack, numa faixa nova logo acima da barra de baixo. Cada canal tem a fonte de verdade: RJ-2000 inteiro, banco A a D (saídas `rj2000-A`... do RJ-2000), RJ-950, DCX 404 e Line (microfone). Fonte roteada para um canal sai do caminho direto (nada toca em dobro) e trocar a fonte desfaz a rota antiga. RJ-42 sem canal, entra direto no master do mixer.
- **DCX 404 no mixer:** o Aux 1 entra no 404 e a saída dele volta pelo Return 1; com o 404 como fonte de um canal, a saída dele vai para o canal (não para o Return 1) e o Aux 1 do canal fica em zero.
- **Tape:** o Tape do master do mixer passa a ser o do Studio (o slider da barra sai quando o mixer liga). Um Tape antigo (da barra, ou de um projeto .zip de antes do mixer) vira o Tape do mixer.
- **Projeto:** o disquete do RJ-1202 (estado do mixer e fontes) entra no .zip do projeto; zips antigos continuam abrindo.
- Novo: `js/panel.js` (o HTML do painel, para a página solo e o Studio usarem o mesmo), opções do aparelho `base`, `outputId`, `onSources`, `learnPrefix`, `state`, e métodos `applyState`, `setTape`, `usedSources`. O CSS das peças emprestadas das outras máquinas agora vale só dentro de `.m12` (`:where(.m12)`), para não mudar o RJ-2000, o 950, o 42 e o 404 no Studio; `--scale` virou `--m12-scale`.
- O teste `node tests/sim.js` não mudou (90 verificações).

## v0.1 (rascunho local, ainda sem repositório)

Etapa 1: o mixer como máquina, rodando sozinho. Painel do mockup aprovado por Igor em 08/11/2026 (`dcx-design/rj-1202/mockup.html`), host do [dcx-core](https://github.com/dcxaudio/dcx-core) v1.1.0 (cópia em `vendor/dcx-core`, vira submódulo quando o repositório existir). Os dados ficam no navegador com o prefixo `rj1202/`.

- 5 canais, cada um: seletor de fonte (RJ-2000 inteiro, bancos A a D, RJ-950, DCX 404, Line), Trim (-10 a +40 dB), Low Cut (75 Hz, 18 dB/oitava, Butterworth de 3ª ordem), Aux 1 e Aux 2 (off, U, +15 dB), EQ de 3 bandas (Hi 12 kHz shelf ±15, Mid 2,5 kHz sino ±12, Low 80 Hz shelf ±15), Pan de loudness constante (-4 dB no centro), Mute, Solo (PFL), fader de curso curto (U em 3/4, +10 dB no topo) e LEDs Sig e OL.
- Retornos Return 1 e Return 2 (até +20 dB) direto no master, Aux 1 Master (até +10 dB) com a chave Pre/Post, entrada direta para o RJ-42 (sem canal).
- Master: Tape (`RJ.Tape` do dcx-core) só no master, antes do fader Main; fader Main (+10 dB), Phones, medidores L/R de 12 LEDs (0 dB do medidor = -12 dBFS), Solo e Clip. Sem efeitos no mixer.
- DCX 404 como fonte de um canal trava o Aux 1 do canal em zero (o knob apaga e não gira; ao trocar de fonte volta ao valor de antes).
- 66 controles com MIDI Learn (12 por canal e 6 do master). Fora do Learn: o botão Learn, Solo clear, a chave Pre/Post e o Aux 1 de um canal travado.
- Mixer em dois AudioWorklets (canais; master) com o Tape no meio; as fontes entram por `host.route(<fonte>, <entrada do canal>, { dry: false })`.
- Página solo com host de teste (sons de mentira por fonte, eco no Aux 1 → Return 1 no papel do 404, som direto no master no papel do RJ-42, entrada de microfone na Line).
- `tests/sim.js`: teste sem som (90 verificações) contra os números do manual do 1202-VLZ.
- Ainda não (etapa 2): bancos A a D separados no `engine.js` do RJ-2000, fontes de verdade por canal, Aux 1 → 404 → Return 1 com o 404 real, Tape do master no lugar do slider da barra do Studio, encaixe no Studio.
