import { startEkoExecution } from "./main";
import { TaskManager } from "./runtime/task-manager";
import { isTerminalTask, TaskRecord } from "./runtime/task-state-machine";

const taskManager = new TaskManager(handleTaskUpdate);
let currentTaskId: string | null = null;

chrome.storage.local.set({ running: false });

// Listen to messages from the browser extension
chrome.runtime.onMessage.addListener(async function (
  request,
  sender,
  sendResponse
) {
  if (request.type == "run") {
    const prompt = (request.prompt || "").trim();
    if (!prompt) {
      chrome.runtime.sendMessage({
        type: "log",
        log: "Prompt cannot be empty.",
        level: "error",
      });
      return;
    }

    try {
      // Click the RUN button to execute the main function (workflow)
      chrome.runtime.sendMessage({ type: "log", log: "Run..." });
      const task = await taskManager.startTask(prompt, () =>
        startEkoExecution(prompt)
      );
      currentTaskId = task.id;
      chrome.storage.local.set({
        running: true,
        prompt,
        currentTask: task,
      });
      void taskManager.waitForTask(task.id);
    } catch (e) {
      const errorMessage = normalizeError(e);
      console.error(e);
      chrome.runtime.sendMessage({
        type: "log",
        log: errorMessage,
        level: "error",
      });
      chrome.storage.local.set({ running: false });
      chrome.runtime.sendMessage({ type: "stop" });
    }
  } else if (request.type == "stop") {
    if (currentTaskId) {
      const pausedTask = taskManager.stopTask(currentTaskId, "Stopped by user");
      if (pausedTask) {
        chrome.storage.local.set({ currentTask: pausedTask, running: false });
      }
    }
    chrome.runtime.sendMessage({ type: "log", log: "Stop" });
    chrome.runtime.sendMessage({ type: "stop" });
    chrome.storage.local.set({ running: false });
  }
});

(chrome as any).sidePanel && (chrome as any).sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

function handleTaskUpdate(task: TaskRecord) {
  chrome.runtime.sendMessage({ type: "task_update", task });
  chrome.storage.local.set({ currentTask: task });

  if (isTerminalTask(task) || task.state === "paused") {
    if (currentTaskId === task.id) {
      currentTaskId = null;
    }
    chrome.storage.local.set({ running: false });
    chrome.runtime.sendMessage({ type: "stop" });
  } else if (task.state === "running") {
    chrome.storage.local.set({ running: true });
  }
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
