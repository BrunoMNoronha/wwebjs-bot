# WhatsApp Bot - wwebjs-bot

Um bot para WhatsApp construído com Node.js usando a biblioteca `whatsapp-web.js`, com sistema de fluxos conversacionais e gerenciamento de estado plugável.

## 🚀 Características

- **Sistema de Fluxos**: Engine de fluxos conversacionais com estados persistentes
- **Rate Limiting**: Controle de taxa de mensagens para evitar bloqueios
- **Armazenamento Plugável**: Suporte a armazenamento em memória e Redis
- **Autenticação Segura**: Sistema de reautenticação segura com fallbacks
- **Validação Robusta**: Validadores para fluxos e respostas de usuários
- **Testes Automatizados**: Suite completa de testes com Jest

## 📋 Pré-requisitos

- Node.js 16+ 
- NPM ou Yarn
- WhatsApp instalado no celular
- Redis (opcional, para armazenamento persistente)

## 🛠️ Instalação

1. Clone o repositório:
```bash
git clone https://github.com/BrunoMNoronha/wwebjs-bot
cd wwebjs-bot
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente (opcional):
```bash
# Copie o arquivo de exemplo
cp .env.example .env

# Configure as variáveis conforme necessário
MENU_FLOW=1          # Habilita fluxo de menu (padrão: desabilitado)
REDIS_URL=...        # URL do Redis (opcional)
NODE_ENV=production  # Ambiente de execução
```

## 🚀 Como usar

### Primeira execução

1. Execute o bot:
```bash
npm start
```

2. Escaneie o QR Code que aparecerá no terminal com seu WhatsApp
3. Aguarde a confirmação de conexão

### Comandos disponíveis

- `!menu` ou `!lista` - Inicia o fluxo de menu (se `MENU_FLOW=1`)
- `!fluxo` - Inicia o fluxo de catálogo
- Respostas numéricas (1, 2, 3...) - Navega pelos fluxos ativos

## 🏗️ Arquitetura

### Estrutura do projeto

```
src/
├── config/
│   └── messages.js          # Textos e prompts da UI
├── flow-runtime/
│   └── engine.js           # Engine de fluxos conversacionais
├── flows/
│   ├── catalog.js          # Fluxo de catálogo
│   └── menu.js             # Fluxo de menu baseado em texto
├── rate-control/
│   └── controller.js       # Controle de taxa de mensagens
├── store/
│   ├── memory.js           # Armazenamento em memória
│   └── redis.js            # Armazenamento Redis (opcional)
└── validation/
    ├── answers.js          # Validação de respostas
    └── flows.js            # Validação de fluxos

__tests__/                  # Testes automatizados
__mocks__/                  # Mocks para testes
```

### Componentes principais

#### 1. **Engine de Fluxos** (`src/flow-runtime/engine.js`)
- Gerencia o ciclo de vida dos fluxos conversacionais
- Persiste estado via store plugável
- Contrato de fluxos: `{ start: string, nodes: { [id]: { prompt, options?, terminal? } } }`

#### 2. **Rate Controller** (`src/rate-control/controller.js`)
- Previne spam e bloqueios do WhatsApp
- Cooldown por chat e throttle global
- Desabilitado automaticamente em testes

#### 3. **Sistema de Armazenamento**
- **Memória** (`src/store/memory.js`): Padrão, dados perdidos ao reiniciar
- **Redis** (`src/store/redis.js`): Persistência entre reinicializações

#### 4. **Validadores** (`src/validation/`)
- Validação de estrutura de fluxos
- Matching inteligente de opções (números, texto, aliases)
- Simulação de fluxos para testes

## 🔄 Fluxos Conversacionais

### Estrutura de um fluxo

```javascript
const ExemploFlow = {
  start: 'welcome',
  nodes: {
    welcome: {
      prompt: 'Bem-vindo! Escolha uma opção:',
      options: [
        { id: 'opt1', text: 'Opção 1', next: 'resultado1' },
        { id: 'opt2', text: 'Opção 2', next: 'resultado2', aliases: ['dois', '2'] }
      ]
    },
    resultado1: {
      prompt: 'Você escolheu a opção 1!',
      terminal: true
    },
    resultado2: {
      prompt: 'Você escolheu a opção 2!',
      terminal: true
    }
  }
};
```

### Iniciando um fluxo

```javascript
const start = await flowEngine.start(chatId, MeuFluxo);
if (start.ok) {
  const node = start.node;
  const optionsText = node.options?.map((o,i) => `${i+1}. ${o.text}`).join('\n') || '';
  await sendSafe(chatId, node.prompt + '\n' + optionsText);
}
```

### Avançando no fluxo

```javascript
const res = await flowEngine.advance(chatId, userInput);
if (res.ok && !res.terminal) {
  const optionsText = res.options?.map((o,i) => `${i+1}. ${o.text}`).join('\n') || '';
  await sendSafe(chatId, res.prompt + '\n' + optionsText);
}
```

## 🧪 Testes

Execute os testes:
```bash
npm test
```

Execute com cobertura:
```bash
npm run test:coverage
```

### Padrões de teste

- Mocks manuais para `whatsapp-web.js` e `qrcode-terminal`
- Simulação de eventos via `client.emit('message_create', msg)`
- Rate limiting desabilitado automaticamente
- Cleanup de timers com `rate?.stop?.()`

## 🔧 Desenvolvimento

### Adicionando novo fluxo

1. Crie o arquivo em `src/flows/meu-fluxo.js`
2. Implemente a estrutura de contrato
3. Registre no handler principal
4. Adicione testes correspondentes

### Modificando comportamento

- **Textos/Prompts**: `src/config/messages.js`
- **Lógica de fluxos**: `src/flow-runtime/engine.js`
- **Rate limiting**: `src/rate-control/controller.js`
- **Handler principal**: `main.js`

## ⚙️ Configuração

### Variáveis de ambiente

| Variável | Descrição | Padrão |
|----------|-----------|---------|
| `MENU_FLOW` | Habilita fluxo de menu para `!menu`/`!lista` | `0` |
| `REDIS_URL` | URL de conexão Redis | - |
| `NODE_ENV` | Ambiente de execução | `development` |

### Comportamento especial

- **Windows**: Sistema de reautenticação segura com retry para evitar locks de arquivo
- **Rate Limiting**: Cooldown de 1s por chat, throttle global
- **Sessões Expiradas**: Dica automática para comandos numéricos sem contexto ativo

## 🐛 Solução de problemas

### QR Code não aparece
- Verifique se o terminal suporta exibição de imagens
- Tente limpar o diretório `.wwebjs_auth`

### Bot não responde
- Verifique se não está marcado como spam pelo WhatsApp
- Observe os logs para erros de rate limiting
- Confirme que a sessão está ativa

### Erro EBUSY no Windows
- O sistema de reautenticação segura trata automaticamente
- Aguarde alguns segundos para retry automático

### Redis não conecta
- Verifique se o Redis está rodando
- Confirme a URL de conexão
- O bot funciona sem Redis (modo memória)

## 📝 Licença

[Especificar licença do projeto]

## 🤝 Contribuição

1. Fork o projeto
2. Crie sua feature branch (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

---

**Nota**: Este bot respeita os Termos de Serviço do WhatsApp. Use responsavelmente e evite spam.