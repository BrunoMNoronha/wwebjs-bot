# wwebjs-bot

Bot simples usando whatsapp-web.js com menus de texto, lista e botões, além de utilitários de validação de opções/fluxos.

## Requisitos
- Node.js 18+
- WhatsApp com sessão autenticada (a lib gerará um QR Code no primeiro start)

## Instalação
```powershell
npm install
```

## Executar em desenvolvimento
```powershell
npm start
```
Se for a primeira vez, escaneie o QR Code no terminal.

## Testes
```powershell
npm test
```

## Estrutura
- `main.js`: inicialização do cliente e handlers de mensagens.
- `src/validation/answers.js`: validação de opções e matcher.
- `src/validation/flows.js`: validação e simulação de fluxos de decisão.
- `__tests__/`: testes unitários e mocks.

## Notas
- Em `main.js` há um backoff exponencial simples para reconexão quando desconectado.
- Em ambiente de teste (`NODE_ENV=test`) o cliente não é inicializado e as dependências são mockadas.
