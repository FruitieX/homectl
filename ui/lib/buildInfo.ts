export type BuildInfo = {
  version: string;
  gitCommit: string;
  buildDate: string;
};

type BuildInfoInput = Partial<Record<keyof BuildInfo, unknown>>;

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function normalizeBuildInfo(input: BuildInfoInput): BuildInfo {
  return {
    version: nonEmptyString(input.version) ?? 'development',
    gitCommit: nonEmptyString(input.gitCommit) ?? 'unknown',
    buildDate: nonEmptyString(input.buildDate) ?? 'unknown',
  };
}
