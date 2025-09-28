jest.mock('whatsapp-web.js', () => {
  const EventEmitter = require('events');
  class Client extends EventEmitter {
    constructor() {
      super();
      this.sent = [];
    }
    async initialize() {
      this.initialized = true;
    }
    async destroy() {
      this.destroyed = true;
    }
    async sendMessage(to, content) {
      const payload = { to, content };
      this.sent.push(payload);
      this.lastMessage = payload;
      return payload;
    }
  }
  class LocalAuth { constructor() {} }
  return { Client, LocalAuth };
});

jest.mock('qrcode-terminal', () => ({ generate: jest.fn() }));

describe('Fluxo recente é reiniciado com o mesmo tipo', () => {
  let app;
  const chatId = '5511987654321@c.us';

  /**
   * @param {string} body
   * @param {Record<string, unknown>} [extra]
   * @returns {Promise<void>}
   */
  const emitMessage = async (body, extra = {}) => {
    app.client.emit('message_create', { from: chatId, to: 'bot@c.us', body, fromMe: false, ...extra });
    await new Promise(r => setImmediate(r));
  };

  beforeEach(async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.MENU_FLOW = '1';
    const { app: mainApp } = require('../main');
    app = mainApp;
    await app.start();
    app.client.sent = [];
  });

  afterEach(async () => {
    delete process.env.MENU_FLOW;
    await app?.stop?.();
    jest.resetModules();
  });

  test('resposta numérica tardia reinicia o menu em vez de trocar para catálogo', async () => {
    await emitMessage('!menu');
    expect(app.client.lastMessage?.content || '').toMatch(/como podemos te ajudar hoje/i);

    await emitMessage('1');
    expect(app.client.lastMessage?.content || '').toMatch(/envie uma foto/i);

    const sentBeforeRetry = app.client.sent.length;
    await emitMessage('1');

    expect(app.client.sent.length).toBeGreaterThan(sentBeforeRetry);
    const [expired, restarted] = app.client.sent.slice(-2);
    expect(expired.content).toMatch(/sess[aã]o anterior foi encerrada/i);
    expect(restarted.content).toMatch(/como podemos te ajudar hoje/i);
    expect(restarted.content).not.toMatch(/escolha uma categoria/i);
  });
});
