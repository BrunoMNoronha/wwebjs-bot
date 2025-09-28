import { List } from 'whatsapp-web.js';
import { FlowEngine } from '../src/flow-runtime/engine';
import { createStore } from '../src/flow-runtime/stateStore';
import {
  FlowSessionService,
  type FlowAdvanceContext,
  type FlowAdvanceTexts,
  type FlowDefinition,
  type FlowModuleRegistry,
} from '../src/application/flows/FlowSessionService';
import { ConversationRecoveryService } from '../src/application/messaging/ConversationRecoveryService';
import {
  TEXT,
  INITIAL_MENU_TEMPLATE,
  FALLBACK_MENU_TEMPLATE,
  LOCK_DURATION_MS,
  FUZZY_SUGGESTION_THRESHOLD,
  FUZZY_CONFIRMATION_THRESHOLD,
} from '../src/config/messages';
import { menuFlow } from '../src/flows/menu';

const catalogFlow: FlowDefinition = {
  start: 'catalog:start',
  nodes: {
    'catalog:start': {
      id: 'catalog:start',
      kind: 'text',
      prompt: 'Escolha uma categoria',
      promptContent: 'Escolha uma categoria',
      options: [
        { id: 'produtos', text: 'Produtos', aliases: ['1'], next: 'catalog:produtos' },
      ],
    },
    'catalog:produtos': {
      id: 'catalog:produtos',
      kind: 'text',
      prompt: 'Lista de produtos',
      promptContent: 'Lista de produtos',
      terminal: true,
    },
  },
};

const flowModules = {
  menu: { flow: menuFlow },
  catalog: { flow: catalogFlow },
} satisfies FlowModuleRegistry;

const texts: FlowAdvanceTexts = {
  expiredFlowText: 'Sua sessão anterior foi encerrada.',
  flowUnavailableText: 'Fluxo indisponível no momento.',
  invalidOptionText: 'Opção inválida.',
  genericFlowErrorText: 'Erro no fluxo.',
};

describe('FlowSessionService conversational behaviour', () => {
  const chatId = '5511987654321@c.us';
  let service: FlowSessionService;
  let engine: FlowEngine;
  let sendSafe: jest.Mock<Promise<void>, [string, unknown]>;
  let resetDelay: jest.Mock<void, [string]>;
  let conversationRecovery: ConversationRecoveryService;

  beforeEach(() => {
    conversationRecovery = new ConversationRecoveryService();
    service = new FlowSessionService({
      flowModules,
      menuFlowEnabled: true,
      promptWindowMs: 60_000,
      conversationRecovery,
      textConfig: TEXT,
      initialMenuTemplate: INITIAL_MENU_TEMPLATE,
      fallbackMenuTemplate: FALLBACK_MENU_TEMPLATE,
      lockDurationMs: LOCK_DURATION_MS,
      fuzzySuggestionThreshold: FUZZY_SUGGESTION_THRESHOLD,
      fuzzyConfirmationThreshold: FUZZY_CONFIRMATION_THRESHOLD,
    });
    engine = new FlowEngine(createStore());
    sendSafe = jest.fn<Promise<void>, [string, unknown]>().mockResolvedValue(undefined);
    resetDelay = jest.fn<void, [string]>();
  });

  const buildContext = (input: string): FlowAdvanceContext => ({
    chatId,
    input,
    flowEngine: engine,
    sendSafe,
    resetDelay,
    texts,
  });

  test('starts the welcome menu on first contact', async () => {
    const handled = await service.advanceOrRestart(buildContext('olá'));
    expect(handled).toBe(true);
    expect(sendSafe).toHaveBeenCalledTimes(2);
    expect(sendSafe.mock.calls[0][0]).toBe(chatId);
    expect(sendSafe.mock.calls[0][1]).toContain(TEXT.welcomeHeader);
    expect(sendSafe.mock.calls[1][1]).toBeInstanceOf(List);
    expect(resetDelay).toHaveBeenCalledWith(chatId);
  });

  test('controls invalid attempts and escalates to fallback menu', async () => {
    await service.advanceOrRestart(buildContext('primeiro contato'));
    sendSafe.mockClear();

    await service.advanceOrRestart(buildContext('mensagem livre'));
    expect(sendSafe).toHaveBeenCalledTimes(2);
    expect(String(sendSafe.mock.calls[0][1])).toContain(TEXT.friendlyRetry.split(' ')[0]);
    expect(sendSafe.mock.calls[1][1]).toBeInstanceOf(List);

    sendSafe.mockClear();
    await service.advanceOrRestart(buildContext('segunda mensagem sem opção'));
    expect(String(sendSafe.mock.calls[0][1])).toContain(TEXT.fallbackRetry.split(' ')[0]);
    expect(sendSafe.mock.calls[1][1]).toBeInstanceOf(List);

    sendSafe.mockClear();
    await service.advanceOrRestart(buildContext('terceira mensagem inválida'));
    expect(sendSafe).toHaveBeenCalledTimes(2);
    expect(String(sendSafe.mock.calls[0][1])).toContain(TEXT.fallbackClosure.split(' ')[0]);
    expect(String(sendSafe.mock.calls[1][1])).toContain(TEXT.lockedNotice.split(' ')[0]);
  });

  test('suggests closest option and advances after confirmation', async () => {
    await service.advanceOrRestart(buildContext('oi'));
    sendSafe.mockClear();

    await service.advanceOrRestart(buildContext('solicitar orcament'));
    const suggestionMessage = String(sendSafe.mock.calls[0][1]);
    expect(suggestionMessage).toContain('Encontrei uma opção parecida');

    sendSafe.mockClear();
    await service.advanceOrRestart(buildContext('sim'));
    expect(sendSafe).toHaveBeenCalled();
    const terminalMessage = String(sendSafe.mock.calls[0][1]);
    expect(terminalMessage).toContain('Envie uma foto do seu tênis');
  });

  test('locks conversation after choosing outras informações', async () => {
    await service.advanceOrRestart(buildContext('olá'));
    sendSafe.mockClear();

    await service.advanceOrRestart(buildContext('4'));
    expect(sendSafe).toHaveBeenCalledTimes(2);
    expect(String(sendSafe.mock.calls[0][1])).toContain('Claro!');
    expect(String(sendSafe.mock.calls[1][1])).toContain(TEXT.lockedNotice.split(' ')[0]);
    expect(resetDelay).toHaveBeenCalledTimes(1);

    const status = await conversationRecovery.getLockStatus(chatId);
    expect(status.locked).toBe(true);
    expect(status.lockedUntil).toBeGreaterThan(Date.now());

    sendSafe.mockClear();
    resetDelay.mockClear();
    await service.advanceOrRestart(buildContext('mensagem durante bloqueio'));
    expect(sendSafe).not.toHaveBeenCalled();
    expect(resetDelay).not.toHaveBeenCalled();
  });

  test('libera bloqueio após TTL utilizando fakeTimers', async () => {
    const baseNow: number = Date.now();
    jest.useFakeTimers({ now: baseNow, doNotFake: ['nextTick'] });
    try {
      const nowFn = (): number => Date.now();
      conversationRecovery = new ConversationRecoveryService({ now: nowFn });
      service = new FlowSessionService({
        flowModules,
        menuFlowEnabled: true,
        promptWindowMs: 60_000,
        conversationRecovery,
        textConfig: TEXT,
        initialMenuTemplate: INITIAL_MENU_TEMPLATE,
        fallbackMenuTemplate: FALLBACK_MENU_TEMPLATE,
        lockDurationMs: 5_000,
        fuzzySuggestionThreshold: FUZZY_SUGGESTION_THRESHOLD,
        fuzzyConfirmationThreshold: FUZZY_CONFIRMATION_THRESHOLD,
      });

      await service.advanceOrRestart(buildContext('olá'));
      sendSafe.mockClear();

      await service.advanceOrRestart(buildContext('4'));
      const statusAfterLock = await conversationRecovery.getLockStatus(chatId);
      expect(statusAfterLock.locked).toBe(true);

      jest.advanceTimersByTime(5_001);
      await conversationRecovery.getLockStatus(chatId);

      sendSafe.mockClear();
      resetDelay.mockClear();

      await service.advanceOrRestart(buildContext('olá de novo'));
      expect(sendSafe).toHaveBeenCalled();
      expect(resetDelay).toHaveBeenCalledWith(chatId);

      const finalStatus = await conversationRecovery.getLockStatus(chatId);
      expect(finalStatus.locked).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
