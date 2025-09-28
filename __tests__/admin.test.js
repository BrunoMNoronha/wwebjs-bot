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
jest.mock('dotenv');

const MY_ID = '5561985307168@c.us';
const { createCommandRegistry } = require('../src/app/commandRegistry');

/** @typedef {Parameters<typeof createCommandRegistry>[0]} CommandRegistryDeps */
/** @typedef {ReturnType<typeof createCommandRegistry>} CommandRegistry */

/**
 * @param {Partial<CommandRegistryDeps>} overrides
 * @returns {{ registry: CommandRegistry, mocks: { sendSafe: jest.Mock, gracefulShutdown: jest.Mock, gracefulRestart: jest.Mock } }}
 */
function buildAdminRegistry(overrides = {}) {
  const sendSafeMock = overrides.sendSafe ? /** @type {jest.Mock} */ (overrides.sendSafe) : jest.fn().mockResolvedValue(undefined);
  const gracefulShutdownMock = overrides.gracefulShutdown ? /** @type {jest.Mock} */ (overrides.gracefulShutdown) : jest.fn().mockResolvedValue(undefined);
  const gracefulRestartMock = overrides.gracefulRestart ? /** @type {jest.Mock} */ (overrides.gracefulRestart) : jest.fn().mockResolvedValue(undefined);

  /** @type {CommandRegistryDeps} */
  const deps = {
    sendSafe: sendSafeMock,
    sendFlowPrompt: jest.fn().mockResolvedValue(undefined),
    clearFlowPrompt: jest.fn(),
    flowEngine: {
      start: jest.fn().mockResolvedValue({ ok: false }),
    },
    menuFlow: {},
    catalogFlow: {},
    gracefulShutdown: gracefulShutdownMock,
    gracefulRestart: gracefulRestartMock,
    welcomeText: 'welcome',
    flowUnavailableText: 'unavailable',
    shutdownNotice: 'shutdown',
    restartNotice: 'restart',
    shouldExitOnShutdown: false,
    ...overrides,
  };

  return { registry: createCommandRegistry(deps), mocks: { sendSafe: sendSafeMock, gracefulShutdown: gracefulShutdownMock, gracefulRestart: gracefulRestartMock } };
}

/**
 * @param {Partial<{ isOwner: boolean; fromSelf: boolean }>} overrides
 * @returns {{ isOwner: boolean; fromSelf: boolean }}
 */
function createOwnerContext(overrides = {}) {
  return { isOwner: true, fromSelf: false, ...overrides };
}

/**
 * @param {string} body
 * @returns {{ from: string; body: string; fromMe?: boolean }}
 */
function createIncomingMessage(body) {
  return { from: '123@c.us', body };
}

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
    /** @type {{ from: string; fromMe: boolean; body: string }} */
    const msg = { from: MY_ID, fromMe: true, body: '!shutdown' };
    app.client.emit('message_create', msg);
    await new Promise(r => setImmediate(r));
    expect(app.client.destroyed).toBe(true);
  });

  test('!restart enviado por mim mesmo destrói e inicializa novamente', async () => {
    // Recria app porque no teste anterior destruímos o client
    const { app: mainApp } = require('../main');
    app = mainApp;
    await app.start();

    expect(app.client.initialized).toBeFalsy(); // em NODE_ENV=test, start não chama initialize

    /** @type {{ from: string; fromMe: boolean; body: string }} */
    const msg = { from: MY_ID, fromMe: true, body: '!restart' };
    app.client.emit('message_create', msg);
    await new Promise(r => setImmediate(r));

    expect(app.client.destroyed).toBe(true);
    expect(app.client.initialized).toBe(true);
  });
});

describe('Command registry admin notifications', () => {
  /** @type {jest.SpyInstance} */
  let warnSpy;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test('gracefulShutdown executa mesmo que o aviso falhe', async () => {
    const failure = new Error('network down');
    const { registry, mocks } = buildAdminRegistry({ sendSafe: jest.fn().mockRejectedValue(failure) });

    const handled = await registry.run('!shutdown', createIncomingMessage('!shutdown'), createOwnerContext());

    expect(handled).toBe(true);
    expect(mocks.sendSafe).toHaveBeenCalledWith('123@c.us', 'shutdown');
    expect(mocks.gracefulShutdown).toHaveBeenCalledWith({ exit: false });
    expect(mocks.gracefulRestart).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('gracefulRestart executa mesmo que o aviso falhe', async () => {
    const failure = new Error('offline');
    const { registry, mocks } = buildAdminRegistry({ sendSafe: jest.fn().mockRejectedValue(failure) });

    const handled = await registry.run('!restart', createIncomingMessage('!restart'), createOwnerContext());

    expect(handled).toBe(true);
    expect(mocks.sendSafe).toHaveBeenCalledWith('123@c.us', 'restart');
    expect(mocks.gracefulRestart).toHaveBeenCalledTimes(1);
    expect(mocks.gracefulShutdown).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});
