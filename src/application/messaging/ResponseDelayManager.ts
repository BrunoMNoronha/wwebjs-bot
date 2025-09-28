export interface ResponseDelayManagerOptions {
  readonly baseDelayMs: number;
  readonly factor: number;
  readonly now?: () => number;
}

export class ResponseDelayManager {
  private readonly delays = new Map<string, number>();

  constructor(private readonly options: ResponseDelayManagerOptions) {
    if (options.baseDelayMs <= 0) {
      throw new Error('baseDelayMs deve ser maior que zero');
    }
    if (options.factor <= 1) {
      throw new Error('factor deve ser maior que 1 para progressão cumulativa');
    }
  }

  nextDelay(chatId: string): number {
    const current = this.delays.get(chatId) ?? this.options.baseDelayMs;
    const next = current * this.options.factor;
    this.delays.set(chatId, next);
    return current;
  }

  reset(chatId: string): void {
    this.delays.delete(chatId);
  }

  clear(): void {
    this.delays.clear();
  }
}
