const fs = require('fs/promises');
const path = require('path');
const { TEXT } = require('./src/config/messages');
const { flow: CatalogFlow } = require('./src/flows/catalog');
const { flow: MenuFlow } = require('./src/flows/menu');
const { createApp } = require('./src/app/appFactory');

// Permissões de administrador
const OWNER_ID = process.env.OWNER_ID || '';
const ALLOW_SELF_ADMIN = process.env.ALLOW_SELF_ADMIN === '1';
function isOwnerMessage(msg) {
    if (!msg || !OWNER_ID) return false;
    return msg.from === OWNER_ID || msg.author === OWNER_ID;
}

// Diretório de sessão alinhado com LocalAuth (usado também no cleanup)
const AUTH_DIR = path.resolve(process.cwd(), '.wwebjs_auth');

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function removeAuthDirWithRetry(dir = AUTH_DIR, { retries = 10, baseDelay = 200 } = {}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await fs.rm(dir, { recursive: true, force: true });
            return true;
        } catch (err) {
            const code = err && (err.code || '');
            const retriable = ['EBUSY', 'EPERM', 'ENOENT'].includes(code);
            if (!retriable || attempt === retries) {
                console.error(`[auth-dir] falha ao remover (${code}) após ${attempt} tentativas:`, err.message);
                return false;
            }
            const delay = Math.min(2000, Math.floor(baseDelay * Math.pow(1.7, attempt - 1)));
            await sleep(delay);
        }
    }
    return false;
}

async function safeReauth(cli) {
    try {
        await cli.destroy();
    } catch (e) {
        console.warn('[reauth] erro ao destruir cliente:', e?.message || e);
    }
    const removed = await removeAuthDirWithRetry(AUTH_DIR);
    if (!removed) {
        console.warn('[reauth] não foi possível remover a pasta de sessão; tentando reinit mesmo assim.');
    }
    try {
        await cli.initialize();
        console.log('✅ Reinicializado. Aguarde QR Code se necessário.');
    } catch (e) {
        console.error('[reauth] falha ao inicializar cliente:', e?.message || e);
    }
}
// Cria app via factory com handlers que capturam estado por instância
const app = createApp({
    buildHandlers: ({ client, rate, flowEngine }) => {
        // Estado por app
        let reconnectAttempts = 0;
        const recentFlowContext = new Map(); // chatId -> { at, flow }
        const FLOW_PROMPT_WINDOW_MS = Number(process.env.FLOW_PROMPT_WINDOW_MS || 2 * 60 * 1000);

        const sendSafe = async (chatId, content) => rate.withSend(chatId, () => client.sendMessage(chatId, content));

        const rememberFlowPrompt = (chatId, flowKey) => {
            const prev = recentFlowContext.get(chatId);
            const key = flowKey ?? prev?.flow;
            if (!key) return;
            recentFlowContext.set(chatId, { at: Date.now(), flow: key });
        };

        const clearFlowPrompt = (chatId) => {
            recentFlowContext.delete(chatId);
        };

        const formatFlowPrompt = (node) => {
            if (!node) return '';
            const header = node.prompt || '';
            const options = Array.isArray(node.options) && node.options.length > 0
                ? node.options.map((o, i) => `${i + 1}. ${o.text}`).join('\n')
                : '';
            return options ? `${header}\n${options}` : header;
        };

        const sendFlowPrompt = async (chatId, node, flowKey) => {
            const text = formatFlowPrompt(node);
            await sendSafe(chatId, text);
            rememberFlowPrompt(chatId, flowKey);
        };

        const resolveFlowForRestart = (flowKey) => {
            if (flowKey === 'menu') {
                if (process.env.MENU_FLOW === '1') {
                    return { def: MenuFlow, key: 'menu' };
                }
                return { def: CatalogFlow, key: 'catalog' };
            }
            if (flowKey === 'catalog') {
                return { def: CatalogFlow, key: 'catalog' };
            }
            return process.env.MENU_FLOW === '1'
                ? { def: MenuFlow, key: 'menu' }
                : { def: CatalogFlow, key: 'catalog' };
        };

            async function gracefulShutdown({ exit = true } = {}) {
                try { rate.stop(); } catch {}
                try { await client.destroy(); } catch (e) { console.warn('[shutdown] destroy:', e?.message || e); }
                if (exit && process.env.NODE_ENV !== 'test') process.exit(0);
            }

            async function gracefulRestart() {
                try { rate.stop(); } catch {}
                try { await client.destroy(); } catch {}
                rate.start();
                try { await client.initialize(); } catch (e) { console.error('[restart] initialize:', e?.message || e); }
            }

                const handleIncoming = async (message) => {
                    if (!message) return;
            const raw = (typeof message.body === 'string') ? message.body : '';
            console.log(raw);
                    const body = raw.toLowerCase().trim();
                    const fromJid = message.from || '';
                    const toJid = message.to || '';

                    // Ignorar mensagens de grupos e atualizações/status
                    if (fromJid.endsWith('@g.us') || toJid.endsWith('@g.us')) return; // grupos
                    if (fromJid === 'status@broadcast' || toJid === 'status@broadcast') return; // status updates
                    if (message.isStatus || message.isBroadcast) return; // defensivo
                    const fromSelf = !!message.fromMe;
                    const isOwner = isOwnerMessage(message);

                    // Permitir apenas comandos admin quando a mensagem for sua (fromMe)
                    if (fromSelf && !(ALLOW_SELF_ADMIN && isOwner)) return;

                    // Comandos administrativos
                    if (isOwner && body === '!shutdown') {
                        if (!fromSelf) await sendSafe(message.from, 'Encerrando o bot com segurança…');
                        await gracefulShutdown({ exit: process.env.NODE_ENV !== 'test' });
                        return;
                    }
                    if (isOwner && body === '!restart') {
                        if (!fromSelf) await sendSafe(message.from, 'Reiniciando o bot…');
                        await gracefulRestart();
                        return;
                    }

                    // Ignora mensagens próprias que não são admin
                    if (fromSelf) return;

            if (body === '!menu' || body === '!lista') {
                if (process.env.MENU_FLOW === '1') {
                    const start = await flowEngine.start(message.from, MenuFlow);
                    if (!start.ok) {
                        clearFlowPrompt(message.from);
                        await sendSafe(message.from, 'Fluxo indisponível no momento.');
                    } else {
                        await sendFlowPrompt(message.from, start.node, 'menu');
                    }
                } else {
                    clearFlowPrompt(message.from);
                    await sendSafe(message.from, TEXT.welcome);
                }
            } else if (body === '!fluxo') {
                const start = await flowEngine.start(message.from, CatalogFlow);
                if (!start.ok) {
                    clearFlowPrompt(message.from);
                    await sendSafe(message.from, 'Fluxo indisponível no momento.');
                } else {
                    await sendFlowPrompt(message.from, start.node, 'catalog');
                }
            }

            if (body && !body.startsWith('!')) {
                const active = await flowEngine.isActive(message.from);
                if (!active) {
                    const looksLikeFlowInput = /^\d+$/.test(body);
                    const entry = recentFlowContext.get(message.from);
                    const lastPromptAt = entry?.at || 0;
                    const promptIsRecent = !!entry?.flow && lastPromptAt && (Date.now() - lastPromptAt <= FLOW_PROMPT_WINDOW_MS);
                    if (looksLikeFlowInput && promptIsRecent) {
                        await sendSafe(message.from, TEXT.flow?.expired || 'Sua sessão anterior foi encerrada.');
                        const { def, key } = resolveFlowForRestart(entry?.flow);
                        const restart = await flowEngine.start(message.from, def);
                        if (restart.ok && restart.node) {
                            await sendFlowPrompt(message.from, restart.node, key);
                        } else {
                            clearFlowPrompt(message.from);
                            await sendSafe(message.from, 'Fluxo indisponível no momento.');
                        }
                    }
                    return;
                }
                const res = await flowEngine.advance(message.from, body);
                if (!res.ok && res.error === 'input_invalido') {
                    await sendSafe(message.from, 'Não entendi. Por favor, escolha uma das opções listadas.');
                    return;
                }
                if (!res.ok) {
                    clearFlowPrompt(message.from);
                    try { await flowEngine.cancel(message.from); } catch {}
                    await sendSafe(message.from, 'Ocorreu um erro no fluxo. Encerrando.');
                    return;
                }
                if (res.terminal) {
                    if (res.prompt) await sendSafe(message.from, res.prompt);
                    return;
                }
                const text = res.prompt + '\n' + (res.options || []).join('\n');
                await sendSafe(message.from, text);
                rememberFlowPrompt(message.from);
            }
        };

        const onDisconnected = async (reason) => {
            console.log('⚠️ Cliente foi desconectado', reason);
            if (String(reason).toUpperCase() === 'LOGOUT') { await safeReauth(client); return; }
            const backoffMs = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts++));
            setTimeout(() => { client.initialize().catch(e => console.error('[reconnect] initialize falhou:', e?.message || e)); }, backoffMs);
        };

        return { handleIncoming, onDisconnected };
    }
});

// Inicializa apenas quando executado como script principal (não em testes)
if (require.main === module) {
    app.start().catch(e => {
        console.error('Falha ao iniciar:', e?.message || e);
        process.exitCode = 1;
    });
}

// Exporte app e atalhos para compatibilidade com testes existentes
module.exports = { app, client: app.client, rate: app.rate };

