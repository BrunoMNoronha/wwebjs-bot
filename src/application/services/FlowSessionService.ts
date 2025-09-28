import { createFlowPromptTracker } from '../../app/flowPromptTracker';

export interface FlowOption {
  text: string;
  next?: string;
  aliases?: string[];
  correct?: boolean;
}

export interface FlowNode {
  id?: string;
  prompt?: string;
  terminal?: boolean;
  options?: FlowOption[];
}

export interface FlowDefinition {
  start: string;
  nodes: Record<string, FlowNode>;
}

export type FlowKey = 'menu' | 'catalog';

export interface FlowSessionServiceOptions {
  readonly menuFlow: FlowDefinition;
  readonly catalogFlow: FlowDefinition;
  readonly menuFlowEnabled: boolean;
  readonly promptWindowMs: number;
}

export type FlowPromptNode = FlowNode;

export class FlowSessionService {
  private readonly tracker = createFlowPromptTracker({ windowMs: this.options.promptWindowMs });

  constructor(private readonly options: FlowSessionServiceOptions) {}

  rememberPrompt(chatId: string, flowKey?: FlowKey): void {
    this.tracker.remember(chatId, flowKey);
  }

  clearPrompt(chatId: string): void {
    this.tracker.clear(chatId);
  }

  recentFlowKey(chatId: string): FlowKey | undefined {
    const key = this.tracker.recentFlowKey(chatId);
    if (key === 'menu' || key === 'catalog') {
      return key;
    }
    return undefined;
  }

  formatPrompt(node: FlowPromptNode | undefined): string {
    if (!node) {
      return '';
    }
    const header = typeof node.prompt === 'string' ? node.prompt : '';
    const options = Array.isArray(node.options) && node.options.length > 0
      ? node.options.map((option, index) => `${index + 1}. ${option.text}`).join('\n')
      : '';
    if (header && options) {
      return `${header}\n${options}`;
    }
    if (options) {
      return options;
    }
    return header;
  }

  async sendPrompt(
    chatId: string,
    node: FlowPromptNode | undefined,
    flowKey: FlowKey,
    sendSafe: (chatId: string, content: string) => Promise<unknown>,
  ): Promise<void> {
    const text = this.formatPrompt(node);
    if (text) {
      await sendSafe(chatId, text);
    }
    this.rememberPrompt(chatId, flowKey);
  }

  resolveFlowForRestart(flowKey: FlowKey | undefined): { definition: FlowDefinition; key: FlowKey } {
    if (flowKey === 'menu') {
      if (this.options.menuFlowEnabled) {
        return { definition: this.options.menuFlow, key: 'menu' };
      }
      return { definition: this.options.catalogFlow, key: 'catalog' };
    }
    if (flowKey === 'catalog') {
      return { definition: this.options.catalogFlow, key: 'catalog' };
    }
    return this.options.menuFlowEnabled
      ? { definition: this.options.menuFlow, key: 'menu' }
      : { definition: this.options.catalogFlow, key: 'catalog' };
  }
}
