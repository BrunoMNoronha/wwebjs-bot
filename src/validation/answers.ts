import { Searcher, sortKind, type FullOptions } from 'fast-fuzzy';

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

export interface BaseOptionMatch {
  readonly matchedBy: MatchKind;
  readonly option: NormalizedFlowOption;
  readonly key: string;
  readonly confidence: number;
}

export interface ExactOptionMatch extends BaseOptionMatch {
  readonly kind: 'exact';
}

export interface SuggestionOptionMatch extends BaseOptionMatch {
  readonly kind: 'suggestion';
}

export type OptionMatch = ExactOptionMatch | SuggestionOptionMatch;

export interface OptionMatcher {
  match(inputRaw: string): ExactOptionMatch | null;
  matchOption(inputRaw: string, cfg?: SuggestionConfig): OptionMatch | null;
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

interface SuggestionCandidate {
  readonly option: NormalizedFlowOption;
  readonly normalizedText: string;
}

interface SuggestionEngine {
  suggest(input: string, minimumConfidence: number): SuggestionResult | null;
}

const FAST_FUZZY_MIN_CANDIDATES = 25;

class LevenshteinSuggestionEngine implements SuggestionEngine {
  constructor(private readonly candidates: readonly SuggestionCandidate[]) {}

  suggest(input: string, minimumConfidence: number): SuggestionResult | null {
    const normalizedInput = normalizeText(input);
    if (!normalizedInput) {
      return null;
    }
    let best: SuggestionResult | null = null;
    this.candidates.forEach((candidate) => {
      const denominator = Math.max(normalizedInput.length, candidate.normalizedText.length);
      if (denominator === 0) {
        return;
      }
      const distance = levenshteinDistance(normalizedInput, candidate.normalizedText);
      const confidence = 1 - distance / denominator;
      if (confidence >= minimumConfidence) {
        if (!best || confidence > best.confidence) {
          best = { option: candidate.option, confidence };
        }
      }
    });
    return best;
  }
}

type FastFuzzyOptions = FullOptions<SuggestionCandidate> & { readonly returnMatchData: true };

class FastFuzzySuggestionEngine implements SuggestionEngine {
  private readonly searcher: Searcher<SuggestionCandidate, FastFuzzyOptions>;

  constructor(candidates: readonly SuggestionCandidate[]) {
    const options: FastFuzzyOptions = {
      keySelector: (candidate: SuggestionCandidate) => candidate.normalizedText,
      ignoreCase: false,
      ignoreSymbols: false,
      normalizeWhitespace: true,
      returnMatchData: true,
      sortBy: sortKind.bestMatch,
      threshold: 0,
    };
    this.searcher = new Searcher([...candidates], options);
  }

  suggest(input: string, minimumConfidence: number): SuggestionResult | null {
    const normalizedInput = normalizeText(input);
    if (!normalizedInput) {
      return null;
    }
    const matches = this.searcher.search(normalizedInput, {
      threshold: minimumConfidence,
      returnMatchData: true,
    });
    if (!Array.isArray(matches) || matches.length === 0) {
      return null;
    }
    const best = matches[0];
    return { option: best.item.option, confidence: best.score };
  }
}

function createSuggestionEngine(candidates: readonly SuggestionCandidate[]): SuggestionEngine | null {
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length >= FAST_FUZZY_MIN_CANDIDATES) {
    return new FastFuzzySuggestionEngine(candidates);
  }
  return new LevenshteinSuggestionEngine(candidates);
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

  const suggestionCandidates: SuggestionCandidate[] = [];

  normalizedOptions.forEach((option, index) => {
    if (option.id) {
      byId.set(option.id, option);
    }
    const normalizedText = normalizeText(option.text);
    if (normalizedText) {
      byNormalized.set(`t:${normalizedText}`, option);
      suggestionCandidates.push({ option, normalizedText });
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

  const suggestionEngine = createSuggestionEngine(suggestionCandidates);

  const matchExact = (inputRaw: string): ExactOptionMatch | null => {
    if (inputRaw == null) {
      return null;
    }
    const raw = String(inputRaw).trim();
    if (!raw) {
      return null;
    }
    if (byId.has(raw)) {
      return {
        kind: 'exact',
        matchedBy: 'id',
        option: byId.get(raw) as NormalizedFlowOption,
        key: raw,
        confidence: 1,
      };
    }
    if (allowIndex && /^\d+$/.test(raw)) {
      const normalizedIndexKey = `i:${Number(raw)}`;
      if (byNormalized.has(normalizedIndexKey)) {
        return {
          kind: 'exact',
          matchedBy: 'index',
          option: byNormalized.get(normalizedIndexKey) as NormalizedFlowOption,
          key: raw,
          confidence: 1,
        };
      }
    }
    const normalizedValue = normalizeText(raw);
    if (!normalizedValue) {
      return null;
    }
    const aliasKey = `a:${normalizedValue}`;
    if (byNormalized.has(aliasKey)) {
      return {
        kind: 'exact',
        matchedBy: 'alias',
        option: byNormalized.get(aliasKey) as NormalizedFlowOption,
        key: normalizedValue,
        confidence: 1,
      };
    }
    const textKey = `t:${normalizedValue}`;
    if (byNormalized.has(textKey)) {
      return {
        kind: 'exact',
        matchedBy: 'text',
        option: byNormalized.get(textKey) as NormalizedFlowOption,
        key: normalizedValue,
        confidence: 1,
      };
    }
    return null;
  };

  const matchOption = (inputRaw: string, suggestionCfg?: SuggestionConfig): OptionMatch | null => {
    const exact = matchExact(inputRaw);
    if (exact) {
      return exact;
    }
    if (!suggestionEngine) {
      return null;
    }
    const minimumConfidence = suggestionCfg?.minimumConfidence ?? 0.5;
    const suggestion = suggestionEngine.suggest(inputRaw, minimumConfidence);
    if (!suggestion) {
      return null;
    }
    return {
      kind: 'suggestion',
      matchedBy: 'text',
      option: suggestion.option,
      key: normalizeText(inputRaw),
      confidence: suggestion.confidence,
    };
  };

  return {
    match: matchExact,
    matchOption,
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
  const matcher = buildOptionMatcher(options);
  const match = matcher.matchOption(inputRaw, cfg);
  if (!match || match.kind !== 'suggestion') {
    return null;
  }
  return { option: match.option, confidence: match.confidence };
}
