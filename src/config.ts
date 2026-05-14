export type LockableKey = "aspectRatio" | "imageSize";

export type OperatorConfig = {
  /** Allowlist of model IDs. Empty = no restriction. */
  allowedModels: string[];
  /** Override default model. Validated against allowlist if both set. */
  defaultModel?: string;
  /** Cap on the count parameter (1..maxCount). Defaults to 8. */
  maxCount: number;
  /** Defaults applied when the agent omits imageConfig fields. */
  defaultImageConfig: Partial<Record<LockableKey, string>>;
  /** Keys the agent is forbidden from overriding. */
  lockedImageConfig: Set<LockableKey>;
  /** Free-text shown to the agent via the server's MCP `instructions` field. */
  operatorNotes?: string;
};

const HARD_MAX_COUNT = 8;
const ABSOLUTE_MAX_COUNT_CEILING = 32;

function csv(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function clean(input: string | undefined): string | undefined {
  const v = input?.trim();
  return v ? v : undefined;
}

function parseLocked(raw: string | undefined): Set<LockableKey> {
  const set = new Set<LockableKey>();
  for (const k of csv(raw)) {
    if (k === "aspectRatio" || k === "imageSize") set.add(k);
  }
  return set;
}

function parsePositiveInt(
  raw: string | undefined,
  defaultValue: number,
  ceiling: number,
): number {
  if (!raw) return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return defaultValue;
  return Math.min(n, ceiling);
}

export function loadOperatorConfig(env: NodeJS.ProcessEnv = process.env): OperatorConfig {
  const defaultImageConfig: Partial<Record<LockableKey, string>> = {};
  const ar = clean(env.DEFAULT_ASPECT_RATIO);
  const sz = clean(env.DEFAULT_IMAGE_SIZE);
  if (ar) defaultImageConfig.aspectRatio = ar;
  if (sz) defaultImageConfig.imageSize = sz;

  return {
    allowedModels: csv(env.ALLOWED_MODELS),
    defaultModel: clean(env.DEFAULT_MODEL),
    maxCount: parsePositiveInt(env.MAX_COUNT, HARD_MAX_COUNT, ABSOLUTE_MAX_COUNT_CEILING),
    defaultImageConfig,
    lockedImageConfig: parseLocked(env.LOCK_IMAGE_CONFIG),
    operatorNotes: clean(env.OPERATOR_NOTES),
  };
}

/** Returns a human-readable summary suitable for embedding in the tool/server instructions. */
export function describeOperatorRestrictions(cfg: OperatorConfig): string | undefined {
  const lines: string[] = [];
  if (cfg.allowedModels.length > 0) {
    lines.push(`Operator allows only these models: ${cfg.allowedModels.join(", ")}.`);
  }
  if (cfg.defaultModel) {
    lines.push(`Default model: ${cfg.defaultModel}.`);
  }
  if (cfg.maxCount !== HARD_MAX_COUNT) {
    lines.push(`Maximum count per call: ${cfg.maxCount}.`);
  }
  for (const key of ["aspectRatio", "imageSize"] as LockableKey[]) {
    const def = cfg.defaultImageConfig[key];
    const locked = cfg.lockedImageConfig.has(key);
    if (def && locked) {
      lines.push(`${key} is LOCKED to "${def}" — do not override.`);
    } else if (def) {
      lines.push(`Default ${key}: "${def}" (overridable).`);
    } else if (locked) {
      lines.push(`${key} is LOCKED — do not provide a value.`);
    }
  }
  if (cfg.operatorNotes) {
    lines.push(cfg.operatorNotes);
  }
  return lines.length > 0 ? lines.join(" ") : undefined;
}
