# RJ-1202

O mixer do DCX Studio, no navegador: uma mesa compacta de 12 canais dos anos 90 (referência: Mackie 1202-VLZ) com 5 canais, EQ de 3 bandas, low cut, 2 aux, 2 retornos e o Tape (fita) no master. Projeto open source da [DCX Audio](https://github.com/dcxaudio), irmão do RJ-2000, do RJ-950, do RJ-42 e do DCX 404. Substitui o RJ-45 (que foi para `protótipos`).

- **5 canais**, cada um com seletor de **fonte**: RJ-2000 inteiro, banco A, B, C ou D, RJ-950, DCX 404 ou Line. Trim, Low Cut (75 Hz, 18 dB/oitava), Aux 1 e Aux 2, EQ Hi 12 kHz / Mid 2,5 kHz / Low 80 Hz, Pan, Mute, Solo (PFL), fader.
- **Aux, retornos e master:** Aux 1 Master e chave Pre/Post, Return 1 (a volta do DCX 404) e Return 2, Tape antes do fader Main, Phones, medidores L/R. Sem efeitos no mixer: o efeito é o DCX 404, ligado por Aux 1 → 404 → Return 1.
- **DCX 404 como fonte de um canal:** o Aux 1 daquele canal trava em zero (senão o 404 realimenta a si mesmo).
- **RJ-42:** sem canal, entra direto no master.
- **66 controles com MIDI Learn.** Estado salvo no navegador com o prefixo `rj1202/`.
- O manual está em [docs/manual.md](docs/manual.md).

Na página solo o mixer roda com um **host de teste** no lugar das outras máquinas (cada fonte é um som de mentira). No **DCX Studio** (etapa 2) as fontes são as de verdade: o RJ-2000 (inteiro ou por banco A a D, que precisa do `engine.js` com `setBankRouted`), o RJ-950, o DCX 404 e o Line; o Aux 1 vai para o 404 e volta pelo Return 1, e o Tape do master é o do Studio.

## Rodar no seu computador

```bash
cd rj-1202 && python3 -m http.server 8412
```

Depois abra `http://localhost:8412` e toque em LIGAR. Não tem build nem dependências. O AudioWorklet precisa de `http://` (não abre por `file://`) e o MIDI, de Chrome, Edge ou Opera. Com `?silent` na URL nada sai pelo alto-falante (para testar).

## Teste sem som

```bash
node tests/sim.js
```

Renderiza o mixer fora do navegador (nada toca) e mede EQ, low cut, pan, mute, solo, aux, retornos, master, medidores e o Tape contra os valores do manual do 1202-VLZ. Detalhes em [docs/manual.md](docs/manual.md#teste).

## Estrutura

```
index.html            página solo (host do dcx-core com só o RJ-1202 e o host de teste)
js/mixer.js           o mixer: DSP puro (roda no worklet e no Node) e as regras (fontes, estado, mapas dos controles)
js/worklet.js         os dois AudioWorkletProcessors (canais e master; o Tape fica entre eles)
js/panel.js           o HTML do painel (página solo e Studio)
js/rj1202.js          o aparelho: painel, fontes, Tape, MIDI Learn, medidores e armazenamento
js/testhost.js        sons de mentira no lugar das outras máquinas (só na página solo)
js/solo.js            monta a página: host, tela de ligar
css/rj1202.css        o painel (mockup aprovado)
tests/sim.js          teste sem som
docs/manual.md        manual curto
vendor/dcx-core/      submódulo do dcx-core v1.1.0
```

## Licença

GPL-3.0 ([LICENSE](LICENSE)).


---

Projeto independente, sem vínculo com os fabricantes dos equipamentos que inspiraram as máquinas. Os nomes SP-1200, SP-404, S950 e 1202 pertencem a seus donos e aparecem só em texto, como referência.

*Independent project, not affiliated with the makers of the gear that inspired the machines; names belong to their owners and appear as text only, for reference.*
