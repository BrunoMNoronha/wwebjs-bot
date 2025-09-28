import type { Message } from 'whatsapp-web.js';
import type { FlowEngine } from '../../flow-runtime/engine';
import type { FlowSessionService } from '../flows/FlowSessionService';
import type { FlowKey } from '../flows/FlowSessionService';

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
  async handle(context: MessageProcessingContext): Promise<boolean> {
    if (!context.normalizedBody || context.normalizedBody.startsWith('!')) {
      return this.handleNext(context);
    }
    if (!context.chatId) {
      return this.handleNext(context);
    }

    const handled = await context.flowSessionService.advanceOrRestart({
      chatId: context.chatId,
      input: context.normalizedBody,
      flowEngine: context.flowEngine,
      sendSafe: context.sendSafe,
      texts: {
        expiredFlowText: context.expiredFlowText,
        flowUnavailableText: context.flowUnavailableText,
        invalidOptionText: context.invalidOptionText,
        genericFlowErrorText: context.genericFlowErrorText,
      },
    });

    if (handled) {
      return true;
    }

    return this.handleNext(context);
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
