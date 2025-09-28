import { EventEmitter } from 'events';
import type { Message } from 'whatsapp-web.js';
import { createApplicationContainer, type ApplicationContainer } from '../src/application/container';

jest.mock('whatsapp-web.js', () => {
  class Client extends EventEmitter {
    public sent: Array<{ to: string; content: string }> = [];
    public lastMessage?: { to: string; content: string };
    public initialized = false;
    public destroyed = false;

    async initialize(): Promise<void> {
      this.initialized = true;
    }

    async destroy(): Promise<void> {
      this.destroyed = true;
    }

    async sendMessage(to: string, content: string): Promise<{ to: string; content: string }> {
      const payload = { to, content };
      this.sent.push(payload);
      this.lastMessage = payload;
      return payload;
    }
  }

  class LocalAuth {}

  return { Client, LocalAuth };
});

jest.mock('qrcode-terminal', () => ({ generate: jest.fn() }));

describe('Fluxo recente é reiniciado com o mesmo tipo', () => {
  let container: ApplicationContainer;
  const chatId = '5511987654321@c.us';

  const emitMessage = async (body: string, extra: Partial<Message> = {}): Promise<void> => {
    const client = container.client as unknown as EventEmitter;
    const message = { from: chatId, to: 'bot@c.us', body, fromMe: false, ...extra } as Message;
    client.emit('message', message);
    await new Promise((resolve) => setImmediate(resolve));
  };

  beforeEach(async () => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.MENU_FLOW = '1';
    container = createApplicationContainer();
    await container.start();
    (container.client as unknown as { sent: Array<{ to: string; content: string }> }).sent = [];
  });

  afterEach(async () => {
    delete process.env.MENU_FLOW;
    await container?.stop();
  });

  test('resposta numérica tardia reinicia o menu em vez de trocar para catálogo', async () => {
    await emitMessage('!menu');
    const client = container.client as unknown as { lastMessage?: { content: string }; sent: Array<{ content: string }> };
    expect(client.lastMessage?.content || '').toMatch(/como podemos te ajudar hoje/i);

    await emitMessage('1');
    expect(client.lastMessage?.content || '').toMatch(/envie uma foto/i);

    const sentBeforeRetry = client.sent.length;
    await emitMessage('1');

    expect(client.sent.length).toBeGreaterThan(sentBeforeRetry);
    const [expired, restarted] = client.sent.slice(-2);
    expect(expired.content).toMatch(/sess[aã]o anterior foi encerrada/i);
    expect(restarted.content).toMatch(/como podemos te ajudar hoje/i);
    expect(restarted.content).not.toMatch(/escolha uma categoria/i);
  });
});
