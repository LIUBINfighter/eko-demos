"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const llm_config_1 = require("../src/background/runtime/llm-config");
(0, node_test_1.default)("getMissingLLMConfigFields returns required missing fields", () => {
    strict_1.default.deepEqual((0, llm_config_1.getMissingLLMConfigFields)(undefined), [
        "apiKey",
        "llm",
        "modelName",
    ]);
    strict_1.default.deepEqual((0, llm_config_1.getMissingLLMConfigFields)({
        llm: "openai",
        modelName: "gpt-4o-mini",
        apiKey: "sk-123",
    }), []);
});
(0, node_test_1.default)("normalizeBaseURL trims valid url and ignores empty values", () => {
    strict_1.default.equal((0, llm_config_1.normalizeBaseURL)({
        options: {
            baseURL: " https://api.openai.com/v1 ",
        },
    }), "https://api.openai.com/v1");
    strict_1.default.equal((0, llm_config_1.normalizeBaseURL)({
        options: {
            baseURL: "   ",
        },
    }), undefined);
    strict_1.default.equal((0, llm_config_1.normalizeBaseURL)({}), undefined);
});
(0, node_test_1.default)("resolveActiveTabId handles empty and valid tab lists", () => {
    strict_1.default.equal((0, llm_config_1.resolveActiveTabId)([]), null);
    strict_1.default.equal((0, llm_config_1.resolveActiveTabId)([{ id: undefined }]), null);
    strict_1.default.equal((0, llm_config_1.resolveActiveTabId)([{ id: 88 }]), 88);
    strict_1.default.equal((0, llm_config_1.resolveActiveTabId)([{ id: undefined }, { id: 99 }]), 99);
});
(0, node_test_1.default)("normalizeStoredLLMConfig validates provider and required fields", () => {
    const invalidProvider = (0, llm_config_1.normalizeStoredLLMConfig)({
        llm: "not-supported",
        modelName: "m",
        apiKey: "k",
    });
    strict_1.default.equal(invalidProvider.ok, false);
    if (!invalidProvider.ok) {
        strict_1.default.match(invalidProvider.error, /Unsupported llm provider/);
    }
    const valid = (0, llm_config_1.normalizeStoredLLMConfig)({
        llm: "openai",
        modelName: "gpt-4o-mini",
        apiKey: "sk-123",
        options: {
            baseURL: " https://api.openai.com/v1 ",
        },
    });
    strict_1.default.equal(valid.ok, true);
    if (valid.ok) {
        strict_1.default.equal(valid.value.provider, "openai");
        strict_1.default.equal(valid.value.baseURL, "https://api.openai.com/v1");
    }
});
