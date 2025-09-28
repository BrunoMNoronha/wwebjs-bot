import type { Message } from 'whatsapp-web.js';
import type { FlowEngine } from '../../flow-runtime/engine';
import type { FlowSessionService } from '../services/FlowSessionService';
import type { FlowPromptNode, FlowKey } from '../services/FlowSessionService';

export interface CommandRegistry {
  run(command: string, message: Message, context: { isOwner: boolean; fromSelf: boolean }): Promise<boolean>;
}

export interface MessageRouterDeps {
  readonly commandRegistry: CommandRegistry;
  readonly flowEngine: FlowEngine;
  readonly flowSessionService: FlowSessionService;
  readonly sendSafe: (chatId: string, content: string) => Promise<unknown>;
  readonly flowUnavailableText: string;
  readonly expiredFlowText: string;
  readonly invalidOptionText: string;
  readonly genericFlowErrorText: string;
}

export interface RoutedMessage {
  readonly message: Message;
  readonly normalizedBody: string;
  readonly rawBody: string;
  readonly chatId: string;
  readonly fromSelf: boolean;
  readonly isOwner: boolean;
}

export type MessageProcessingContext = MessageRouterDeps & RoutedMessage;

export interface MessageHandler {
  setNext(handler: MessageHandler | null): MessageHandler;
  handle(context: MessageProcessingContext): Promise<boolean>;
}

abstract class BaseMessageHandler implements MessageHandler {
  private next: MessageHandler | null = null;

  setNext(handler: MessageHandler | null): MessageHandler {
    this.next = handler;
    return handler ?? this;
  }

  protected async handleNext(context: MessageProcessingContext): Promise<boolean> {
    if (!this.next) {
      return false;
    }
    return this.next.handle(context);
  }

  abstract handle(context: MessageProcessingContext): Promise<boolean>;
}

class CommandMessageHandler extends BaseMessageHandler {
  async handle(context: MessageProcessingContext): Promise<boolean> {
    if (!context.normalizedBody.startsWith('!')) {
      return this.handleNext(context);
    }
    const handled = await context.commandRegistry.run(context.normalizedBody, context.message, {
      isOwner: context.isOwner,
      fromSelf: context.fromSelf,
    });
    if (handled) {
      return true;
    }
    return this.handleNext(context);
  }
}

class FlowMessageHandler extends BaseMessageHandler {
  private readonly digitOnly = /^\d+$/;

  async handle(context: MessageProcessingContext): Promise<boolean> {
    if (!context.normalizedBody || context.normalizedBody.startsWith('!')) {
      return this.handleNext(context);
    }
    if (!context.chatId) {
      return this.handleNext(context);
    }

    const { flowEngine, flowSessionService, sendSafe } = context;
    const chatId = context.chatId;

    const active = await flowEngine.isActive(chatId);
    if (!active) {
      if (!this.digitOnly.test(context.normalizedBody)) {
        return this.handleNext(context);
      }
      const previousFlowKey = flowSessionService.recentFlowKey(chatId);
      if (!previousFlowKey) {
        return this.handleNext(context);
      }
      await sendSafe(chatId, context.expiredFlowText);
      const { definition, key } = flowSessionService.resolveFlowForRestart(previousFlowKey);
      const restart = await flowEngine.start(chatId, definition);
      if (!restart.ok || !restart.node) {
        flowSessionService.clearPrompt(chatId);
        await sendSafe(chatId, context.flowUnavailableText);
        return true;
      }
      await flowSessionService.sendPrompt(chatId, restart.node as FlowPromptNode, key, sendSafe);
      return true;
    }

    const result = await flowEngine.advance(chatId, context.normalizedBody);
    if (!result.ok) {
      if (result.error === 'input_invalido') {
        await sendSafe(chatId, context.invalidOptionText);
        return true;
      }
      flowSessionService.clearPrompt(chatId);
      try {
        await flowEngine.cancel(chatId);
      } catch (error) {
        // Ignored: cancel já faz tratamento interno e uma falha aqui não deve
        // bloquear a resposta de erro amigável ao usuário.
      }
      await sendSafe(chatId, context.genericFlowErrorText);
      return true;
    }

    if (result.terminal) {
      if (result.prompt) {
        await sendSafe(chatId, result.prompt);
      }
      flowSessionService.rememberPrompt(chatId);
      return true;
    }

    const options = result.options ?? [];
    const payload = [result.prompt, ...options.filter(Boolean)].filter(Boolean).join('\n');
    if (payload) {
      await sendSafe(chatId, payload);
    }
    flowSessionService.rememberPrompt(chatId);
    return true;
  }
}

class DiscardMessageHandler extends BaseMessageHandler {
  async handle(context: MessageProcessingContext): Promise<boolean> {
    return false;
  }
}

export class MessageRouter {
  private readonly head: MessageHandler;

  constructor(private readonly deps: MessageRouterDeps) {
    const command = new CommandMessageHandler();
    const flow = new FlowMessageHandler();
    const discard = new DiscardMessageHandler();
    command.setNext(flow).setNext(discard);
    discard.setNext(null);
    this.head = command;
  }

  async route(message: RoutedMessage): Promise<void> {
    await this.head.handle({ ...this.deps, ...message });
  }
}
