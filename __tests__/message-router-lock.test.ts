import type { Message } from 'whatsapp-web.js';
import { MessageRouter, type MessageRouterDeps } from '../src/application/messaging/MessageRouter';
import { ConversationRecoveryService } from '../src/application/messaging/ConversationRecoveryService';
import type { FlowSessionService } from '../src/application/flows/FlowSessionService';
import type { FlowEngine } from '../src/flow-runtime/engine';

describe('MessageRouter lock handling', () => {
  const chatId = '5511999999999@c.us';
  let conversationRecovery: ConversationRecoveryService;
  let messageRouter: MessageRouter;
  let commandRegistry: { run: jest.Mock<Promise<boolean>, [string, Message, { isOwner: boolean; fromSelf: boolean }]> };
  let flowSessionService: FlowSessionService;
  let flowEngine: FlowEngine;
  let sendSafe: jest.Mock<Promise<unknown>, [string, import('whatsapp-web.js').MessageContent]>;
  let resetDelay: jest.Mock<void, [string]>;
  let advanceOrRestart: jest.Mock<Promise<boolean>, [unknown]>;
  let ensureInitialMenu: jest.Mock<Promise<boolean>, [unknown]>;

  beforeEach(() => {
    conversationRecovery = new ConversationRecoveryService();
    commandRegistry = {
      run: jest
        .fn<Promise<boolean>, [string, Message, { isOwner: boolean; fromSelf: boolean }]>()
        .mockResolvedValue(false),
    };
    advanceOrRestart = jest.fn<Promise<boolean>, [unknown]>().mockResolvedValue(false);
    ensureInitialMenu = jest.fn<Promise<boolean>, [unknown]>().mockResolvedValue(false);
    flowSessionService = {
      advanceOrRestart: advanceOrRestart as unknown as FlowSessionService['advanceOrRestart'],
      ensureInitialMenu: ensureInitialMenu as unknown as FlowSessionService['ensureInitialMenu'],
      sendPrompt: jest.fn<Promise<void>, [string, unknown, unknown, unknown]>().mockResolvedValue(undefined),
      clearPrompt: jest.fn<void, [string]>(),
      rememberPrompt: jest.fn(),
      getFlowDefinition: jest.fn(),
    } as unknown as FlowSessionService;
    flowEngine = {
      isActive: jest.fn<Promise<boolean>, [string]>().mockResolvedValue(false),
      advance: jest.fn<Promise<unknown>, [string, string]>().mockResolvedValue(undefined),
      start: jest.fn<Promise<unknown>, [string, unknown]>().mockResolvedValue(undefined),
      cancel: jest.fn<Promise<unknown>, [string]>().mockResolvedValue(undefined),
    } as unknown as FlowEngine;
    sendSafe = jest.fn<Promise<unknown>, [string, import('whatsapp-web.js').MessageContent]>().mockResolvedValue(
      undefined,
    );
    resetDelay = jest.fn<void, [string]>();

    const deps: MessageRouterDeps = {
      commandRegistry,
      flowEngine,
      flowSessionService,
      sendSafe,
      resetDelay,
      flowUnavailableText: 'Fluxo indisponível no momento.',
      expiredFlowText: 'Sua sessão anterior foi encerrada.',
      invalidOptionText: 'Opção inválida.',
      genericFlowErrorText: 'Ocorreu um erro.',
      conversationRecovery,
    };
    messageRouter = new MessageRouter(deps);
  });

  test('ignores routed messages when conversation is locked', async () => {
    await conversationRecovery.lock(chatId, Date.now() + 15 * 60 * 1000);

    const message = { body: 'oi', from: chatId } as unknown as Message;
    await messageRouter.route({
      message,
      normalizedBody: 'oi',
      rawBody: 'oi',
      chatId,
      fromSelf: false,
      isOwner: false,
    });

    expect(commandRegistry.run).not.toHaveBeenCalled();
    expect(advanceOrRestart).not.toHaveBeenCalled();
    expect(ensureInitialMenu).not.toHaveBeenCalled();
    expect(sendSafe).not.toHaveBeenCalled();
    expect(resetDelay).not.toHaveBeenCalled();
  });
});
