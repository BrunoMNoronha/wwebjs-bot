export interface RawFlowOption {
  readonly id?: string;
  readonly key?: string;
  readonly value?: string;
  readonly text?: string;
  readonly label?: string;
  readonly title?: string;
  readonly next?: string;
  readonly to?: string;
  readonly goto?: string;
  readonly aliases?: readonly string[];
  readonly correct?: boolean;
}

export interface NormalizedFlowOption {
  readonly originalIndex: number;
  readonly id: string;
  readonly text: string;
  readonly next?: string;
  readonly aliases: readonly string[];
  readonly correct: boolean;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly options: readonly NormalizedFlowOption[];
}

export type MatchKind = 'id' | 'index' | 'alias' | 'text';

export interface OptionMatch {
  readonly kind: MatchKind;
  readonly matchedBy: MatchKind;
  readonly option: NormalizedFlowOption;
  readonly key: string;
}

export interface OptionMatcher {
  match(inputRaw: string): OptionMatch | null;
}

export interface SuggestionResult {
  readonly option: NormalizedFlowOption;
  readonly confidence: number;
}

export interface MatcherConfig {
  readonly allowIndex?: boolean;
}

export interface SuggestionConfig {
  readonly minimumConfidence: number;
}

export function normalizeText(value: string | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function normalizeOption(option: RawFlowOption, index: number): NormalizedFlowOption {
  const id = option.id ?? option.key ?? option.value ?? '';
  const text = option.text ?? option.label ?? option.title ?? '';
  const next = option.next ?? option.to ?? option.goto;
  const aliases = Array.isArray(option.aliases) ? option.aliases : [];

  return {
    originalIndex: index,
    id: String(id).trim(),
    text: String(text).trim(),
    next: typeof next === 'string' ? next.trim() : next,
    aliases: aliases.filter((alias) => typeof alias === 'string').map((alias) => alias.trim()),
    correct: Boolean(option.correct),
  };
}

export function validateAnswerOptions(options: readonly RawFlowOption[], config: {
  readonly requireAtLeastOneCorrect?: boolean;
  readonly uniqueText?: boolean;
} = {}): ValidationResult {
  const { requireAtLeastOneCorrect = false, uniqueText = true } = config;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(options)) {
    return { ok: false, errors: ['options deve ser um array'], warnings, options: [] };
  }
  const normalized = options.map((opt, index) => normalizeOption(opt, index));
  const ids = new Set<string>();
  const texts = new Set<string>();
  let hasCorrect = false;

  normalized.forEach((option) => {
    if (!option.id) {
      errors.push(`Opção[${option.originalIndex}] sem id.`);
    } else if (ids.has(option.id)) {
      errors.push(`Id duplicado: "${option.id}".`);
    } else {
      ids.add(option.id);
    }

    if (!option.text) {
      errors.push(`Opção[${option.originalIndex}] sem texto.`);
    } else if (uniqueText) {
      const normalizedText = normalizeText(option.text);
      if (texts.has(normalizedText)) {
        errors.push(`Texto duplicado (case-insensitive): "${option.text}".`);
      } else {
        texts.add(normalizedText);
      }
    }

    const normalizedText = normalizeText(option.text);
    const aliasCollisions = option.aliases
      .map((alias) => normalizeText(alias))
      .filter((alias) => alias === normalizedText);
    if (aliasCollisions.length > 0) {
      warnings.push(
        `Opção "${option.id}" possui alias(es) iguais ao texto principal: ${aliasCollisions.join(', ')}`,
      );
    }

    if (option.next != null && typeof option.next !== 'string') {
      errors.push(`Opção "${option.id}" tem next inválido (deve ser string).`);
    }

    if (option.correct) {
      hasCorrect = true;
    }
  });

  if (requireAtLeastOneCorrect && !hasCorrect) {
    errors.push('É necessário pelo menos uma opção marcada como correta.');
  }

  return { ok: errors.length === 0, errors, warnings, options: errors.length === 0 ? normalized : [] };
}

export function buildOptionMatcher(
  options: readonly (RawFlowOption | NormalizedFlowOption)[],
  cfg: MatcherConfig = {},
): OptionMatcher {
  const allowIndex = cfg.allowIndex ?? true;
  const byId = new Map<string, NormalizedFlowOption>();
  const byNormalized = new Map<string, NormalizedFlowOption>();

  const normalizedOptions = options.map((option, index) =>
    'originalIndex' in option ? option : normalizeOption(option, index),
  );

  normalizedOptions.forEach((option, index) => {
    if (option.id) {
      byId.set(option.id, option);
    }
    const normalizedText = normalizeText(option.text);
    if (normalizedText) {
      byNormalized.set(`t:${normalizedText}`, option);
    }
    option.aliases.forEach((alias) => {
      const normalizedAlias = normalizeText(alias);
      if (normalizedAlias) {
        byNormalized.set(`a:${normalizedAlias}`, option);
      }
    });
    if (allowIndex) {
      byNormalized.set(`i:${index + 1}`, option);
    }
  });

  return {
    match(inputRaw: string): OptionMatch | null {
      if (inputRaw == null) {
        return null;
      }
      const raw = String(inputRaw).trim();
      if (byId.has(raw)) {
        return { kind: 'id', matchedBy: 'id', option: byId.get(raw) as NormalizedFlowOption, key: raw };
      }
      if (allowIndex && /^\d+$/.test(raw)) {
        const normalizedIndexKey = `i:${Number(raw)}`;
        if (byNormalized.has(normalizedIndexKey)) {
          return {
            kind: 'index',
            matchedBy: 'index',
            option: byNormalized.get(normalizedIndexKey) as NormalizedFlowOption,
            key: raw,
          };
        }
      }
      const normalizedValue = normalizeText(raw);
      const aliasKey = `a:${normalizedValue}`;
      if (byNormalized.has(aliasKey)) {
        return {
          kind: 'alias',
          matchedBy: 'alias',
          option: byNormalized.get(aliasKey) as NormalizedFlowOption,
          key: normalizedValue,
        };
      }
      const textKey = `t:${normalizedValue}`;
      if (byNormalized.has(textKey)) {
        return {
          kind: 'text',
          matchedBy: 'text',
          option: byNormalized.get(textKey) as NormalizedFlowOption,
          key: normalizedValue,
        };
      }
      return null;
    },
  };
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

export function findBestSuggestion(
  inputRaw: string,
  options: readonly NormalizedFlowOption[],
  cfg: SuggestionConfig,
): SuggestionResult | null {
  if (!inputRaw.trim()) {
    return null;
  }
  const normalizedInput = normalizeText(inputRaw);
  if (!normalizedInput) {
    return null;
  }
  let best: SuggestionResult | null = null;
  options.forEach((option) => {
    const candidate = normalizeText(option.text);
    if (!candidate) {
      return;
    }
    const distance = levenshteinDistance(normalizedInput, candidate);
    const denominator = Math.max(normalizedInput.length, candidate.length);
    if (denominator === 0) {
      return;
    }
    const confidence = 1 - distance / denominator;
    if (confidence >= cfg.minimumConfidence) {
      if (!best || confidence > best.confidence) {
        best = { option, confidence };
      }
    }
  });
  return best;
}
