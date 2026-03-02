type StoredLLMConfig = {
  llm?: unknown;
  modelName?: unknown;
  apiKey?: unknown;
  options?: {
    baseURL?: unknown;
  };
};

export const SUPPORTED_PROVIDER_VALUES = [
  "openai",
  "anthropic",
  "google",
  "bedrock",
  "azure",
  "openrouter",
  "openai-compatible",
  "modelscope",
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDER_VALUES)[number];

export interface NormalizedLLMConfig {
  provider: SupportedProvider;
  modelName: string;
  apiKey: string;
  baseURL?: string;
}

function toStoredLLMConfig(config: unknown): StoredLLMConfig {
  if (config && typeof config === "object") {
    return config as StoredLLMConfig;
  }
  return {};
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSupportedProvider(value: unknown): value is SupportedProvider {
  return (
    typeof value === "string" &&
    SUPPORTED_PROVIDER_VALUES.includes(value as SupportedProvider)
  );
}

export function getMissingLLMConfigFields(config: unknown): string[] {
  const llmConfig = toStoredLLMConfig(config);
  const missingFields: string[] = [];

  if (!isNonEmptyString(llmConfig.apiKey)) {
    missingFields.push("apiKey");
  }
  if (!isNonEmptyString(llmConfig.llm)) {
    missingFields.push("llm");
  }
  if (!isNonEmptyString(llmConfig.modelName)) {
    missingFields.push("modelName");
  }

  return missingFields;
}

export function normalizeBaseURL(config: unknown): string | undefined {
  const llmConfig = toStoredLLMConfig(config);
  const baseURL = llmConfig.options?.baseURL;
  if (!isNonEmptyString(baseURL)) {
    return undefined;
  }
  return baseURL.trim();
}

export function normalizeStoredLLMConfig(
  config: unknown
):
  | {
      ok: true;
      value: NormalizedLLMConfig;
    }
  | {
      ok: false;
      error: string;
    } {
  const llmConfig = toStoredLLMConfig(config);
  const missingFields = getMissingLLMConfigFields(llmConfig);
  if (missingFields.length > 0) {
    return {
      ok: false,
      error: `Please configure ${missingFields.join(", ")}, configure in the eko extension options of the browser extensions.`,
    };
  }

  if (!isSupportedProvider(llmConfig.llm)) {
    return {
      ok: false,
      error: `Unsupported llm provider: ${String(llmConfig.llm)}`,
    };
  }

  if (!isNonEmptyString(llmConfig.modelName) || !isNonEmptyString(llmConfig.apiKey)) {
    return {
      ok: false,
      error: "Invalid llm config: missing modelName or apiKey.",
    };
  }

  return {
    ok: true,
    value: {
      provider: llmConfig.llm,
      modelName: llmConfig.modelName,
      apiKey: llmConfig.apiKey,
      baseURL: normalizeBaseURL(llmConfig),
    },
  };
}

export function resolveActiveTabId(
  tabs: Array<{
    id?: number;
  }>
): number | null {
  const activeTab = tabs.find((tab) => typeof tab.id === "number");
  return activeTab?.id ?? null;
}
