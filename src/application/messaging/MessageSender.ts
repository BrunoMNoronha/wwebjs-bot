import type { Client, MessageContent } from 'whatsapp-web.js';
import { RateController } from '../../flow-runtime/rateController';
import { ResponseDelayManager } from './ResponseDelayManager';

export interface MessageSender {
  send(chatId: string, content: MessageContent): Promise<unknown>;
}

export class ClientMessageSender implements MessageSender {
  constructor(private readonly client: Client) {}

  async send(chatId: string, content: MessageContent): Promise<unknown> {
    return this.client.sendMessage(chatId, content);
  }
}

export abstract class MessageSenderDecorator implements MessageSender {
  protected constructor(protected readonly inner: MessageSender) {}

  abstract send(chatId: string, content: MessageContent): Promise<unknown>;
}

export class RateLimitedMessageSender extends MessageSenderDecorator {
  constructor(inner: MessageSender, private readonly rateController: RateController) {
    super(inner);
  }

  async send(chatId: string, content: MessageContent): Promise<unknown> {
    return this.rateController.withSend(chatId, () => this.inner.send(chatId, content));
  }
}

export class DelayedMessageSender extends MessageSenderDecorator {
  constructor(inner: MessageSender, private readonly delayManager: ResponseDelayManager) {
    super(inner);
  }

  async send(chatId: string, content: MessageContent): Promise<unknown> {
    const delay = this.delayManager.nextDelay(chatId);
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delay);
      });
    }
    return this.inner.send(chatId, content);
  }
}
