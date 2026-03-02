import assert from "node:assert/strict";
import test from "node:test";
import {
  getMissingLLMConfigFields,
  normalizeStoredLLMConfig,
  normalizeBaseURL,
  resolveActiveTabId,
} from "../src/background/runtime/llm-config";

test("getMissingLLMConfigFields returns required missing fields", () => {
  assert.deepEqual(getMissingLLMConfigFields(undefined), [
    "apiKey",
    "llm",
    "modelName",
  ]);

  assert.deepEqual(
    getMissingLLMConfigFields({
      llm: "openai",
      modelName: "gpt-4o-mini",
      apiKey: "sk-123",
    }),
    []
  );
});

test("normalizeBaseURL trims valid url and ignores empty values", () => {
  assert.equal(
    normalizeBaseURL({
      options: {
        baseURL: " https://api.openai.com/v1 ",
      },
    }),
    "https://api.openai.com/v1"
  );

  assert.equal(
    normalizeBaseURL({
      options: {
        baseURL: "   ",
      },
    }),
    undefined
  );

  assert.equal(normalizeBaseURL({}), undefined);
});

test("resolveActiveTabId handles empty and valid tab lists", () => {
  assert.equal(resolveActiveTabId([]), null);
  assert.equal(resolveActiveTabId([{ id: undefined }]), null);
  assert.equal(resolveActiveTabId([{ id: 88 }]), 88);
  assert.equal(resolveActiveTabId([{ id: undefined }, { id: 99 }]), 99);
});

test("normalizeStoredLLMConfig validates provider and required fields", () => {
  const invalidProvider = normalizeStoredLLMConfig({
    llm: "not-supported",
    modelName: "m",
    apiKey: "k",
  });
  assert.equal(invalidProvider.ok, false);
  if (!invalidProvider.ok) {
    assert.match(invalidProvider.error, /Unsupported llm provider/);
  }

  const valid = normalizeStoredLLMConfig({
    llm: "openai",
    modelName: "gpt-4o-mini",
    apiKey: "sk-123",
    options: {
      baseURL: " https://api.openai.com/v1 ",
    },
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.value.provider, "openai");
    assert.equal(valid.value.baseURL, "https://api.openai.com/v1");
  }
});
