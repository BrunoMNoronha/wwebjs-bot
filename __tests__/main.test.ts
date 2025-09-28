import type { Message } from 'whatsapp-web.js';
import { createApplicationContainer, type ApplicationContainer } from '../src/application/container';

jest.mock('whatsapp-web.js', () => {
  class FakeEventEmitter {
    private readonly handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

    on(event: string, fn: (...args: unknown[]) => void): void {
      this.handlers[event] = this.handlers[event] || [];
      this.handlers[event]!.push(fn);
    }

    emit(event: string, ...args: unknown[]): void {
      const listeners = this.handlers[event] || [];
      for (const listener of listeners) {
        listener(...args);
      }
    }
  }

  class Client extends FakeEventEmitter {
    public readonly opts: Record<string, unknown>;
    public initialized = false;
    public lastMessage?: { to: string; content: string };

    constructor(opts: Record<string, unknown> = {}) {
      super();
      this.opts = opts;
    }

    initialize(): void {
      this.initialized = true;
      this.emit('ready');
    }

    async sendMessage(to: string, content: string): Promise<{ to: string; content: string }> {
      this.lastMessage = { to, content };
      return this.lastMessage;
    }

    async destroy(): Promise<void> {
      this.initialized = false;
    }
  }

  class LocalAuth {}

  return { Client, LocalAuth };
});

jest.mock('qrcode-terminal', () => ({ generate: jest.fn() }));

interface MessageFactoryOptions {
  readonly from?: string;
  readonly body?: string;
  readonly fromMe?: boolean;
}

function makeMessage({ from = '123@c.us', body = '', fromMe = false }: MessageFactoryOptions = {}): Message {
  return {
    from,
    body,
    fromMe,
  } as unknown as Message;
}

describe('Fluxos de menu (texto via FlowEngine)', () => {
  let container: ApplicationContainer;

  beforeAll(async () => {
    jest.resetModules();
    process.env.MENU_FLOW = '1';
    container = createApplicationContainer();
    await container.start();
  });

  beforeEach(() => {
    const client = container.client as unknown as { lastMessage?: { to: string; content: string } };
    client.lastMessage = undefined;
  });

  afterAll(async () => {
    await container?.stop();
  });

  test('!menu inicia o fluxo e envia prompt com opções', async () => {
    const msg = makeMessage({ body: '!menu' });
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', msg);
    await new Promise((resolve) => setImmediate(resolve));
    const lastMessage = (container.client as unknown as { lastMessage?: { content: string } }).lastMessage;
    expect(typeof lastMessage?.content).toBe('string');
    expect(lastMessage?.content).toMatch(/Como podemos te ajudar hoje\?/i);
    expect(lastMessage?.content).toMatch(/1\.[\s\S]*Solicitar orçamento/i);
  });

  test('!lista também inicia o fluxo de menu', async () => {
    const msg = makeMessage({ body: '!lista' });
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', msg);
    await new Promise((resolve) => setImmediate(resolve));
    const lastMessage = (container.client as unknown as { lastMessage?: { content: string } }).lastMessage;
    expect(typeof lastMessage?.content).toBe('string');
    expect(lastMessage?.content).toMatch(/Como podemos te ajudar hoje\?/i);
  });

  test('responder 1 após !menu encerra com instruções de orçamento', async () => {
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', makeMessage({ body: '!menu' }));
    await new Promise((resolve) => setImmediate(resolve));
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', makeMessage({ body: '1' }));
    await new Promise((resolve) => setImmediate(resolve));
    const lastMessage = (container.client as unknown as { lastMessage?: { content: string } }).lastMessage;
    expect(String(lastMessage?.content)).toMatch(/envi(e|ar) uma foto/i);
  });

  test('ignora mensagens enviadas por mim (fromMe)', async () => {
    const msg = makeMessage({ body: '!menu', fromMe: true });
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', msg);
    await new Promise((resolve) => setImmediate(resolve));
    const lastMessage = (container.client as unknown as { lastMessage?: { content: string } }).lastMessage;
    expect(lastMessage).toBeUndefined();
  });
});
