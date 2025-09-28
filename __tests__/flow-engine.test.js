'use strict';

const { FlowEngine } = require('../src/flow-runtime/engine');

/**
 * @typedef {import('../src/flow-runtime/engine')} FlowEngineModule
 */

/**
 * @typedef {FlowEngineModule['FlowEngine']} FlowEngineInstance
 */

/**
 * @typedef {{ start: string, nodes: Record<string, any> }} FlowDefinition
 */

/**
 * @typedef {{ flow: FlowDefinition, current: string }} FlowState
 */

/**
 * @typedef {{
 *   get(chatId: string): Promise<FlowState | null>,
 *   set(chatId: string, value: FlowState): Promise<void>,
 *   clear(chatId: string): Promise<void>,
 *   has(chatId: string): Promise<boolean>
 * }} FlowStateStore
 */

/**
 * Armazena estados em memória para testes.
 *
 * @implements {FlowStateStore}
 */
class TestStore {
  constructor() {
    /** @type {Map<string, FlowState>} */
    this.state = new Map();
    /** @type {number} */
    this.clearCalls = 0;
  }

  /**
   * @param {string} chatId
   * @returns {Promise<FlowState | null>}
   */
  async get(chatId) {
    return this.state.get(chatId) ?? null;
  }

  /**
   * @param {string} chatId
   * @param {FlowState} value
   * @returns {Promise<void>}
   */
  async set(chatId, value) {
    this.state.set(chatId, value);
  }

  /**
   * @param {string} chatId
   * @returns {Promise<void>}
   */
  async clear(chatId) {
    this.clearCalls += 1;
    this.state.delete(chatId);
  }

  /**
   * @param {string} chatId
   * @returns {Promise<boolean>}
   */
  async has(chatId) {
    return this.state.has(chatId);
  }
}

describe('FlowEngine - missing node recovery', () => {
  /** @type {TestStore} */
  let store;
  /** @type {FlowEngineInstance} */
  let engine;
  /** @type {FlowDefinition} */
  let flow;

  beforeEach(() => {
    store = new TestStore();
    engine = new FlowEngine(store);
    flow = {
      start: 'start',
      nodes: {
        start: {
          prompt: 'Olá',
          options: [
            {
              text: 'Ir',
              next: 'missing-node',
            },
          ],
        },
      },
    };
  });

  it('limpa o estado e retorna erro quando o nó atual está ausente', async () => {
    const chatId = 'chat-123';
    await store.set(chatId, { flow, current: 'missing-node' });

    const result = await engine.advance(chatId, 'qualquer coisa');

    expect(result).toEqual({ ok: false, error: 'no_node', nodeId: 'missing-node' });
    expect(await store.has(chatId)).toBe(false);
    expect(store.clearCalls).toBe(1);
  });
});
