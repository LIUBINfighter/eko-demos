import { Eko, LLMs, StreamCallbackMessage } from "@eko-ai/eko";
import { StreamCallback, HumanCallback } from "@eko-ai/eko/types";
import { BrowserAgent } from "@eko-ai/eko-extension";
import {
  ExecutionHandle,
  ExecutionOutcome,
  ExecutionRuntimeHooks,
} from "./runtime/task-manager";
import {
  normalizeStoredLLMConfig,
  resolveActiveTabId,
} from "./runtime/llm-config";

export async function getLLMConfig(name: string = "llmConfig"): Promise<unknown> {
  let result = await chrome.storage.sync.get([name]);
  return result[name];
}

export async function startEkoExecution(
  prompt: string,
  hooks?: ExecutionRuntimeHooks
): Promise<ExecutionHandle> {
  const runtimeHooks = createRuntimeHooks(hooks);
  runtimeHooks.onPhase("intake", "Loading LLM config");

  let config = await getLLMConfig();
  const normalizedConfig = normalizeStoredLLMConfig(config);
  if (normalizedConfig.ok === false) {
    const errorMessage = normalizedConfig.error;
    printLog(errorMessage, "error");
    runtimeHooks.onEvent("config_error", errorMessage);
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

  let activeToolStep: string | null = null;
  let planningStepOpen = false;

  let callback: StreamCallback & HumanCallback = {
    onMessage: async (message: StreamCallbackMessage) => {
      if (message.type === "workflow") {
        runtimeHooks.onPhase("planning", "Planner is generating workflow");
        if (!planningStepOpen) {
          planningStepOpen = true;
          runtimeHooks.onStepStart("Plan", "Generate workflow");
        }
        if (message.streamDone && planningStepOpen) {
          runtimeHooks.onStepEnd("Plan", "Workflow generated");
          planningStepOpen = false;
        }
        printLog("Plan\n" + message.workflow.xml, "info", !message.streamDone);
        runtimeHooks.onEvent("workflow", "Workflow updated", {
          streamDone: !!message.streamDone,
        });
      } else if (message.type === "text") {
        printLog(message.text, "info", !message.streamDone);
        runtimeHooks.onEvent("agent_text", message.text, {
          streamDone: !!message.streamDone,
        });
      } else if (message.type === "tool_streaming") {
        const toolStep = `${message.agentName} > ${message.toolName}`;
        runtimeHooks.onPhase("executing", `Running ${toolStep}`);
        if (activeToolStep !== toolStep) {
          if (activeToolStep) {
            runtimeHooks.onStepEnd(activeToolStep, "Switching to next tool");
          }
          runtimeHooks.onStepStart(toolStep, message.paramsText);
          activeToolStep = toolStep;
        }
        printLog(`${message.agentName} > ${message.toolName}\n${message.paramsText}`, "info", true);
      } else if (message.type === "tool_use") {
        const toolStep = `${message.agentName} > ${message.toolName}`;
        runtimeHooks.onPhase("executing", `Executed ${toolStep}`);
        if (activeToolStep !== toolStep) {
          runtimeHooks.onStepStart(toolStep, "Tool call received");
        }
        runtimeHooks.onStepEnd(
          toolStep,
          JSON.stringify(message.params || {}, null, 0)
        );
        activeToolStep = null;
        printLog(
          `${message.agentName} > ${message.toolName}\n${JSON.stringify(
            message.params
          )}`
        );
      }
      console.log("message: ", JSON.stringify(message, null, 2));
    },
    onHumanConfirm: async (context, prompt) => {
      runtimeHooks.onPhase("executing", "Waiting human confirmation");
      runtimeHooks.onEvent("human_confirm", prompt);
      return doConfirm(prompt);
    },
  };

  let agents = [new BrowserAgent()];
  let eko = new Eko({ llms, agents, callback });
  runtimeHooks.onPhase("executing", "Browser agent execution started");

  const completion = eko
    .run(prompt)
    .then((res): ExecutionOutcome => {
      closeOpenSteps(runtimeHooks, {
        activeToolStep,
        planningStepOpen,
      });
      runtimeHooks.onPhase("verifying", "Execution finished, waiting verifier");
      printLog(res.result, res.success ? "success" : "error");
      if (res.success) {
        return { success: true, result: res.result };
      }
      return { success: false, error: res.result };
    })
    .catch((error): ExecutionOutcome => {
      closeOpenSteps(runtimeHooks, {
        activeToolStep,
        planningStepOpen,
      });
      const errorMessage = normalizeError(error);
      printLog(errorMessage, "error");
      runtimeHooks.onEvent("execution_error", errorMessage);
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

function createRuntimeHooks(
  hooks?: ExecutionRuntimeHooks
): ExecutionRuntimeHooks {
  return {
    onPhase: hooks?.onPhase || (() => {}),
    onStepStart: hooks?.onStepStart || (() => {}),
    onStepEnd: hooks?.onStepEnd || (() => {}),
    onEvent: hooks?.onEvent || (() => {}),
  };
}

function closeOpenSteps(
  hooks: ExecutionRuntimeHooks,
  status: { activeToolStep: string | null; planningStepOpen: boolean }
) {
  if (status.activeToolStep) {
    hooks.onStepEnd(status.activeToolStep, "Execution finished");
  }
  if (status.planningStepOpen) {
    hooks.onStepEnd("Plan", "Planning finished");
  }
}
