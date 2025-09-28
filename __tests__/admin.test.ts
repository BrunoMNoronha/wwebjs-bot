import { EventEmitter } from 'events';
import type { Message } from 'whatsapp-web.js';
import { createApplicationContainer, type ApplicationContainer } from '../src/application/container';
import { createCommandRegistry } from '../src/app/commandRegistry';
import type { ConsoleLikeLogger } from '../src/infrastructure/logging/createConsoleLikeLogger';

jest.mock('whatsapp-web.js', () => {
  class Client extends EventEmitter {
    public initialized = false;
    public destroyed = false;
    public lastMessage?: { to: string; content: string };

    async initialize(): Promise<void> {
      this.initialized = true;
      this.emit('ready');
    }

    async destroy(): Promise<void> {
      this.destroyed = true;
    }

    async sendMessage(to: string, content: string): Promise<void> {
      this.lastMessage = { to, content };
    }
  }

  class LocalAuth {}

  return { Client, LocalAuth };
});

jest.mock('qrcode-terminal', () => ({ generate: jest.fn() }));
jest.mock('dotenv');

const MY_ID = '5561985307168@c.us';

type CommandRegistryDeps = Parameters<typeof createCommandRegistry>[0];
type CommandRegistry = ReturnType<typeof createCommandRegistry>;

type ConsoleLikeLoggerMock = ConsoleLikeLogger & {
  log: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug?: jest.Mock;
};

function createMockLogger(): ConsoleLikeLoggerMock {
  return {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function buildAdminRegistry(overrides: Partial<CommandRegistryDeps> = {}): {
  registry: CommandRegistry;
  mocks: {
    sendSafe: jest.Mock;
    gracefulShutdown: jest.Mock;
    gracefulRestart: jest.Mock;
  };
  logger: ConsoleLikeLogger;
} {
  const sendSafeMock = overrides.sendSafe ? (overrides.sendSafe as jest.Mock) : jest.fn().mockResolvedValue(undefined);
  const gracefulShutdownMock = overrides.gracefulShutdown ? (overrides.gracefulShutdown as jest.Mock) : jest.fn().mockResolvedValue(undefined);
  const gracefulRestartMock = overrides.gracefulRestart ? (overrides.gracefulRestart as jest.Mock) : jest.fn().mockResolvedValue(undefined);
  const logger: ConsoleLikeLogger = overrides.logger ?? createMockLogger();

  const deps: CommandRegistryDeps = {
    sendSafe: sendSafeMock,
    sendFlowPrompt: jest.fn().mockResolvedValue(undefined),
    clearFlowPrompt: jest.fn(),
    flowEngine: {
      start: jest.fn().mockResolvedValue({ ok: false }),
    },
    menuFlow: {},
    catalogFlow: {},
    menuFlowEnabled: true,
    gracefulShutdown: gracefulShutdownMock,
    gracefulRestart: gracefulRestartMock,
    welcomeText: 'welcome',
    flowUnavailableText: 'unavailable',
    shutdownNotice: 'shutdown',
    restartNotice: 'restart',
    shouldExitOnShutdown: false,
    ...overrides,
    logger,
  };

  return {
    registry: createCommandRegistry(deps),
    mocks: { sendSafe: sendSafeMock, gracefulShutdown: gracefulShutdownMock, gracefulRestart: gracefulRestartMock },
    logger,
  };
}

function createOwnerContext(overrides: Partial<{ isOwner: boolean; fromSelf: boolean }> = {}): { isOwner: boolean; fromSelf: boolean } {
  return { isOwner: true, fromSelf: false, ...overrides };
}

function createIncomingMessage(body: string): { from: string; body: string; fromMe?: boolean } {
  return { from: '123@c.us', body };
}

describe('Admin commands (!shutdown) with self-testing', () => {
  let container: ApplicationContainer;

  const emitMessage = async (body: string): Promise<void> => {
    const client = container.client as unknown as EventEmitter;
    const message = { from: MY_ID, fromMe: true, body } as Message;
    client.emit('message', message);
    await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(async () => {
    process.env.NODE_ENV = 'test';
    process.env.OWNER_ID = MY_ID;
    process.env.ALLOW_SELF_ADMIN = '1';
    container = createApplicationContainer();
    await container.start();
  });

  afterEach(async () => {
    delete process.env.OWNER_ID;
    delete process.env.ALLOW_SELF_ADMIN;
    await container?.stop();
  });

  test('!shutdown enviado por mim mesmo executa gracefulShutdown sem loop', async () => {
    await emitMessage('!shutdown');
    const client = container.client as unknown as { destroyed?: boolean };
    expect(client.destroyed).toBe(true);
  });

  test('!restart enviado por mim mesmo destrói e inicializa novamente', async () => {
    const client = container.client as unknown as { initialized?: boolean; destroyed?: boolean };
    expect(client.initialized).toBeFalsy();

    await emitMessage('!restart');

    expect(client.destroyed).toBe(true);
    expect(client.initialized).toBe(true);
  });
});

describe('Command registry admin notifications', () => {
  test('gracefulShutdown executa mesmo que o aviso falhe', async () => {
    const failure = new Error('network down');
    const logger = createMockLogger();
    const { registry, mocks } = buildAdminRegistry({ sendSafe: jest.fn().mockRejectedValue(failure), logger });

    const handled = await registry.run('!shutdown', createIncomingMessage('!shutdown') as unknown as Message, createOwnerContext());

    expect(handled).toBe(true);
    expect(mocks.sendSafe).toHaveBeenCalledWith('123@c.us', 'shutdown');
    expect(mocks.gracefulShutdown).toHaveBeenCalledWith({ exit: false });
    expect(mocks.gracefulRestart).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test('gracefulRestart executa mesmo que o aviso falhe', async () => {
    const failure = new Error('offline');
    const logger = createMockLogger();
    const { registry, mocks } = buildAdminRegistry({ sendSafe: jest.fn().mockRejectedValue(failure), logger });

    const handled = await registry.run('!restart', createIncomingMessage('!restart') as unknown as Message, createOwnerContext());

    expect(handled).toBe(true);
    expect(mocks.sendSafe).toHaveBeenCalledWith('123@c.us', 'restart');
    expect(mocks.gracefulRestart).toHaveBeenCalled();
    expect(mocks.gracefulShutdown).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
