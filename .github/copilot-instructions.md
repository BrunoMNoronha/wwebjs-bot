# AI agent guide for wwebjs-bot

This repo is a Node.js WhatsApp bot built on whatsapp-web.js with a small flow engine and pluggable state. Agents should follow these conventions to be productive and avoid breaking tests.

## Architecture overview
- Entry point: `main.js`
  - Creates a `Client` with `LocalAuth` in `.wwebjs_auth`.
  - Registers a single message handler `handleIncoming` on both `message` and `message_create`.
  - Wraps all outbound `sendMessage` through `RateController` via `sendSafe(chatId, content)`.
  - Flow management via `FlowEngine` (start/advance/cancel). State is persisted via a pluggable store (memory by default; Redis optional).
  - Safe reauth on Windows: on `disconnected` with reason `LOGOUT` it destroys the client, tries removing `.wwebjs_auth` (with retries to avoid EBUSY), then re-initializes.
- Flow engine: `src/flow-runtime/engine.js`
  - Contract for flows: `{ start: string, nodes: { [id]: { prompt: string, options?: Array<{ id, text, next, aliases? }>, terminal?: boolean } } }`.
  - `advance(chatId, input)` uses `buildOptionMatcher` to match numbers/text to options; clears state at terminal nodes.
- Validation utilities: `src/validation/{answers.js,flows.js}`
  - `answers.buildOptionMatcher` tolerates `aliases` missing.
  - `flows.validateOptionFlow` and `simulateFlow` check structure and detect terminals.
- Config and flows:
  - UI text and prompts: `src/config/messages.js`.
  - Example flows: `src/flows/catalog.js` and `src/flows/menu.js` (text-based menu).

## Runtime behavior and conventions
- Always ignore self messages: at top of handler `if (!message || message.fromMe) return;`.
- Normalize input with `body = (message.body||'').toLowerCase().trim()` and pass to engine for decisions.
- Use `sendSafe` for all outbound messages to respect per-chat cooldown and global throttle.
- Track last flow prompt per chat in `recentFlowPromptAt` to show an "expired session" hint and optionally restart a flow if a numeric reply comes after a recent prompt but no active state.
- Commands:
  - `!menu` and `!lista` start the Menu flow when `MENU_FLOW=1`; otherwise a legacy text welcome is sent (tests used to assume legacy behavior).
  - `!fluxo` starts the Catalog flow.

## Testing patterns
- Jest with manual mocks for `whatsapp-web.js` and `qrcode-terminal` in `__tests__/main.test.js` and `__mocks__/`.
- In tests, client is not initialized; events are simulated by `client.emit('message_create', msg)`.
- The `RateController` disables rate limiting when `NODE_ENV=test` but still export `rate` from `main.js` so tests can call `rate.stop()` in `afterAll` to ensure timers are cleaned if enabled.
- Prefer importing `{ client, rate }` from `main.js` in tests and calling:
  ```js
  afterAll(() => { rate?.stop?.(); });
  ```

## Developer workflows
- Install deps: `npm install`
- Run: `npm start` (first run shows a QR code to pair WhatsApp)
- Test: `npm test`
- Toggle menu flow: set `MENU_FLOW=1` to use `src/flows/menu.js` for `!menu` and `!lista`.

## Integration points and gotchas
- whatsapp-web.js Client auth dir is `.wwebjs_auth`; Windows can lock files on LOGOUT. Use provided `safeReauth` and `removeAuthDirWithRetry` logic.
- If changing flow contracts, update `engine.js` and validators. Don’t switch to a screen/config style without updating the engine and tests.
- Stick to the `FlowEngine` for conversational logic; don’t reintroduce direct `new List()` or `new Buttons()` paths unless tests and handlers are updated accordingly.
- Rate limiting must wrap all sends. If adding new send sites, go through `sendSafe`.

## Examples
- Start a flow and send the initial prompt with options:
  ```js
  const start = await flowEngine.start(chatId, MenuFlow);
  if (start.ok) {
    const node = start.node;
    await sendSafe(chatId, node.prompt + '\n' + node.options.map((o,i)=>`${i+1}. ${o.text}`).join('\n'));
  }
  ```
- Advance an active flow with normalized input:
  ```js
  const res = await flowEngine.advance(chatId, body);
  if (res.ok && !res.terminal) {
    await sendSafe(chatId, res.prompt + '\n' + res.options.join('\n'));
  }
  ```
