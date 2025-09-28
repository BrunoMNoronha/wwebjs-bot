'use strict';

const { validateAnswerOptions, buildOptionMatcher } = require('./answers');

/**
 * Estrutura esperada:
 * flow = {
 *   nodeId: {
 *     prompt: string,
 *     options: [{ id, text, next?, aliases?, correct? }],
 *     terminal?: boolean
 *   },
 *   ...
 * }
 * startId: string
 */
function validateOptionFlow(flow, startId, cfg = {}) {
  const errors = [];
  const warnings = [];

  if (flow && typeof flow === 'object' && flow.start && flow.nodes) {
    // Suporta shape { start, nodes }
    startId = startId ?? flow.start;
    flow = flow.nodes;
  }

  if (!flow || typeof flow !== 'object') {
    return { ok: false, errors: ['flow deve ser um objeto de nós'], warnings, stats: {} };
  }
  if (!startId || typeof startId !== 'string') {
    return { ok: false, errors: ['startId deve ser uma string'], warnings, stats: {} };
  }
  if (!flow[startId]) {
    errors.push(`Nó inicial "${startId}" não existe no fluxo.`);
  }

  // Validação por nó
  const nodeIds = Object.keys(flow);
  const outgoing = new Map(); // nodeId -> Set(nextIds)
  nodeIds.forEach(nodeId => {
    const node = flow[nodeId];

    if (!node || typeof node !== 'object') {
      errors.push(`Nó "${nodeId}" inválido.`);
      return;
    }

    if (!node.terminal && (!node.prompt || typeof node.prompt !== 'string' || !node.prompt.trim())) {
      errors.push(`Nó "${nodeId}" sem prompt.`);
    }

    const options = Array.isArray(node.options) ? node.options : [];
    if (node.terminal && options.length > 0) {
      errors.push(`Nó terminal "${nodeId}" não deve ter opções.`);
    }

    const optRes = validateAnswerOptions(options, cfg.answers || {});
    if (!optRes.ok) {
      optRes.errors.forEach(e => errors.push(`Nó "${nodeId}": ${e}`));
    }
    optRes.warnings.forEach(w => warnings.push(`Nó "${nodeId}": ${w}`));

    const nexts = new Set();
    options.forEach(opt => {
      if (opt.next != null) {
        nexts.add(opt.next);
        if (!flow[opt.next]) {
          errors.push(`Nó "${nodeId}": next "${opt.next}" não existe.`);
        }
      }
    });
    outgoing.set(nodeId, nexts);
  });

  // Alcançabilidade a partir de startId
  const visited = new Set();
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || visited.has(cur) || !flow[cur]) continue;
    visited.add(cur);
    const nexts = outgoing.get(cur);
    if (nexts) {
      nexts.forEach(n => stack.push(n));
    }
  }
  nodeIds.forEach(id => {
    if (!visited.has(id)) {
      errors.push(`Nó "${id}" é inalcançável a partir de "${startId}".`);
    }
  });

  // Detecção simples de ciclos (aviso)
  const color = new Map(); // white:0, gray:1, black:2
  const cyclePaths = [];
  function dfs(u, path) {
    const c = color.get(u) ?? 0;
    if (c === 1) {
      // ciclo detectado
      const i = path.indexOf(u);
      if (i >= 0) cyclePaths.push(path.slice(i).concat(u));
      return;
    }
    if (c === 2) return;
    color.set(u, 1);
    const nexts = outgoing.get(u) || new Set();
    nexts.forEach(v => dfs(v, path.concat(v)));
    color.set(u, 2);
  }
  if (flow[startId]) dfs(startId, [startId]);
  if (cyclePaths.length > 0) {
    warnings.push(
      `Ciclo(s) detectado(s): ${cyclePaths.map(p => p.join(' -> ')).join(' | ')}`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      nodes: nodeIds.length,
      reachable: visited.size
    }
  };
}

/**
 * Simula um percurso no fluxo usando entradas do usuário.
 * Retorna o transcript com nós visitados e opções escolhidas.
 */
function simulateFlow(flow, startId, inputs, cfg = {}) {
  if (flow && typeof flow === 'object' && flow.start && flow.nodes) {
    startId = startId ?? flow.start;
    flow = flow.nodes;
  }

  const transcript = [];
  let current = startId;
  let steps = 0;
  const maxSteps = cfg.maxSteps ?? 100;

  while (steps < maxSteps) {
    const node = flow[current];
    if (!node) {
      return { ok: false, error: `Nó "${current}" não existe.`, transcript };
    }

    transcript.push({ nodeId: current, prompt: node.prompt });

    if (node.terminal || !node.options || node.options.length === 0) {
      return { ok: true, ended: true, endAt: current, transcript };
    }

    const matcher = buildOptionMatcher(node.options, cfg.matcher || {});
    const input = inputs.shift?.() ?? inputs.shift();
    if (input == null) {
      return {
        ok: false,
        error: `Entrada inexistente para o nó "${current}".`,
        expected: node.options.map(o => o.text),
        transcript
      };
    }

    const m = matcher.match(input);
    if (!m) {
      return {
        ok: false,
        error: `Entrada "${input}" não corresponde a nenhuma opção em "${current}".`,
        expected: node.options.map(o => o.text),
        transcript
      };
    }

    transcript.push({ choose: m.option.id, by: m.matchedBy, input });

    if (!m.option.next) {
      // Sem next => fim no nó de decisão atual
      return { ok: true, ended: true, endAt: current, transcript };
    }

    // Se o próximo nó for terminal (ou sem opções), considere o fim lógico no nó atual
    const nextId = m.option.next;
    const nextNode = flow[nextId];
    if (nextNode && (nextNode.terminal || !nextNode.options || nextNode.options.length === 0)) {
      return { ok: true, ended: true, endAt: current, transcript };
    }

    current = nextId;
    steps += 1;
  }

  return { ok: false, error: 'maxSteps excedido (possível loop).', transcript };
}

module.exports = {
  validateOptionFlow,
  simulateFlow
};
