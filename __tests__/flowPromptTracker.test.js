const { createFlowPromptTracker } = require('../src/app/flowPromptTracker');

describe('createFlowPromptTracker', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('retorna undefined quando nada foi lembrado', () => {
        const tracker = createFlowPromptTracker();
        tracker.remember('chat');
        expect(tracker.recentFlowKey('chat')).toBeUndefined();
    });

    it('retorna a chave do fluxo quando dentro da janela configurada', () => {
        const tracker = createFlowPromptTracker({ windowMs: 1000 });
        tracker.remember('chat-1', 'menu');
        expect(tracker.recentFlowKey('chat-1')).toBe('menu');
        jest.advanceTimersByTime(1500);
        expect(tracker.recentFlowKey('chat-1')).toBeUndefined();
    });

    it('atualiza o timestamp ao lembrar sem fornecer a chave', () => {
        const tracker = createFlowPromptTracker({ windowMs: 5000 });
        tracker.remember('chat-2', 'catalog');
        jest.advanceTimersByTime(4000);
        tracker.remember('chat-2');
        jest.advanceTimersByTime(4000);
        expect(tracker.recentFlowKey('chat-2')).toBe('catalog');
    });

    it('remove registros corretamente', () => {
        const tracker = createFlowPromptTracker();
        tracker.remember('chat-3', 'menu');
        expect(tracker.recentFlowKey('chat-3')).toBe('menu');
        tracker.clear('chat-3');
        expect(tracker.recentFlowKey('chat-3')).toBeUndefined();
    });
});
