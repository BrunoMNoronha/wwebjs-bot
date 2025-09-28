jest.mock('whatsapp-web.js', () => {
  class FakeEventEmitter {
    constructor() { this.handlers = {}; }
    on(event, fn) {
      this.handlers[event] = this.handlers[event] || [];
      this.handlers[event].push(fn);
    }
    emit(event, ...args) {
      const fns = this.handlers[event] || [];
      for (const fn of fns) fn(...args);
    }
  }
  class Client extends FakeEventEmitter {
    constructor(opts = {}) { super(); this.opts = opts; this.initialized = false; }
    initialize() { this.initialized = true; this.emit('ready'); }
    async sendMessage(to, content) { this.lastMessage = { to, content }; return this.lastMessage; }
  }
  class LocalAuth { constructor() {} }
  return { Client, LocalAuth };
});
jest.mock('qrcode-terminal', () => ({ generate: jest.fn() }));

function makeMessage({ from = '123@c.us', body = '', fromMe = false } = {}) {
  return { from, body, fromMe };
}

describe('Fluxos de menu (texto via FlowEngine)', () => {
  let app;

  beforeAll(async () => {
    jest.resetModules();
    process.env.MENU_FLOW = '1';
    const { createApp } = require('../src/app/appFactory');
    const { flow: MenuFlow } = require('../src/flows/menu');

    app = createApp({
      buildHandlers: ({ client, rate, flowEngine }) => {
        const recentFlowPromptAt = new Map();
        const sendSafe = async (chatId, content) => rate.withSend(chatId, () => client.sendMessage(chatId, content));
        const handleIncoming = async (message) => {
          if (!message || message.fromMe) return;
          const raw = typeof message.body === 'string' ? message.body : '';
          const body = raw.toLowerCase().trim();
          if (body === '!menu' || body === '!lista') {
            const start = await flowEngine.start(message.from, MenuFlow);
            if (!start.ok) { await sendSafe(message.from, 'Fluxo indisponível no momento.'); return; }
            const node = start.node;
            await sendSafe(message.from, node.prompt + '\n' + node.options.map((o, i) => `${i + 1}. ${o.text}`).join('\n'));
            recentFlowPromptAt.set(message.from, Date.now());
            return;
          }
          if (body && !body.startsWith('!')) {
            const active = await flowEngine.isActive(message.from);
            if (!active) return;
            const res = await flowEngine.advance(message.from, body);
            if (!res.ok && res.error === 'input_invalido') { await sendSafe(message.from, 'Não entendi. Por favor, escolha uma das opções listadas.'); return; }
            if (!res.ok) { await sendSafe(message.from, 'Ocorreu um erro no fluxo. Encerrando.'); return; }
            if (res.terminal) { if (res.prompt) await sendSafe(message.from, res.prompt); return; }
            const text = res.prompt + '\n' + (res.options || []).join('\n');
            await sendSafe(message.from, text);
            recentFlowPromptAt.set(message.from, Date.now());
          }
        };
        return { handleIncoming };
      }
    });
    await app.start();
  });

  beforeEach(() => {
    app.client.lastMessage = undefined;
  });

  afterAll(async () => {
    await app?.stop?.();
  });

  test('!menu inicia o fluxo e envia prompt com opções', async () => {
    const msg = makeMessage({ body: '!menu' });
    app.client.emit('message_create', msg);
    await new Promise(r => setImmediate(r));
    expect(typeof app.client.lastMessage.content).toBe('string');
    expect(app.client.lastMessage.content).toMatch(/Como podemos te ajudar hoje\?/i);
    expect(app.client.lastMessage.content).toMatch(/1\.[\s\S]*Solicitar orçamento/i);
  });

  test('!lista também inicia o fluxo de menu', async () => {
    const msg = makeMessage({ body: '!lista' });
    app.client.emit('message_create', msg);
    await new Promise(r => setImmediate(r));
    expect(typeof app.client.lastMessage.content).toBe('string');
    expect(app.client.lastMessage.content).toMatch(/Como podemos te ajudar hoje\?/i);
  });

  test('responder 1 após !menu encerra com instruções de orçamento', async () => {
    app.client.emit('message_create', makeMessage({ body: '!menu' }));
    await new Promise(r => setImmediate(r));
    app.client.emit('message_create', makeMessage({ body: '1' }));
    await new Promise(r => setImmediate(r));
    expect(String(app.client.lastMessage.content)).toMatch(/envi(e|ar) uma foto/i);
  });

  test('ignora mensagens enviadas por mim (fromMe)', async () => {
    const msg = makeMessage({ body: '!menu', fromMe: true });
    app.client.emit('message_create', msg);
    await new Promise(r => setImmediate(r));
    expect(app.client.lastMessage).toBeUndefined();
  });
});
