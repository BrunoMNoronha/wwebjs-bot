jest.mock('whatsapp-web.js', () => {
  const EventEmitter = require('events');
  class Client extends EventEmitter {
    async initialize() { this.initialized = true; this.emit('ready'); }
    async destroy() { this.destroyed = true; }
    async sendMessage(to, content) { this.lastMessage = { to, content }; }
  }
  class LocalAuth { constructor() {} }
  return { Client, LocalAuth };
});
jest.mock('qrcode-terminal', () => ({ generate: jest.fn() }));

const MY_ID = '5561985307168@c.us';

describe('Admin commands (!shutdown) with self-testing', () => {
  let app;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.OWNER_ID = MY_ID;
    process.env.ALLOW_SELF_ADMIN = '1';
    const { app: mainApp } = require('../main');
    app = mainApp;
    await app.start();
  });

  afterAll(async () => {
    delete process.env.OWNER_ID;
    delete process.env.ALLOW_SELF_ADMIN;
    await app?.stop?.();
  });

  test('!shutdown enviado por mim mesmo executa gracefulShutdown sem loop', async () => {
    const msg = { from: MY_ID, fromMe: true, body: '!shutdown' };
    app.client.emit('message', msg);
    await new Promise(r => setImmediate(r));
    expect(app.client.destroyed).toBe(true);
  });

  test('!restart enviado por mim mesmo destrói e inicializa novamente', async () => {
    // Recria app porque no teste anterior destruímos o client
    const { app: mainApp } = require('../main');
    app = mainApp;
    await app.start();

    expect(app.client.initialized).toBeFalsy(); // em NODE_ENV=test, start não chama initialize

    const msg = { from: MY_ID, fromMe: true, body: '!restart' };
    app.client.emit('message', msg);
    await new Promise(r => setImmediate(r));

    expect(app.client.destroyed).toBe(true);
    expect(app.client.initialized).toBe(true);
  });
});
