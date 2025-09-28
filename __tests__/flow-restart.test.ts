import {
  FlowSessionService,
  type FlowDefinition,
  type FlowModuleRegistry,
  type FlowRuntimeEngine,
  type FlowNode,
} from '../src/application/flows/FlowSessionService';

describe('FlowSessionService', () => {
  const chatId = '5511987654321@c.us';
  const menuFlow: FlowDefinition = {
    start: 'menu:root',
    nodes: {
      'menu:root': {
        prompt: 'Como podemos te ajudar hoje?',
        options: [
          { text: 'Ver catálogo', next: 'catalog:start' },
        ],
      },
      'catalog:start': {
        prompt: 'Escolha uma categoria',
        terminal: true,
      },
    },
  };
  const catalogFlow: FlowDefinition = {
    start: 'catalog:root',
    nodes: {
      'catalog:root': {
        prompt: 'Escolha uma categoria',
        options: [
          { text: 'Produtos', next: 'catalog:products' },
        ],
      },
      'catalog:products': {
        prompt: 'Lista de produtos',
        terminal: true,
      },
    },
  };

  const flowModules: FlowModuleRegistry = {
    menu: { flow: menuFlow },
    catalog: { flow: catalogFlow },
  };

  class FlowEngineMock implements FlowRuntimeEngine {
    public readonly startMock = jest.fn<Promise<{ ok: boolean; node?: FlowNode }>, [string, FlowDefinition]>();

    public readonly advanceMock = jest.fn<
      Promise<
        | { ok: false; error: string; expected?: string[]; nodeId?: string }
        | { ok: true; terminal: boolean; prompt?: string; options?: string[] }
      >,
      [string, string]
    >();

    public readonly cancelMock = jest.fn<Promise<void>, [string]>();

    public readonly isActiveMock = jest.fn<Promise<boolean>, [string]>();

    async start(chatIdInput: string, flow: FlowDefinition): Promise<{ ok: boolean; node?: FlowNode }> {
      return this.startMock(chatIdInput, flow);
    }

    async advance(chatIdInput: string, inputRaw: string): Promise<
      | { ok: false; error: string; expected?: string[]; nodeId?: string }
      | { ok: true; terminal: boolean; prompt?: string; options?: string[] }
    > {
      return this.advanceMock(chatIdInput, inputRaw);
    }

    async cancel(chatIdInput: string): Promise<void> {
      await this.cancelMock(chatIdInput);
    }

    async isActive(chatIdInput: string): Promise<boolean> {
      return this.isActiveMock(chatIdInput);
    }
  }

  const createService = (menuFlowEnabled: boolean): FlowSessionService => {
    return new FlowSessionService({
      flowModules,
      menuFlowEnabled,
      promptWindowMs: 10_000,
    });
  };

  const texts = {
    expiredFlowText: 'Sua sessão anterior foi encerrada.',
    flowUnavailableText: 'Fluxo indisponível no momento.',
    invalidOptionText: 'Opção inválida.',
    genericFlowErrorText: 'Erro no fluxo.',
  } as const;

  test('resumeIfPossible reinicia o menu quando há prompt recente', async () => {
    const service = createService(true);
    const engine = new FlowEngineMock();
    const sendSafe = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);

    service.rememberPrompt(chatId, 'menu');

    engine.startMock.mockResolvedValue({ ok: true, node: menuFlow.nodes['menu:root'] });

    const handled = await service.resumeIfPossible({
      chatId,
      input: '1',
      flowEngine: engine,
      sendSafe,
      texts,
    });

    expect(handled).toBe(true);
    expect(engine.startMock).toHaveBeenCalledWith(chatId, menuFlow);
    expect(sendSafe).toHaveBeenNthCalledWith(1, chatId, texts.expiredFlowText);
    expect(sendSafe).toHaveBeenNthCalledWith(2, chatId, 'Como podemos te ajudar hoje?\n1. Ver catálogo');
  });

  test('resumeIfPossible redireciona para o catálogo quando menu está desabilitado', async () => {
    const service = createService(false);
    const engine = new FlowEngineMock();
    const sendSafe = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);

    service.rememberPrompt(chatId, 'menu');

    engine.startMock.mockResolvedValue({ ok: true, node: catalogFlow.nodes['catalog:root'] });

    const handled = await service.resumeIfPossible({
      chatId,
      input: '1',
      flowEngine: engine,
      sendSafe,
      texts,
    });

    expect(handled).toBe(true);
    expect(engine.startMock).toHaveBeenCalledWith(chatId, catalogFlow);
    expect(sendSafe).toHaveBeenNthCalledWith(2, chatId, 'Escolha uma categoria\n1. Produtos');
  });

  test('advanceOrRestart devolve erro amigável quando opção é inválida', async () => {
    const service = createService(true);
    const engine = new FlowEngineMock();
    const sendSafe = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);

    engine.isActiveMock.mockResolvedValue(true);
    engine.advanceMock.mockResolvedValue({ ok: false, error: 'input_invalido' });

    const handled = await service.advanceOrRestart({
      chatId,
      input: '99',
      flowEngine: engine,
      sendSafe,
      texts,
    });

    expect(handled).toBe(true);
    expect(sendSafe).toHaveBeenCalledWith(chatId, texts.invalidOptionText);
    expect(engine.cancelMock).not.toHaveBeenCalled();
  });

  test('advanceOrRestart reinicia fluxo expirado quando há input numérico', async () => {
    const service = createService(true);
    const engine = new FlowEngineMock();
    const sendSafe = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);

    service.rememberPrompt(chatId, 'menu');
    engine.isActiveMock.mockResolvedValue(false);
    engine.startMock.mockResolvedValue({ ok: true, node: menuFlow.nodes['menu:root'] });

    const handled = await service.advanceOrRestart({
      chatId,
      input: '1',
      flowEngine: engine,
      sendSafe,
      texts,
    });

    expect(handled).toBe(true);
    expect(engine.startMock).toHaveBeenCalledWith(chatId, menuFlow);
    expect(sendSafe).toHaveBeenNthCalledWith(2, chatId, 'Como podemos te ajudar hoje?\n1. Ver catálogo');
  });

  test('advanceOrRestart retorna false quando não há prompt recente nem fluxo ativo', async () => {
    const service = createService(true);
    const engine = new FlowEngineMock();
    const sendSafe = jest.fn<Promise<void>, [string, string]>().mockResolvedValue(undefined);

    engine.isActiveMock.mockResolvedValue(false);

    const handled = await service.advanceOrRestart({
      chatId,
      input: 'texto livre',
      flowEngine: engine,
      sendSafe,
      texts,
    });

    expect(handled).toBe(false);
    expect(engine.startMock).not.toHaveBeenCalled();
    expect(sendSafe).not.toHaveBeenCalled();
  });
});
