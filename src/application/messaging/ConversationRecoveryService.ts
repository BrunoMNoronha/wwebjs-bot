export type RecoveryPhase = 'initial' | 'fallback';

export interface PendingSuggestionState {
  readonly optionId: string;
  readonly optionText: string;
  readonly confidence: number;
}

export interface ConversationState {
  readonly attempts: number;
  readonly phase: RecoveryPhase;
  readonly pendingSuggestion?: PendingSuggestionState;
  readonly lockedUntil?: number;
  readonly updatedAt: number;
}

export interface ConversationStateRepository {
  get(chatId: string): Promise<ConversationState | undefined>;
  set(chatId: string, state: ConversationState): Promise<void>;
  delete(chatId: string): Promise<void>;
}

export class InMemoryConversationStateRepository implements ConversationStateRepository {
  private readonly store = new Map<string, ConversationState>();

  async get(chatId: string): Promise<ConversationState | undefined> {
    return this.store.get(chatId);
  }

  async set(chatId: string, state: ConversationState): Promise<void> {
    this.store.set(chatId, state);
  }

  async delete(chatId: string): Promise<void> {
    this.store.delete(chatId);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

export interface ConversationRecoveryServiceOptions {
  readonly repository?: ConversationStateRepository;
  readonly now?: () => number;
}

export interface LockStatus {
  readonly locked: boolean;
  readonly remainingMs: number;
  readonly lockedUntil?: number;
}

export interface AttemptStatus {
  readonly attempts: number;
  readonly phase: RecoveryPhase;
}

export class ConversationRecoveryService {
  private readonly repository: ConversationStateRepository;
  private readonly now: () => number;

  constructor(options: ConversationRecoveryServiceOptions = {}) {
    this.repository = options.repository ?? new InMemoryConversationStateRepository();
    this.now = options.now ?? (() => Date.now());
  }

  private async save(chatId: string, state: ConversationState): Promise<void> {
    await this.repository.set(chatId, { ...state, updatedAt: this.now() });
  }

  private async getState(chatId: string): Promise<ConversationState | undefined> {
    return this.repository.get(chatId);
  }

  async reset(chatId: string): Promise<void> {
    await this.repository.delete(chatId);
  }

  async recordValidSelection(chatId: string): Promise<void> {
    await this.save(chatId, {
      attempts: 0,
      phase: 'initial',
      pendingSuggestion: undefined,
      lockedUntil: undefined,
      updatedAt: this.now(),
    });
  }

  async recordInvalidAttempt(chatId: string): Promise<AttemptStatus> {
    const current = (await this.getState(chatId)) ?? {
      attempts: 0,
      phase: 'initial' as RecoveryPhase,
      updatedAt: this.now(),
    };
    const attempts = current.attempts + 1;
    const phase: RecoveryPhase = attempts >= 2 ? 'fallback' : 'initial';
    await this.save(chatId, { ...current, attempts, phase, pendingSuggestion: undefined });
    return { attempts, phase };
  }

  async setPendingSuggestion(chatId: string, suggestion: PendingSuggestionState): Promise<void> {
    const current = (await this.getState(chatId)) ?? {
      attempts: 0,
      phase: 'initial' as RecoveryPhase,
      updatedAt: this.now(),
    };
    await this.save(chatId, { ...current, pendingSuggestion: suggestion });
  }

  async consumePendingSuggestion(chatId: string): Promise<PendingSuggestionState | undefined> {
    const current = await this.getState(chatId);
    if (!current?.pendingSuggestion) {
      return undefined;
    }
    await this.save(chatId, { ...current, pendingSuggestion: undefined });
    return current.pendingSuggestion;
  }

  async peekPendingSuggestion(chatId: string): Promise<PendingSuggestionState | undefined> {
    const current = await this.getState(chatId);
    return current?.pendingSuggestion;
  }

  async lock(chatId: string, lockedUntil: number): Promise<void> {
    const current = (await this.getState(chatId)) ?? {
      attempts: 0,
      phase: 'initial' as RecoveryPhase,
      updatedAt: this.now(),
    };
    await this.save(chatId, { ...current, lockedUntil });
  }

  async unlock(chatId: string): Promise<void> {
    const current = await this.getState(chatId);
    if (!current) {
      return;
    }
    await this.save(chatId, { ...current, lockedUntil: undefined });
  }

  async getLockStatus(chatId: string): Promise<LockStatus> {
    const current = await this.getState(chatId);
    if (!current?.lockedUntil) {
      return { locked: false, remainingMs: 0 };
    }
    const remaining = current.lockedUntil - this.now();
    if (remaining <= 0) {
      await this.unlock(chatId);
      return { locked: false, remainingMs: 0 };
    }
    return { locked: true, remainingMs: remaining, lockedUntil: current.lockedUntil };
  }

  async getAttempts(chatId: string): Promise<AttemptStatus> {
    const current = (await this.getState(chatId)) ?? {
      attempts: 0,
      phase: 'initial' as RecoveryPhase,
      updatedAt: this.now(),
    };
    return { attempts: current.attempts, phase: current.phase };
  }
}
