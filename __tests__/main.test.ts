import type { Message } from 'whatsapp-web.js';
import { List } from 'whatsapp-web.js';
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
    public lastMessage?: { to: string; content: unknown };
    public sentMessages: Array<{ to: string; content: unknown }> = [];

    constructor(opts: Record<string, unknown> = {}) {
      super();
      this.opts = opts;
    }

    initialize(): void {
      this.initialized = true;
      this.emit('ready');
    }

    async sendMessage(to: string, content: unknown): Promise<{ to: string; content: unknown }> {
      const payload = { to, content };
      this.sentMessages.push(payload);
      this.lastMessage = payload;
      return payload;
    }

    async destroy(): Promise<void> {
      this.initialized = false;
    }
  }

  class List {
    public readonly body: unknown;
    public readonly buttonText: unknown;
    public readonly sections: unknown;
    public readonly title?: unknown;

    constructor(body: unknown, buttonText: unknown, sections: unknown, title?: unknown) {
      this.body = body;
      this.buttonText = buttonText;
      this.sections = sections;
      this.title = title;
    }
  }

  class LocalAuth {}

  return { Client, LocalAuth, List };
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

  const flushDelays = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setImmediate(resolve));
  };

  beforeAll(async () => {
    jest.resetModules();
    process.env.MENU_FLOW = '1';
    container = createApplicationContainer({ responseDelay: { baseDelayMs: 1, factor: 1.01 } });
    await container.start();
  });

  beforeEach(() => {
    const client = container.client as unknown as {
      lastMessage?: { to: string; content: unknown };
      sentMessages: Array<{ to: string; content: unknown }>;
    };
    client.lastMessage = undefined;
    client.sentMessages = [];
  });

  afterAll(async () => {
    await container?.stop();
  });

  test('!menu inicia o fluxo e envia prompt com opções', async () => {
    const msg = makeMessage({ body: '!menu' });
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', msg);
    await flushDelays();
    await flushDelays();
    const client = container.client as unknown as {
      sentMessages: Array<{ content: unknown }>;
    };
    expect(client.sentMessages.length).toBeGreaterThanOrEqual(1);
    const hasWelcomeText = client.sentMessages.some((message) =>
      typeof message.content === 'string' && /Como podemos te ajudar hoje\?/i.test(String(message.content)),
    );
    expect(hasWelcomeText).toBe(true);
    const hasMenuTemplate = client.sentMessages.some((message) => message.content instanceof List);
    expect(hasMenuTemplate).toBe(true);
  });

  test('!lista também inicia o fluxo de menu', async () => {
    const msg = makeMessage({ body: '!lista' });
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', msg);
    await flushDelays();
    await flushDelays();
    const client = container.client as unknown as {
      sentMessages: Array<{ content: unknown }>;
    };
    expect(client.sentMessages.length).toBeGreaterThanOrEqual(1);
    const hasWelcomeText = client.sentMessages.some((message) =>
      typeof message.content === 'string' && /Como podemos te ajudar hoje\?/i.test(String(message.content)),
    );
    expect(hasWelcomeText).toBe(true);
    const hasMenuTemplate = client.sentMessages.some((message) => message.content instanceof List);
    expect(hasMenuTemplate).toBe(true);
  });

  test('responder 1 após !menu encerra com instruções de orçamento', async () => {
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', makeMessage({ body: '!menu' }));
    await flushDelays();
    await flushDelays();
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', makeMessage({ body: '1' }));
    await flushDelays();
    const client = container.client as unknown as { lastMessage?: { content: unknown } };
    expect(String(client.lastMessage?.content)).toMatch(/envi(e|ar) uma foto/i);
  });

  test('ignora mensagens enviadas por mim (fromMe)', async () => {
    const msg = makeMessage({ body: '!menu', fromMe: true });
    (container.client as unknown as { emit: (event: string, message: Message) => void }).emit('message', msg);
    await flushDelays();
    const lastMessage = (container.client as unknown as { lastMessage?: { content: unknown } }).lastMessage;
    expect(lastMessage).toBeUndefined();
  });
});
