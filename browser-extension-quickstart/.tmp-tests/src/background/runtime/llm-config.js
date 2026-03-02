"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_PROVIDER_VALUES = void 0;
exports.getMissingLLMConfigFields = getMissingLLMConfigFields;
exports.normalizeBaseURL = normalizeBaseURL;
exports.normalizeStoredLLMConfig = normalizeStoredLLMConfig;
exports.resolveActiveTabId = resolveActiveTabId;
exports.SUPPORTED_PROVIDER_VALUES = [
    "openai",
    "anthropic",
    "google",
    "bedrock",
    "azure",
    "openrouter",
    "openai-compatible",
    "modelscope",
];
function toStoredLLMConfig(config) {
    if (config && typeof config === "object") {
        return config;
    }
    return {};
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isSupportedProvider(value) {
    return (typeof value === "string" &&
        exports.SUPPORTED_PROVIDER_VALUES.includes(value));
}
function getMissingLLMConfigFields(config) {
    const llmConfig = toStoredLLMConfig(config);
    const missingFields = [];
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
function normalizeBaseURL(config) {
    const llmConfig = toStoredLLMConfig(config);
    const baseURL = llmConfig.options?.baseURL;
    if (!isNonEmptyString(baseURL)) {
        return undefined;
    }
    return baseURL.trim();
}
function normalizeStoredLLMConfig(config) {
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
function resolveActiveTabId(tabs) {
    const activeTab = tabs.find((tab) => typeof tab.id === "number");
    return activeTab?.id ?? null;
}
