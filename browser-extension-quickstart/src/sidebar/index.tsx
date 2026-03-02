import { createRoot } from "react-dom/client";
import React, { useState, useRef, useEffect } from "react";
import { Button, Input } from "antd";

interface LogMessage {
  time: string;
  log: string;
  level?: "info" | "error" | "success";
}

interface TaskSnapshot {
  id: string;
  state:
    | "created"
    | "running"
    | "blocked"
    | "paused"
    | "succeeded"
    | "failed";
  phase:
    | "intake"
    | "planning"
    | "executing"
    | "verifying"
    | "recovery";
  attempt: number;
  updatedAt: string;
  activeStep?: string;
  activeStepStartedAt?: string;
  lastCompletedStep?: string;
  lastCompletedStepDurationMs?: number;
  error?: string;
  result?: string;
}

interface TaskEventSnapshot {
  id: string;
  taskId: string;
  type: string;
  at: string;
  detail?: string;
  durationMs?: number;
  data?: Record<string, unknown>;
}

const AppRun = () => {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [streamLog, setStreamLog] = useState<LogMessage | null>();
  const [task, setTask] = useState<TaskSnapshot | null>(null);
  const [taskEvents, setTaskEvents] = useState<TaskEventSnapshot[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState(
    'Open Twitter, search for "Fellou AI" and follow'
  );

  useEffect(() => {
    chrome.storage.local.get(
      ["running", "prompt", "currentTask", "currentTaskEvents"],
      (result) => {
        if (result.running !== undefined) {
          setRunning(result.running);
        }
        if (result.prompt !== undefined) {
          setPrompt(result.prompt);
        }
        if (result.currentTask) {
          setTask(result.currentTask as TaskSnapshot);
        }
        if (result.currentTaskEvents) {
          setTaskEvents(result.currentTaskEvents as TaskEventSnapshot[]);
        }
      }
    );
    const messageListener = (message: any) => {
      if (!message) {
        return;
      }
      if (message.type === "stop") {
        setRunning(false);
        chrome.storage.local.set({ running: false });
      } else if (message.type === "log") {
        const time = new Date().toLocaleTimeString();
        const log_message = {
          time,
          log: message.log,
          level: message.level || "info",
        };
        if (message.stream) {
          setStreamLog(log_message);
        } else {
          setStreamLog(null);
          setLogs((prev) => [...prev, log_message]);
        }
      } else if (message.type === "task_update" && message.task) {
        setTask(message.task as TaskSnapshot);
      } else if (message.type === "task_event" && message.event) {
        setTaskEvents((prev) =>
          [...prev, message.event as TaskEventSnapshot].slice(-200)
        );
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({
      behavior: "smooth",
      top: document.body.scrollHeight,
    });
  }, [logs, streamLog, taskEvents]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const handleClick = () => {
    if (running) {
      setRunning(false);
      chrome.storage.local.set({ running: false, prompt });
      chrome.runtime.sendMessage({ type: "stop" });
      return;
    }
    if (!prompt.trim()) {
      return;
    }
    setLogs([]);
    setTaskEvents([]);
    setRunning(true);
    chrome.storage.local.set({ running: true, prompt });
    chrome.runtime.sendMessage({ type: "run", prompt: prompt.trim() });
  };

  const getLogStyle = (level: string) => {
    switch (level) {
      case "error":
        return { color: "#ff4d4f" };
      case "success":
        return { color: "#52c41a" };
      default:
        return { color: "#1890ff" };
    }
  };

  const getTaskStateStyle = (state: TaskSnapshot["state"]) => {
    if (state === "succeeded") {
      return { color: "#52c41a", fontWeight: 600 };
    }
    if (state === "failed") {
      return { color: "#ff4d4f", fontWeight: 600 };
    }
    if (state === "blocked" || state === "paused") {
      return { color: "#faad14", fontWeight: 600 };
    }
    return { color: "#1677ff", fontWeight: 600 };
  };

  const activeStepElapsedMs =
    task?.activeStepStartedAt
      ? Math.max(0, nowMs - new Date(task.activeStepStartedAt).getTime())
      : 0;

  return (
    <div
      style={{
        minHeight: "80px",
      }}
    >
      <div>Prompt:</div>
      <div
        style={{
          textAlign: "center",
          marginTop: "4px",
        }}
      >
        {task && (
          <div
            style={{
              marginBottom: "8px",
              border: "1px solid #d9d9d9",
              borderRadius: "4px",
              padding: "8px",
              backgroundColor: "#fafafa",
              textAlign: "left",
              fontSize: "12px",
            }}
          >
            <div>
              <strong>Task:</strong> {task.id}
            </div>
            <div>
              <strong>Status:</strong>{" "}
              <span style={getTaskStateStyle(task.state)}>{task.state}</span>
            </div>
            <div>
              <strong>Phase:</strong> {task.phase}
            </div>
            <div>
              <strong>Attempt:</strong> {task.attempt}
            </div>
            {task.activeStep && (
              <div>
                <strong>Active Step:</strong> {task.activeStep} (
                {formatDuration(activeStepElapsedMs)})
              </div>
            )}
            {task.lastCompletedStep && (
              <div>
                <strong>Last Step:</strong> {task.lastCompletedStep} (
                {formatDuration(task.lastCompletedStepDurationMs || 0)})
              </div>
            )}
            {task.error && (
              <div>
                <strong>Reason:</strong> {task.error}
              </div>
            )}
            {task.result && (
              <div>
                <strong>Result:</strong> {task.result}
              </div>
            )}
          </div>
        )}
        {taskEvents.length > 0 && (
          <div
            style={{
              marginBottom: "8px",
              border: "1px solid #d9d9d9",
              borderRadius: "4px",
              padding: "8px",
              backgroundColor: "#f7f7f7",
              textAlign: "left",
              fontSize: "12px",
              maxHeight: "220px",
              overflowY: "auto",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: "6px" }}>
              Timeline (Verbose)
            </div>
            {[...taskEvents].reverse().map((event) => (
              <pre
                key={event.id}
                style={{
                  margin: "3px 0",
                  fontSize: "11px",
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  color: "#333",
                }}
              >
                [{new Date(event.at).toLocaleTimeString()}] {event.type}
                {event.detail ? ` | ${event.detail}` : ""}
                {typeof event.durationMs === "number"
                  ? ` | ${formatDuration(event.durationMs)}`
                  : ""}
              </pre>
            ))}
          </div>
        )}
        <Input.TextArea
          ref={textAreaRef}
          rows={4}
          value={prompt}
          disabled={running}
          placeholder="Your workflow"
          onChange={(e) => setPrompt(e.target.value)}
        />
        <Button
          type="primary"
          onClick={handleClick}
          style={{
            marginTop: "8px",
            background: running ? "#6666" : "#1677ff",
          }}
        >
          {running ? "Running..." : "Run"}
        </Button>
      </div>
      {logs.length > 0 && (
        <div
          style={{
            marginTop: "16px",
            textAlign: "left",
            border: "1px solid #d9d9d9",
            borderRadius: "4px",
            padding: "8px",
            overflowY: "auto",
            backgroundColor: "#f5f5f5",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "8px" }}>Logs:</div>
          {logs.map((log, index) => (
            <pre
              key={index}
              style={{
                margin: "4px 0",
                fontSize: "12px",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                ...getLogStyle(log.level || "info"),
              }}
            >
              <span style={{ color: "#6666" }}>[{log.time}]&nbsp;</span>
              <span>{log.log}</span>
            </pre>
          ))}
          {streamLog && (
            <pre
              style={{
                margin: "4px 0",
                fontSize: "12px",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                ...getLogStyle(streamLog.level || "info"),
              }}
            >
              <span style={{ color: "#6666" }}>[{streamLog.time}]&nbsp;</span>
              <span>{streamLog.log}</span>
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <AppRun />
  </React.StrictMode>
);

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec.toFixed(1)}s`;
  }
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem.toFixed(0)}s`;
}
