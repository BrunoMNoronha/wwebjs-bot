'use strict';

/**
 * @typedef {import('whatsapp-web.js').Message} WWebMessage
 */

/**
 * @typedef {Object} CommandContext
 * @property {boolean} isOwner
 * @property {boolean} fromSelf
 */

/**
 * @typedef {(message: WWebMessage, context: CommandContext) => Promise<boolean> | boolean} CommandHandler
 */

/**
 * @typedef {Object} FlowPromptNode
 * @property {string} [prompt]
 * @property {Array<{ text: string }>} [options]
 */

/**
 * @typedef {Object} CommandRegistryDeps
 * @property {(chatId: string, content: string) => Promise<unknown>} sendSafe
 * @property {(chatId: string, node: FlowPromptNode | undefined, flowKey: string) => Promise<void>} sendFlowPrompt
 * @property {(chatId: string) => void} clearFlowPrompt
 * @property {{ start: (chatId: string, flow: any) => Promise<{ ok: boolean, node?: FlowPromptNode }>; }} flowEngine
 * @property {any} menuFlow
 * @property {any} catalogFlow
 * @property {(options?: { exit?: boolean }) => Promise<void>} gracefulShutdown
 * @property {() => Promise<void>} gracefulRestart
 * @property {string} welcomeText
 * @property {string} flowUnavailableText
 * @property {string} shutdownNotice
 * @property {string} restartNotice
 * @property {boolean} shouldExitOnShutdown
 */

/**
 * Implementa o *Command Pattern* para mapear comandos de texto aos seus handlers.
 * A utilização de um `Map` garante busca O(1) por comando, evitando encadeamentos
 * longos de `if/else` conforme a base de comandos cresce.
 *
 * @param {CommandRegistryDeps} deps
 */
function createCommandRegistry(deps) {
  const {
    sendSafe,
    sendFlowPrompt,
    clearFlowPrompt,
    flowEngine,
    menuFlow,
    catalogFlow,
    gracefulShutdown,
    gracefulRestart,
    welcomeText,
    flowUnavailableText,
    shutdownNotice,
    restartNotice,
    shouldExitOnShutdown,
  } = deps;

  /** @type {Map<string, CommandHandler>} */
  const registry = new Map();

  /**
   * @param {string[]} aliases
   * @param {CommandHandler} handler
   */
  const register = (aliases, handler) => {
    aliases.forEach((alias) => registry.set(alias, handler));
  };

  register(['!shutdown'], async (message, context) => {
    if (!context.isOwner) return false;

    try {
      if (!context.fromSelf) {
        await sendSafe(message.from, shutdownNotice);
      }
    } catch (/** @type {unknown} */ error) {
      const parsedError = error instanceof Error ? error : new Error(String(error));
      console.warn('[commandRegistry] Falha ao enviar aviso de desligamento:', parsedError);
    } finally {
      await gracefulShutdown({ exit: shouldExitOnShutdown });
    }

    return true;
  });

  register(['!restart'], async (message, context) => {
    if (!context.isOwner) return false;

    try {
      if (!context.fromSelf) {
        await sendSafe(message.from, restartNotice);
      }
    } catch (/** @type {unknown} */ error) {
      const parsedError = error instanceof Error ? error : new Error(String(error));
      console.warn('[commandRegistry] Falha ao enviar aviso de reinício:', parsedError);
    } finally {
      await gracefulRestart();
    }

    return true;
  });

  const menuFlowEnabled = process.env.MENU_FLOW === '1';

  register(['!menu', '!lista'], async (message, context) => {
    if (context.fromSelf) return false;
    if (!menuFlowEnabled) {
      clearFlowPrompt(message.from);
      await sendSafe(message.from, welcomeText);
      return true;
    }
    const start = await flowEngine.start(message.from, menuFlow);
    if (!start.ok) {
      clearFlowPrompt(message.from);
      await sendSafe(message.from, flowUnavailableText);
      return true;
    }
    await sendFlowPrompt(message.from, start.node, 'menu');
    return true;
  });

  register(['!fluxo'], async (message, context) => {
    if (context.fromSelf) return false;
    const start = await flowEngine.start(message.from, catalogFlow);
    if (!start.ok) {
      clearFlowPrompt(message.from);
      await sendSafe(message.from, flowUnavailableText);
      return true;
    }
    await sendFlowPrompt(message.from, start.node, 'catalog');
    return true;
  });

  return {
    /**
     * Executa o handler associado ao comando, caso exista.
     *
     * @param {string} command
     * @param {WWebMessage} message
     * @param {CommandContext} context
     * @returns {Promise<boolean>}
     */
    async run(command, message, context) {
      const handler = registry.get(command);
      if (!handler) return false;
      return Boolean(await handler(message, context));
    },
  };
}

module.exports = { createCommandRegistry };
