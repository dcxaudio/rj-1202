# RJ-1202 · manual curto

Mesa de 5 canais no estilo do Mackie 1202-VLZ (manual do MicroSeries de 1997, citado como [M p.N], em `dcxaudio/pesquisa/mackie-1202vlz-referencia.md`). Sem efeitos: o efeito é o DCX 404.

## O canal (de cima para baixo)

| Controle | O que faz |
|---|---|
| **Fonte** | De onde vem o canal: RJ-2000 inteiro, banco A, B, C ou D, RJ-950, DCX 404, Line. Clique passa para a próxima, Shift+clique volta. O RJ-42 não tem canal (vai direto ao master). |
| **Trim** | Ganho de entrada, -10 a +40 dB; o U (0 dB) fica perto das 9h. Acerte com o Solo ligado: o medidor perto de 0 e nunca acima de +7 [M p.11]. |
| **Low Cut** | Passa-altas de 75 Hz, 18 dB por oitava. Ligar em microfone; em sampler, só se o grave embolar [M p.11]. |
| **Aux 1 e Aux 2** | Envio mono (soma dos dois lados). Desligado, U no centro, +15 dB no fim [M p.20]. O Aux 1 é o envio do efeito; o Aux 2 é livre e sempre pós-fader. Com o DCX 404 como fonte do canal, o Aux 1 trava em zero. |
| **EQ** | Hi 12 kHz (shelf, ±15 dB), Mid 2,5 kHz (sino, ±12 dB), Low 80 Hz (shelf, ±15 dB). Centro = plano. O Q do sino é 0,7 (o manual não publica). Use pouco, até uns 3 dB [M p.20]. |
| **Pan** | Loudness constante: no centro cada lado cai 4 dB, no canto o outro lado zera [M p.19]. O canal é estéreo; o Pan age como balanço (com a mesma coisa nos dois lados, é o pan de um canal mono). |
| **Mute** | Tira o canal do Main. O Aux 1 em Pre continua; o Aux 1 em Post e o Aux 2 calam [M p.18]. |
| **Solo** | PFL: depois do EQ, antes do fader; ignora o Mute; vários ao mesmo tempo somam. Não muda o Main. Acende o LED Solo do master, o medidor passa a mostrar o solo e os fones tocam o solo [M p.22]. Nesta página o alto-falante toca os fones no lugar do Main enquanto houver solo. |
| **Fader** | Curso curto: U a 3/4 do curso, +10 dB no topo, desligado no fundo. LED **Sig** (sinal acima de -45 dBFS) e **OL** (acima de -3 dBFS, depois do EQ). |

## Coluna Aux e master

| Controle | O que faz |
|---|---|
| **Aux 1 Mst** | Geral do Aux 1: desligado, U, +10 dB. O Aux 2 não tem master [M p.24]. |
| **Pre / Post** | Aux 1 antes ou depois do fader e do Mute. Ajuste de ligação, não aprende. |
| **Return 1 e 2** | Volta do efeito (Return 1 = DCX 404). Desligado, U, +20 dB; deixe no U e ajuste a saída do efeito. Vão direto ao Main, sem EQ, pan nem Mute [M p.13, 25]. O LED **FX in** acende com sinal no Return 1. |
| **Tape** | A fita, só no master, antes do fader Main, sobre a mistura toda (retornos incluídos). 0 = sai bit a bit igual. O LED acende acima de 0. |
| **Phones** | Nível dos fones: desligado, U, +10 dB. Os fones levam o Main, ou o solo se houver. |
| **Fader Main** | U a 3/4, +10 dB no topo. |
| **Medidores** | Duas colunas de 12 LEDs, -30 a +10, CLIP no topo. 0 dB do medidor = -12 dBFS (+10 = -2 dBFS; CLIP perto de 0 dBFS). Mostram o Main depois do fader, ou o solo. Queda de 40 dB/s. |
| **Visor** | O valor do último controle mexido (dB, "C/L/r" no pan, "t" e a porcentagem no Tape, "On" e "OFF" nas teclas). |
| **Solo clear** | Apaga todos os solos. |
| **Learn** | Liga o MIDI Learn (o mesmo da barra do alto). |

## MIDI Learn

Aperte **Learn** (painel ou barra do alto), toque num controle, mexa no controlador e aperte Enter; Delete apaga o do controle escolhido, Esc sai. Knobs e faders aprendem CC (ou pitch bend); teclas e a Fonte aprendem nota ou CC (cada aperto liga e desliga, ou passa para a próxima fonte). São **66 controles**: por canal Fonte, Trim, Low Cut, Aux 1, Aux 2, Hi, Mid, Low, Pan, Mute, Solo e fader (12 × 5) e no master Aux 1 Mst, Return 1, Return 2, Tape, Phones e Main (6). Não aprendem: o botão Learn, Solo clear, a chave Pre/Post e o Aux 1 de um canal travado pelo 404 (enquanto estiver travado). O mapa fica em `rj1202/midimap`.

## Como é feito

- Dois AudioWorklets: o primeiro tem os 5 canais, os retornos, os envios e o solo; o segundo, o fader Main, os fones e os medidores. O Tape (`RJ.Tape`, dcx-core) fica entre os dois, então pega a mistura inteira e vem antes do fader.
- Ganhos suavizados em 5 ms (sem estalo em fader, Mute e knobs). O EQ muda de coeficiente em poucos blocos; banda em 0 dB sai do caminho (cópia exata).
- Filtros de 2ª ordem do *Audio EQ Cookbook*; o low cut é Butterworth de 3ª ordem (um filtro de 1ª e um de 2ª ordem com Q 1).
- As fontes entram por `host.route(<id>, <entrada do canal>, { dry: false })` (`rj2000`, `rj2000a` a `rj2000d`, `rj950`, `dcx404`, `line`): a fonte sai do caminho direto até o limitador enquanto estiver em um canal. O host não muda.
- Estado salvo em `rj1202/state` no navegador. Um estado ilegível ou com valores fora da faixa volta ao padrão, sem erro.

## Teste

`node tests/sim.js` (nenhum som sai). Seno de amplitude conhecida em cada ponto, 48 kHz, blocos de 128 amostras; o Tape é o worklet do `vendor/dcx-core/js/tape.js` executado como está. Tolerâncias dentro de cada linha do teste. Resumo do que se mede (valores medidos na última execução):

- **EQ** [M p.20, 31]: Hi +15 em 12 kHz = +7,50 dB (metade do ganho no canto) e +14,88 em 20 kHz; Mid ±12 em 2,5 kHz = ±12,00 dB; Low +15 em 80 Hz = +7,50 dB e +14,91 em 20 Hz; centro = 0,00 dB exato.
- **Low cut** [M p.11]: -3,01 dB em 75 Hz; pior desvio contra o Butterworth ideal em 9 frequências (10 Hz a 1 kHz) 0,000 dB; inclinação 18,06 dB/oitava.
- **Pan** [M p.19]: centro -4,01 dB nos dois lados; canto 0,00 dB com o outro lado zero exato.
- **Fader, Trim, Aux, retornos, Main, Phones:** U = 0,00 dB; extremos +10, +15, +20, +40 e -10 dB medidos com erro menor que 0,02 dB; desligado = silêncio exato.
- **Mute, Solo, Aux Pre/Post, 404 travado:** conferidos (Mute ligado em movimento: salto máximo 0,0131 entre amostras; o solo não muda o Main, bit a bit).
- **Medidores:** pico 0,25 (-12 dBFS) lê -0,04 dB; -2 dBFS lê +10,00; LEDs acesos 7 de 12 em 0 dB.
- **Tape:** em 0 a saída é bit a bit igual à da mesa sem o Tape (14336 amostras); antes do fader (com o Main em -20 dB a forma de onda é a mesma, desvio 7,5e-10).
- **Estado e MIDI Learn:** 66 controles com id único, estado salvo e relido igual, estado estragado volta ao padrão.

Limite do que o teste prova: ele mede o DSP, não o ouvido. A curva real do EQ do 1202 não é publicada (só frequência, tipo e faixa) e o Q do sino é nosso.

## O que falta

- Etapa 2 (feita no DCX Studio): bancos A a D separados no `engine.js` do RJ-2000, fonte de verdade por canal, Aux 1 → 404 → Return 1 com o 404 real, Tape do master no lugar do slider da barra do Studio (o valor salvo no projeto continua abrindo), disquete do RJ-1202 no projeto. Fones sem saída própria: no Studio o botão Phones não toca em lugar nenhum (só o Solo acende o medidor).
- Ouvir e ajustar no ouvido (Igor): nível dos sons de teste, Q do sino, sensação do pan com 4 dB no centro.
- Fones sem saída própria no Studio: aqui o alto-falante troca para os fones durante o solo.
