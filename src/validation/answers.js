'use strict';

/**
 * Normaliza texto para comparações estáveis.
 */
function normalizeText(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Normaliza uma opção para o formato canônico.
 * Aceita alias de campos comuns: id|key|value e text|label|title, next|to|goto
 */
/**
 * @param {{
 *   id?: string,
 *   key?: string,
 *   value?: string,
 *   text?: string,
 *   label?: string,
 *   title?: string,
 *   next?: string,
 *   to?: string,
 *   goto?: string,
 *   aliases?: string[],
 *   correct?: boolean
 * }} opt
 * @param {number} index
 */
function normalizeOption(opt, index) {
  const id = opt.id ?? opt.key ?? opt.value;
  const text = opt.text ?? opt.label ?? opt.title;
  const next = opt.next ?? opt.to ?? opt.goto;
  const aliases = Array.isArray(opt.aliases) ? opt.aliases : [];
  const correct = Boolean(opt.correct);

  return {
    originalIndex: index,
    id: typeof id === 'string' ? id.trim() : id,
    text: typeof text === 'string' ? text.trim() : text,
    next: typeof next === 'string' ? next.trim() : next,
    aliases: aliases
      .filter(a => typeof a === 'string')
      .map(a => a.trim())
      .filter(Boolean),
    correct
  };
}

/**
 * Valida lista de opções de resposta.
 * Regras:
 * - Array obrigatório
 * - id e text obrigatórios
 * - ids únicos (case-sensitive) e textos únicos por lista (case-insensitive)
 * - aliases não podem colidir com o próprio texto (case-insensitive)
 * - next é opcional, mas se presente deve ser string (validação de existência do nó é feita no fluxo)
 * - (opcional) pelo menos uma correta se requireAtLeastOneCorrect = true
 */
/**
 * @param {unknown[]} options
 * @param {{requireAtLeastOneCorrect?: boolean, uniqueText?: boolean}} [config]
 */
function validateAnswerOptions(options, config = {}) {
  const {
    requireAtLeastOneCorrect = false,
    uniqueText = true
  } = config;

  const errors = [];
  const warnings = [];

  if (!Array.isArray(options)) {
    return { ok: false, errors: ['options deve ser um array'], warnings, options: [] };
  }

  const normalized = options.map((opt, i) => {
    if (typeof opt !== 'object' || opt == null) {
      return { error: `Opção no índice ${i} não é um objeto válido.` };
    }
    return normalizeOption(opt, i);
  });

  const idSet = new Set();
  const textSet = new Set();
  let hasCorrect = false;

  normalized.forEach((opt, i) => {
    if (opt.error) {
      errors.push(opt.error);
      return;
    }

    if (!opt.id || typeof opt.id !== 'string' || !opt.id.trim()) {
      errors.push(`Opção[${i}] sem id.`);
    } else if (idSet.has(opt.id)) {
      errors.push(`Id duplicado: "${opt.id}".`);
    } else {
      idSet.add(opt.id);
    }

    if (!opt.text || typeof opt.text !== 'string' || !opt.text.trim()) {
      errors.push(`Opção[${i}] sem texto.`);
    } else if (uniqueText) {
      const t = normalizeText(opt.text);
      if (textSet.has(t)) {
        errors.push(`Texto duplicado (case-insensitive): "${opt.text}".`);
      } else {
        textSet.add(t);
      }
    }

    // aliases não podem duplicar o texto principal
    const tnorm = normalizeText(opt.text ?? '');
    const aliasCollisions = new Set();
    opt.aliases.forEach(a => {
      if (normalizeText(a) === tnorm) {
        aliasCollisions.add(a);
      }
    });
    if (aliasCollisions.size > 0) {
      warnings.push(
        `Opção "${opt.id}" possui alias(es) iguais ao texto principal: ${[...aliasCollisions].join(', ')}`
      );
    }

    if (opt.next != null && typeof opt.next !== 'string') {
      errors.push(`Opção "${opt.id}" tem next inválido (deve ser string).`);
    }

    if (opt.correct) hasCorrect = true;
  });

  if (requireAtLeastOneCorrect && !hasCorrect) {
    errors.push('É necessário pelo menos uma opção marcada como correta.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    options: errors.length === 0 ? normalized : []
  };
}

/**
 * Cria um matcher para identificar opções a partir de uma entrada do usuário.
 * Estratégia:
 * - match por id exato
 * - match por alias (normalizado)
 * - match por texto (normalizado)
 * - (opcional) índice (1-based) se allowIndex = true
 */
/**
 * @param {Array<ReturnType<typeof normalizeOption>>} options
 * @param {{allowIndex?: boolean}} [cfg]
 */
function buildOptionMatcher(options, cfg = {}) {
  const {
    allowIndex = true
  } = cfg;

  const byId = new Map();
  const byNorm = new Map();

  options.forEach((opt, idx) => {
    if (opt.id) byId.set(opt.id, opt);

    const normText = normalizeText(opt.text);
    if (normText) byNorm.set(`t:${normText}`, opt);

    // Garante compatibilidade quando aliases não é fornecido
    (opt.aliases || []).forEach(a => {
      const n = normalizeText(a);
      if (n) byNorm.set(`a:${n}`, opt);
    });

    // índice (1-based)
    if (allowIndex) {
      byNorm.set(`i:${idx + 1}`, opt);
    }
  });

  function match(inputRaw) {
    if (inputRaw == null) return null;
    const raw = String(inputRaw);

    // id exato (case-sensitive)
    if (byId.has(raw)) {
      return { option: byId.get(raw), matchedBy: 'id', key: raw };
    }

    // índice
    if (allowIndex && /^\d+$/.test(raw)) {
      const key = `i:${Number(raw)}`;
      if (byNorm.has(key)) {
        return { option: byNorm.get(key), matchedBy: 'index', key: raw };
      }
    }

    const n = normalizeText(raw);
    const aliasKey = `a:${n}`;
    if (byNorm.has(aliasKey)) {
      return { option: byNorm.get(aliasKey), matchedBy: 'alias', key: n };
    }

    const textKey = `t:${n}`;
    if (byNorm.has(textKey)) {
      return { option: byNorm.get(textKey), matchedBy: 'text', key: n };
    }

    return null;
  }

  return { match };
}

module.exports = {
  validateAnswerOptions,
  buildOptionMatcher,
  normalizeOption,
  normalizeText
};
