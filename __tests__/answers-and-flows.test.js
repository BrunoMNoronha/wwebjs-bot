const { validateAnswerOptions, buildOptionMatcher } = require('../src/validation/answers');
const { validateOptionFlow, simulateFlow } = require('../src/validation/flows');

describe('answers | opções de respostas', () => {
  test('valida ids e textos únicos', () => {
    const res = validateAnswerOptions([
      { id: 'a1', text: 'Sim' },
      { id: 'a2', text: 'Não' }
    ]);
    expect(res.ok).toBe(true);
  });

  test('detecta duplicidade e campos obrigatórios', () => {
    const res = validateAnswerOptions([
      { id: 'x', text: 'Ok' },
      { id: 'x', text: 'Ok' },         // id duplicado e texto duplicado
      { id: '', text: '' }             // faltando id/texto
    ]);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('Id duplicado'))).toBe(true);
    expect(res.errors.some(e => e.includes('Texto duplicado'))).toBe(true);
  });

  test('matcher por id, índice, alias e texto', () => {
    const options = [
      { id: '1', text: 'Continuar', aliases: ['go', 'segue'] },
      { id: '2', text: 'Sair' }
    ];
    const matcher = buildOptionMatcher(options);
    expect(matcher.match('1')?.option.id).toBe('1');               // id
    expect(matcher.match('2')?.option.id).toBe('2');               // id
    expect(matcher.match('go')?.option.id).toBe('1');              // alias
    expect(matcher.match('continuar')?.option.id).toBe('1');       // texto normalizado
    expect(matcher.match('1')?.matchedBy).toBe('id');
    expect(matcher.match('2')?.matchedBy).toBe('id');
    expect(matcher.match('3')).toBeNull();
  });

  test('matcher funciona quando aliases não é fornecido', () => {
    const options = [
      { id: 'a', text: 'Primeira' },
      { id: 'b', text: 'Segunda' }
    ];
    const matcher = buildOptionMatcher(options);
    expect(matcher.match('1')?.option.id).toBe('a'); // índice 1
    expect(matcher.match('segunda')?.option.id).toBe('b'); // texto normalizado
  });
});

describe('flows | validação de fluxo', () => {
  const flow = {
    start: 'inicio',
    nodes: {
      inicio: {
        prompt: 'Olá! O que deseja?',
        options: [
          { id: 'opt1', text: 'Suporte', next: 'suporte' },
          { id: 'opt2', text: 'Sair', next: 'fim' }
        ]
      },
      suporte: {
        prompt: 'Qual o tipo de suporte?',
        options: [
          { id: 't1', text: 'Financeiro', next: 'fim' },
          { id: 't2', text: 'Técnico', next: 'fim' }
        ]
      },
      fim: { prompt: 'Até logo!', terminal: true, options: [] }
    }
  };

  test('fluxo válido', () => {
    const res = validateOptionFlow(flow, undefined, {});
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  test('detecta next inexistente e nó inalcançável', () => {
    const broken = {
      start: 'a',
      nodes: {
        a: { prompt: 'A', options: [{ id: 'x', text: 'Ir', next: 'b' }] },
        b: { prompt: 'B', options: [{ id: 'y', text: 'Ir', next: 'c' }] },
        c: { prompt: 'C', options: [{ id: 'z', text: 'Ir', next: 'nao-existe' }] },
        d: { prompt: 'Orfão', options: [] } // inalcançável
      }
    };
    const res = validateOptionFlow(broken, undefined, {});
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.includes('nao-existe'))).toBe(true);
    expect(res.errors.some(e => e.includes('inalcançável'))).toBe(true);
  });

  test('alerta sobre ciclos', () => {
    const cyclic = {
      start: 's',
      nodes: {
        s: { prompt: 'S', options: [{ id: 'a', text: 'Vai', next: 't' }] },
        t: { prompt: 'T', options: [{ id: 'b', text: 'Volta', next: 's' }] }
      }
    };
    const res = validateOptionFlow(cyclic, undefined, {});
    expect(res.ok).toBe(true);
    expect(res.warnings.some(w => w.toLowerCase().includes('ciclo'))).toBe(true);
  });
});

describe('flows | simulação', () => {
  test('percorre fluxo simples', () => {
    const flow = {
      start: 'start',
      nodes: {
        start: {
          prompt: 'Escolha',
          options: [
            { id: '1', text: 'Ir', next: 'end' },
            { id: '2', text: 'Sair', next: 'end' }
          ]
        },
        end: { prompt: 'Fim', terminal: true, options: [] }
      }
    };
    const sim = simulateFlow(flow, undefined, ['1']);
    expect(sim.ok).toBe(true);
    expect(sim.ended).toBe(true);
    expect(sim.endAt).toBe('start');
  });

  test('erro se entrada não bate com nenhuma opção', () => {
    const flow = {
      start: 's',
      nodes: {
        s: { prompt: 'Escolha', options: [{ id: 'a', text: 'Ok', next: 'f' }] },
        f: { prompt: 'Fim', terminal: true, options: [] }
      }
    };
    const sim = simulateFlow(flow, undefined, ['x']);
    expect(sim.ok).toBe(false);
    expect(sim.error).toMatch(/não corresponde/);
  });
});
