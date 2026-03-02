import { Eko, LLMs, StreamCallbackMessage } from "@eko-ai/eko";
import { StreamCallback, HumanCallback } from "@eko-ai/eko/types";
import { BrowserAgent } from "@eko-ai/eko-extension";
import { ExecutionHandle, ExecutionOutcome } from "./runtime/task-manager";
import {
  normalizeStoredLLMConfig,
  resolveActiveTabId,
} from "./runtime/llm-config";

export async function getLLMConfig(name: string = "llmConfig"): Promise<unknown> {
  let result = await chrome.storage.sync.get([name]);
  return result[name];
}

export async function startEkoExecution(prompt: string): Promise<ExecutionHandle> {
  let config = await getLLMConfig();
  const normalizedConfig = normalizeStoredLLMConfig(config);
  if (normalizedConfig.ok === false) {
    const errorMessage = normalizedConfig.error;
    printLog(errorMessage, "error");
    chrome.runtime.openOptionsPage();
    throw new Error(errorMessage);
  }

  const llmConfig = normalizedConfig.value;

  const defaultModelConfig: LLMs["default"] = {
    provider: llmConfig.provider,
    model: llmConfig.modelName,
    apiKey: llmConfig.apiKey,
  };
  if (llmConfig.baseURL) {
    defaultModelConfig.config = { baseURL: llmConfig.baseURL };
  }

  const llms: LLMs = {
    default: defaultModelConfig,
  };

  let callback: StreamCallback & HumanCallback = {
    onMessage: async (message: StreamCallbackMessage) => {
      if (message.type === "workflow") {
        printLog("Plan\n" + message.workflow.xml, "info", !message.streamDone);
      } else if (message.type === "text") {
        printLog(message.text, "info", !message.streamDone);
      } else if (message.type === "tool_streaming") {
        printLog(`${message.agentName} > ${message.toolName}\n${message.paramsText}`, "info", true);
      } else if (message.type === "tool_use") {
        printLog(
          `${message.agentName} > ${message.toolName}\n${JSON.stringify(
            message.params
          )}`
        );
      }
      console.log("message: ", JSON.stringify(message, null, 2));
    },
    onHumanConfirm: async (context, prompt) => {
      return doConfirm(prompt);
    },
  };

  let agents = [new BrowserAgent()];
  let eko = new Eko({ llms, agents, callback });

  const completion = eko
    .run(prompt)
    .then((res): ExecutionOutcome => {
      printLog(res.result, res.success ? "success" : "error");
      if (res.success) {
        return { success: true, result: res.result };
      }
      return { success: false, error: res.result };
    })
    .catch((error): ExecutionOutcome => {
      const errorMessage = normalizeError(error);
      printLog(errorMessage, "error");
      return { success: false, error: errorMessage };
    });

  return {
    completion,
    abort: () => abortExecution(eko),
  };
}

async function doConfirm(prompt: string) {
  let tabs = await chrome.tabs.query({
    active: true,
    windowType: "normal",
  });

  const tabId = resolveActiveTabId(tabs);
  if (tabId === null) {
    printLog("Unable to show confirmation dialog: no active tab.", "error");
    return false;
  }

  try {
    let frameResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: (confirmPrompt) => {
        return window.confirm(confirmPrompt);
      },
      args: [prompt],
    });

    if (!frameResults.length) {
      printLog("Confirmation dialog did not return a result.", "error");
      return false;
    }

    return Boolean(frameResults[0].result);
  } catch (error) {
    printLog(
      `Unable to show confirmation dialog: ${normalizeError(error)}`,
      "error"
    );
    return false;
  }
}

function printLog(
  message: string,
  level?: "info" | "success" | "error",
  stream?: boolean
) {
  chrome.runtime.sendMessage({
    type: "log",
    log: message + "",
    level: level || "info",
    stream,
  });
}

function abortExecution(eko: Eko) {
  eko.getAllTaskId().forEach((taskId) => {
    eko.abortTask(taskId);
    printLog("Abort taskId: " + taskId);
  });
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
