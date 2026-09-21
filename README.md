# War Thunder Artillery Interface Prototype

Protótipo local e somente leitura de uma interface de controle de fogo para artilharia. Consome a telemetria HTTP exposta pelo War Thunder em `127.0.0.1:8111`, desenha o mapa e o jogador em tempo real e calcula distância/azimute para múltiplos pontos marcados pelo operador.

> Este projeto não modifica o jogo, não injeta código, não automatiza disparos e não lê alvos inimigos. Os cálculos são auxiliares, bidimensionais e não consideram elevação, terreno, vento ou trajetória.

## Requisitos e execução

- Node.js 24 ou superior
- War Thunder em execução para o modo ao vivo

```powershell
npm run demo
```

Abra `http://127.0.0.1:3000`. O modo demonstração inclui mapa, veículo, munição e movimento sintéticos, permitindo testar tudo sem iniciar o jogo.

```powershell
npm start
```

O modo ao vivo tenta acessar `http://127.0.0.1:8111`. Se nenhuma partida estiver ativa, a tela permanece em estado de espera. A porta e a origem podem ser configuradas com `PORT`, `HOST` e `WT_MODE=demo`.

## Comandos

```powershell
npm test       # testes unitários e integração HTTP
npm run build  # valida sintaxe e prepara dist/
npm run dev    # servidor com reinício automático
```

## Arquitetura

```text
War Thunder :8111 ──► adapters ──► StateEngine ──► REST + SSE :3000 ──► Canvas/Vanilla JS
       (GET apenas)       │              │
                          └── normalização, catálogo, calibração e soluções 2D
```

- `src/adapters`: cliente da API local, fonte demo e normalização defensiva.
- `src/domain`: contratos e matemática de coordenadas/azimute/distância.
- `src/services`: catálogo, estado, alvos e ciclo de polling.
- `public`: frontend HTML5/CSS3/JavaScript sem framework.
- `config`: perfis versionáveis de veículos, munições e calibrações.
- `tests`: geometria, normalização e fluxo HTTP completo.
- `docs/artillery-interface-prototype-prd.md`: PRD/Design Doc completo.

## Segurança e privacidade

O servidor escuta em loopback por padrão, valida `Host`/`Origin`, não habilita CORS, limita corpos e requisições e exige token CSRF para mutações. A integração com o jogo usa somente endpoints HTTP GET documentados. A seleção de munição real permanece manual quando a telemetria não fornece identidade confiável.
