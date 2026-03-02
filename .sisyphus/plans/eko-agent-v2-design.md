# Eko-Agent v2 设计草案

## 1. 架构愿景

### 1.1 核心理念

Eko-Agent v2 从"单次执行工具"进化为"可编排、可验证、可恢复的智能任务系统"。

**关键转变：**
- v1: `prompt → run → done`（一次性）
- v2: `plan → confirm → execute → verify → resume`（可编排）

### 1.2 设计原则

1. **分层解耦**: Planning层、Execution层、Verification层分离
2. **状态持久化**: 任务状态可跨会话恢复（MV3 Service Worker安全）
3. **渐进增强**: 从简单任务到复杂编排逐步升级
4. **扩展友好**: 插件化Agent、工具、验证器

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface Layer                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   Sidebar    │  │   Options    │  │  Content Script  │  │
│  │  (React UI)  │  │  (Config)    │  │  (Page Control)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Orchestration Layer                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              TaskOrchestrator (主控)                  │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │  │
│  │  │ Planner │→│ Confirm │→│ Executor│→│Verifier │ │  │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              BackgroundAgent (并行执行)               │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐              │  │
│  │  │Browser  │  │  Chat   │  │  File   │              │  │
│  │  │ Agent   │  │ Agent   │  │ Agent   │              │  │
│  │  └─────────┘  └─────────┘  └─────────┘              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    State Management Layer                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ TaskState    │  │ SessionStore │  │ EvidenceStore    │  │
│  │ (任务状态)    │  │ (会话持久化)  │  │ (验证证据)        │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 职责 | 对应文件 |
|------|------|----------|
| TaskOrchestrator | 任务生命周期管理、状态机驱动 | `runtime/orchestrator.ts` |
| Planner | 生成/修改执行计划 | `runtime/planner.ts` |
| ConfirmHandler | 人机确认交互 | `runtime/confirm.ts` |
| Executor | 执行计划中的任务节点 | `runtime/executor.ts` |
| Verifier | 验证执行结果 | `runtime/verifier.ts` |
| BackgroundAgent | 并行Agent执行 | `runtime/background.ts` |
| TaskStateManager | 任务状态持久化 | `state/task-state.ts` |
| SessionStore | 会话级状态存储 | `state/session-store.ts` |
| EvidenceStore | 验证证据存储 | `state/evidence-store.ts` |
| HookRegistry | 生命周期钩子管理 | `hooks/registry.ts` |

## 3. 核心数据模型

### 3.1 任务状态机

```typescript
// 任务状态定义
enum TaskStatus {
  PENDING = 'pending',           // 等待开始
  PLANNING = 'planning',         // 生成计划中
  PLAN_REVIEW = 'plan_review',   // 计划待确认
  EXECUTING = 'executing',       // 执行中
  VERIFYING = 'verifying',       // 验证中
  PAUSED = 'paused',             // 用户暂停
  COMPLETED = 'completed',       // 完成
  FAILED = 'failed',             // 失败
  CANCELLED = 'cancelled',       // 取消
}

// 任务定义
interface Task {
  id: string;                      // 唯一标识
  parentId?: string;               // 父任务（子任务支持）
  status: TaskStatus;
  
  // 输入
  intent: UserIntent;              // 用户意图
  
  // 计划
  plan?: ExecutionPlan;            // 执行计划
  
  // 执行
  currentStep: number;             // 当前执行步骤
  steps: ExecutionStep[];          // 执行步骤列表
  
  // 上下文
  context: TaskContext;            // 任务上下文
  
  // 元数据
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

// 用户意图
interface UserIntent {
  prompt: string;                  // 原始输入
  intentType: IntentType;          // 意图分类
  confidence: number;              // 置信度
  extractedParams?: Record<string, any>;
}

// 执行计划
interface ExecutionPlan {
  version: 'v1';
  summary: string;                 // 计划摘要
  estimatedSteps: number;          // 预估步骤数
  steps: PlanStep[];               // 计划步骤
  risks: RiskItem[];               // 风险提示
  requiresConfirmation: boolean;   // 是否需要确认
}

// 计划步骤
interface PlanStep {
  id: string;
  order: number;
  description: string;
  agentType: AgentType;            // 使用哪个Agent
  toolNames: string[];             // 可能用到的工具
  expectedOutcome: string;         // 预期结果
  canRollback: boolean;            // 是否可回滚
  verification?: VerificationRule; // 验证规则
}

// 执行步骤（运行时）
interface ExecutionStep {
  id: string;
  planStepId: string;              // 关联的计划步骤
  status: StepStatus;
  
  // 输入输出
  input: any;
  output?: any;
  error?: ErrorInfo;
  
  // 执行记录
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  
  // 验证
  verificationResult?: VerificationResult;
  
  // 证据
  evidenceIds: string[];
}

// 任务上下文
interface TaskContext {
  variables: Map<string, any>;     // 变量存储
  memory: MemoryItem[];            // 记忆项
  learnings: Learning[];           // 学习记录
  conversation: Message[];         // 对话历史
}
```

### 3.2 状态持久化

```typescript
// 任务状态存储（存储到 chrome.storage.local）
interface TaskStateSnapshot {
  taskId: string;
  status: TaskStatus;
  currentStep: number;
  steps: ExecutionStep[];
  context: TaskContext;
  timestamp: number;
}

// 会话状态（用于恢复）
interface SessionState {
  sessionId: string;
  activeTaskId?: string;
  taskHistory: string[];
  globalContext: GlobalContext;
}

// 全局上下文
interface GlobalContext {
  llmConfig: LLMConfig;
  browserState: BrowserState;
  userPreferences: UserPreferences;
}

// 验证证据
interface Evidence {
  id: string;
  taskId: string;
  stepId: string;
  type: EvidenceType;              // screenshot, dom, log, etc.
  content: any;                    // 证据内容
  timestamp: number;
  verified: boolean;               // 是否已验证
}
```

## 4. 核心模块设计

### 4.1 TaskOrchestrator（任务编排器）

```typescript
class TaskOrchestrator {
  private stateMachine: StateMachine;
  private taskStore: TaskStateManager;
  private hookRegistry: HookRegistry;
  
  constructor(deps: OrchestratorDeps) {
    this.stateMachine = new StateMachine();
    this.taskStore = deps.taskStore;
    this.hookRegistry = deps.hookRegistry;
  }
  
  // 创建新任务
  async createTask(intent: UserIntent): Promise<Task> {
    const task = await this.buildTask(intent);
    await this.taskStore.save(task);
    await this.transition(task.id, TaskStatus.PLANNING);
    return task;
  }
  
  // 状态转换
  async transition(taskId: string, toStatus: TaskStatus): Promise<void> {
    const task = await this.taskStore.get(taskId);
    const fromStatus = task.status;
    
    // 触发 before 钩子
    await this.hookRegistry.trigger('before:transition', {
      task, fromStatus, toStatus
    });
    
    // 执行状态转换
    await this.stateMachine.transition(task, toStatus);
    
    // 触发 after 钩子
    await this.hookRegistry.trigger('after:transition', {
      task, fromStatus, toStatus
    });
    
    // 保存状态
    await this.taskStore.save(task);
    
    // 自动触发下一步
    await this.onStatusChanged(task);
  }
  
  // 状态变更处理
  private async onStatusChanged(task: Task): Promise<void> {
    switch (task.status) {
      case TaskStatus.PLANNING:
        await this.startPlanning(task);
        break;
      case TaskStatus.PLAN_REVIEW:
        await this.waitForConfirmation(task);
        break;
      case TaskStatus.EXECUTING:
        await this.startExecution(task);
        break;
      case TaskStatus.VERIFYING:
        await this.startVerification(task);
        break;
      case TaskStatus.COMPLETED:
      case TaskStatus.FAILED:
        await this.finalizeTask(task);
        break;
    }
  }
  
  // 恢复任务
  async resumeTask(taskId: string): Promise<Task> {
    const task = await this.taskStore.get(taskId);
    
    if (task.status === TaskStatus.PAUSED || 
        task.status === TaskStatus.FAILED) {
      await this.transition(taskId, TaskStatus.EXECUTING);
    }
    
    return task;
  }
  
  // 取消任务
  async cancelTask(taskId: string): Promise<void> {
    await this.transition(taskId, TaskStatus.CANCELLED);
  }
}
```

### 4.2 Planner（计划生成器）

```typescript
interface Planner {
  // 生成计划
  generatePlan(intent: UserIntent, context: TaskContext): Promise<ExecutionPlan>;
  
  // 修改计划
  modifyPlan(plan: ExecutionPlan, feedback: string): Promise<ExecutionPlan>;
  
  // 评估风险
  assessRisks(plan: ExecutionPlan): RiskItem[];
}

class EkoPlanner implements Planner {
  private eko: Eko;
  
  async generatePlan(intent: UserIntent, context: TaskContext): Promise<ExecutionPlan> {
    // 使用 Eko.generate 生成工作流
    const workflow = await this.eko.generate(intent.prompt);
    
    // 转换为 ExecutionPlan
    return this.workflowToPlan(workflow);
  }
  
  async modifyPlan(plan: ExecutionPlan, feedback: string): Promise<ExecutionPlan> {
    // 基于反馈修改计划
    return this.eko.modify(plan, feedback);
  }
  
  private workflowToPlan(workflow: Workflow): ExecutionPlan {
    // 转换逻辑
    return {
      version: 'v1',
      summary: workflow.description,
      estimatedSteps: workflow.tasks.length,
      steps: workflow.tasks.map((t, i) => ({
        id: t.id,
        order: i,
        description: t.description,
        agentType: this.inferAgentType(t),
        toolNames: t.tools || [],
        expectedOutcome: t.expectedOutcome,
        canRollback: t.canRollback ?? true,
        verification: t.verification
      })),
      risks: this.assessRisksFromWorkflow(workflow),
      requiresConfirmation: workflow.tasks.length > 3
    };
  }
}
```

### 4.3 Executor（执行器）

```typescript
interface Executor {
  // 执行单个步骤
  executeStep(step: ExecutionStep, context: TaskContext): Promise<ExecutionResult>;
  
  // 批量执行
  executeBatch(steps: ExecutionStep[], context: TaskContext): Promise<ExecutionResult[]>;
  
  // 回滚
  rollback(step: ExecutionStep): Promise<void>;
}

class StepExecutor implements Executor {
  private agentRegistry: AgentRegistry;
  private hookRegistry: HookRegistry;
  
  async executeStep(step: ExecutionStep, context: TaskContext): Promise<ExecutionResult> {
    // 触发 before 钩子
    await this.hookRegistry.trigger('before:execute', { step, context });
    
    try {
      // 获取Agent
      const agent = this.agentRegistry.get(step.agentType);
      
      // 执行
      const result = await agent.run({
        input: step.input,
        context: context,
        tools: step.toolNames
      });
      
      // 更新步骤状态
      step.output = result;
      step.status = StepStatus.COMPLETED;
      step.completedAt = Date.now();
      
      // 触发 after 钩子
      await this.hookRegistry.trigger('after:execute', { step, result });
      
      return { success: true, data: result };
      
    } catch (error) {
      step.error = this.normalizeError(error);
      step.status = StepStatus.FAILED;
      
      await this.hookRegistry.trigger('on:error', { step, error });
      
      return { success: false, error: step.error };
    }
  }
  
  async rollback(step: ExecutionStep): Promise<void> {
    // 回滚逻辑
  }
}
```

### 4.4 Verifier（验证器）

```typescript
interface Verifier {
  // 验证步骤结果
  verifyStep(step: ExecutionStep, rule: VerificationRule): Promise<VerificationResult>;
  
  // 验证整个任务
  verifyTask(task: Task): Promise<TaskVerificationResult>;
}

class MultiStageVerifier implements Verifier {
  private evidenceCollector: EvidenceCollector;
  
  async verifyStep(step: ExecutionStep, rule: VerificationRule): Promise<VerificationResult> {
    const results: VerificationCheck[] = [];
    
    // 1. 自我验证（Agent自评）
    if (rule.selfCheck) {
      results.push(await this.selfCheck(step));
    }
    
    // 2. 证据收集
    if (rule.requiresEvidence) {
      const evidence = await this.evidenceCollector.collect(step);
      step.evidenceIds.push(evidence.id);
      results.push(await this.verifyEvidence(evidence, rule));
    }
    
    // 3. 断言验证
    if (rule.assertions) {
      for (const assertion of rule.assertions) {
        results.push(await this.checkAssertion(step, assertion));
      }
    }
    
    // 综合判定
    const passed = results.every(r => r.passed);
    
    return {
      passed,
      checks: results,
      evidenceIds: step.evidenceIds,
      timestamp: Date.now()
    };
  }
  
  async verifyTask(task: Task): Promise<TaskVerificationResult> {
    // 验证所有步骤
    const stepResults = await Promise.all(
      task.steps.map(s => this.verifyStep(s, s.verification))
    );
    
    return {
      passed: stepResults.every(r => r.passed),
      stepResults,
      summary: this.generateSummary(stepResults)
    };
  }
}
```

## 5. Hook 系统设计

### 5.1 Hook 类型

```typescript
// Hook 类型定义
enum HookType {
  // 任务生命周期
  BEFORE_TASK_CREATE = 'before:task:create',
  AFTER_TASK_CREATE = 'after:task:create',
  BEFORE_TRANSITION = 'before:transition',
  AFTER_TRANSITION = 'after:transition',
  BEFORE_EXECUTE = 'before:execute',
  AFTER_EXECUTE = 'after:execute',
  ON_ERROR = 'on:error',
  ON_COMPLETE = 'on:complete',
  
  // 会话生命周期
  SESSION_START = 'session:start',
  SESSION_END = 'session:end',
  SESSION_RESUME = 'session:resume',
  
  // 工具执行
  TOOL_BEFORE = 'tool:before',
  TOOL_AFTER = 'tool:after',
  
  // 验证
  BEFORE_VERIFY = 'before:verify',
  AFTER_VERIFY = 'after:verify',
}

// Hook 处理器
interface HookHandler<T = any> {
  name: string;
  type: HookType;
  priority: number;              // 执行优先级
  async handler(context: HookContext<T>): Promise<void>;
}

// Hook 上下文
interface HookContext<T> {
  data: T;
  task?: Task;
  step?: ExecutionStep;
  cancel?: () => void;           // 取消操作
  skip?: () => void;             // 跳过
}
```

### 5.2 内置 Hooks

```typescript
// 1. 会话恢复 Hook
class SessionRecoveryHook implements HookHandler {
  name = 'session-recovery';
  type = HookType.SESSION_RESUME;
  priority = 100;
  
  async handler(ctx: HookContext<SessionState>): Promise<void> {
    const { sessionId, activeTaskId } = ctx.data;
    
    if (activeTaskId) {
      // 恢复任务上下文
      await orchestrator.resumeTask(activeTaskId);
    }
  }
}

// 2. Todo 强制完成 Hook（类似 oh-my-opencode 的 todo-continuation-enforcer）
class TodoEnforcerHook implements HookHandler {
  name = 'todo-enforcer';
  type = HookType.AFTER_EXECUTE;
  priority = 50;
  
  async handler(ctx: HookContext<ExecutionResult>): Promise<void> {
    const task = ctx.task!;
    
    // 检查是否有未完成的子任务
    if (hasIncompleteTodos(task)) {
      // 强制继续执行
      await orchestrator.continueExecution(task.id);
    }
  }
}

// 3. 状态持久化 Hook
class StatePersistenceHook implements HookHandler {
  name = 'state-persistence';
  type = HookType.AFTER_TRANSITION;
  priority = 10;
  
  async handler(ctx: HookContext<{ from: TaskStatus; to: TaskStatus }>): Promise<void> {
    const task = ctx.task!;
    
    // 保存到 chrome.storage.local
    await chrome.storage.local.set({
      [`task:${task.id}`]: serializeTask(task)
    });
  }
}

// 4. 证据收集 Hook
class EvidenceCollectionHook implements HookHandler {
  name = 'evidence-collector';
  type = HookType.AFTER_EXECUTE;
  priority = 30;
  
  async handler(ctx: HookContext<ExecutionResult>): Promise<void> {
    const step = ctx.step!;
    
    // 自动收集证据
    if (step.agentType === AgentType.BROWSER) {
      const screenshot = await captureScreenshot();
      const evidence = await evidenceStore.save({
        type: 'screenshot',
        content: screenshot,
        taskId: ctx.task!.id,
        stepId: step.id
      });
      step.evidenceIds.push(evidence.id);
    }
  }
}
```

## 6. 状态管理与持久化

### 6.1 存储架构

```
chrome.storage.local
├── tasks/                    # 任务状态
│   ├── {taskId}.json        # 单个任务状态
│   └── index.json           # 任务索引
├── sessions/                 # 会话状态
│   └── {sessionId}.json     # 会话状态
├── evidence/                 # 验证证据
│   └── {evidenceId}.json    # 单个证据
├── context/                  # 上下文数据
│   ├── global.json          # 全局上下文
│   └── {taskId}/            # 任务级上下文
└── checkpoint/              # 检查点（用于恢复）
    └── {taskId}/
        └── {timestamp}.json
```

### 6.2 状态同步策略

```typescript
class MV3StateManager {
  // 内存缓存（Service Worker 存活期间）
  private memoryCache: Map<string, any> = new Map();
  
  // 写入（带防抖）
  async set(key: string, value: any): Promise<void> {
    this.memoryCache.set(key, value);
    await this.debouncedPersist(key, value);
  }
  
  // 读取（先内存，后存储）
  async get(key: string): Promise<any> {
    // 先查内存
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key);
    }
    
    // 再查持久化存储
    const result = await chrome.storage.local.get(key);
    const value = result[key];
    
    // 回填内存缓存
    if (value) {
      this.memoryCache.set(key, value);
    }
    
    return value;
  }
  
  // 检查点（用于恢复）
  async createCheckpoint(taskId: string): Promise<void> {
    const task = await this.get(`tasks/${taskId}`);
    const checkpoint = {
      task,
      timestamp: Date.now(),
      version: 'v2'
    };
    
    await chrome.storage.local.set({
      [`checkpoint/${taskId}/${Date.now()}`]: checkpoint
    });
  }
  
  // 从检查点恢复
  async restoreFromCheckpoint(taskId: string, timestamp?: number): Promise<Task | null> {
    const checkpoints = await chrome.storage.local.get(`checkpoint/${taskId}`);
    
    if (!checkpoints || Object.keys(checkpoints).length === 0) {
      return null;
    }
    
    // 找到最新的或指定时间的检查点
    const targetKey = timestamp 
      ? `checkpoint/${taskId}/${timestamp}`
      : this.findLatestCheckpoint(Object.keys(checkpoints));
    
    const checkpoint = checkpoints[targetKey];
    return checkpoint?.task || null;
  }
}
```

## 7. UI 设计

### 7.1 Sidebar 增强

```typescript
// Sidebar 状态管理
interface SidebarState {
  // 当前视图
  view: 'dashboard' | 'task-detail' | 'plan-review' | 'verification';
  
  // 任务列表
  tasks: TaskSummary[];
  activeTaskId?: string;
  
  // 执行状态
  isExecuting: boolean;
  currentStep?: ExecutionStep;
  progress: {
    current: number;
    total: number;
  };
  
  // 日志
  logs: LogEntry[];
  
  // 人机交互
  pendingConfirmation?: ConfirmationRequest;
}

// 组件结构
 Sidebar/
├── components/
│   ├── TaskDashboard.tsx       # 任务总览
│   ├── TaskDetail.tsx          # 任务详情
│   ├── PlanReview.tsx          # 计划确认
│   ├── ExecutionPanel.tsx      # 执行面板
│   ├── VerificationPanel.tsx   # 验证面板
│   ├── LogViewer.tsx           # 日志查看
│   └── HumanConfirmDialog.tsx  # 人机确认对话框
├── hooks/
│   ├── useTaskState.ts         # 任务状态 Hook
│   ├── useOrchestrator.ts      # 编排器 Hook
│   └── useEvidence.ts          # 证据 Hook
└── state/
    └── sidebar-store.ts        # Sidebar 状态管理
```

### 7.2 人机交互流程

```
用户输入 → Intent Analysis → Plan Generation → Plan Review UI
                                              ↓
                                    [用户确认/修改计划]
                                              ↓
                Execution ←── Step Execution ←─┘
                     ↓
              Verification ←── Evidence Collection
                     ↓
            [通过] / [失败重试] / [人工介入]
                     ↓
              Task Complete
```

## 8. 90天演进路线

### Phase 1: 基础架构（Day 0-30）

**目标**：建立任务状态机 + 基础 UI

**任务清单**：
- [ ] 实现 TaskState 定义和状态机
- [ ] 实现 MV3StateManager（MV3 安全的状态管理）
- [ ] 重构 Sidebar，添加任务列表视图
- [ ] 集成现有 Eko 执行逻辑到 Executor
- [ ] 添加基础 Hook 系统

**验证标准**：
- 任务状态可持久化到 chrome.storage
- 刷新页面后任务状态可恢复
- Sidebar 可显示任务列表和进度

### Phase 2: 计划与确认（Day 31-60）

**目标**：实现 Plan → Confirm → Execute 主流程

**任务清单**：
- [ ] 实现 EkoPlanner，集成 Eko.generate()
- [ ] 实现 PlanReview UI
- [ ] 实现人机确认流程（ConfirmHandler）
- [ ] 实现 StepExecutor，支持步骤级执行
- [ ] 添加基础验证（AssertionVerifier）

**验证标准**：
- 用户输入后可生成执行计划
- 用户可查看和确认计划
- 计划执行时可显示进度
- 单步骤失败可重试

### Phase 3: 验证与恢复（Day 61-90）

**目标**：实现完整验证体系 + 任务恢复能力

**任务清单**：
- [ ] 实现证据收集系统（截图、DOM、日志）
- [ ] 实现 MultiStageVerifier
- [ ] 实现检查点（Checkpoint）机制
- [ ] 实现任务恢复（Resume）流程
- [ ] 添加高级 Hooks（TodoEnforcer、EvidenceCollection）
- [ ] 性能优化和边界 case 处理

**验证标准**：
- 每个步骤执行后自动收集证据
- 验证失败时显示具体原因和证据
- 页面刷新后可从检查点恢复
- 支持暂停/恢复任务

## 9. 接口定义

### 9.1 公开 API

```typescript
// EkoAgent 主入口
interface EkoAgent {
  // 任务管理
  createTask(prompt: string, options?: TaskOptions): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(): Promise<TaskSummary[]>;
  cancelTask(taskId: string): Promise<void>;
  
  // 执行控制
  startExecution(taskId: string): Promise<void>;
  pauseExecution(taskId: string): Promise<void>;
  resumeExecution(taskId: string): Promise<void>;
  
  // 计划交互
  confirmPlan(taskId: string, approved: boolean, modifications?: string): Promise<void>;
  modifyPlan(taskId: string, feedback: string): Promise<ExecutionPlan>;
  
  // 事件订阅
  on(event: TaskEvent, handler: EventHandler): void;
  off(event: TaskEvent, handler: EventHandler): void;
}

// 初始化
interface EkoAgentConfig {
  llmConfig: LLMConfig;
  storage?: StorageAdapter;
  hooks?: HookHandler[];
  agents?: AgentRegistry;
  verifiers?: Verifier[];
}

function createEkoAgent(config: EkoAgentConfig): EkoAgent;
```

### 9.2 消息协议（Extension 内部通信）

```typescript
// Background → Sidebar
interface OrchestratorMessage {
  type: 'task:created' | 'task:updated' | 'task:completed' | 
        'step:started' | 'step:completed' | 'step:failed' |
        'plan:review' | 'verify:required' |
        'log' | 'error';
  payload: any;
  timestamp: number;
}

// Sidebar → Background
interface UserActionMessage {
  type: 'task:start' | 'task:pause' | 'task:cancel' |
        'plan:confirm' | 'plan:modify' |
        'verify:approve' | 'verify:reject';
  taskId: string;
  payload?: any;
}
```

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| MV3 Service Worker 超时 | 高 | 使用 Offscreen API 或长连接保持活跃；频繁检查点 |
| 状态存储大小限制 | 中 | 压缩状态；定期归档完成的任务；限制证据保留时间 |
| LLM API 延迟/失败 | 中 | 实现重试机制；支持计划缓存；降级到本地执行 |
| 复杂计划的可解释性 | 中 | 提供计划可视化；支持分步确认；显示风险评估 |
| 用户打断时的状态一致性 | 高 | 每个状态变更后立即持久化；支持幂等恢复 |

## 11. 附录

### 11.1 术语表

| 术语 | 定义 |
|------|------|
| Task | 用户请求的一次完整执行单元 |
| Plan | 任务的执行计划，包含多个步骤 |
| Step | 计划中的单个执行步骤 |
| Agent | 执行具体任务的智能体 |
| Hook | 生命周期钩子，用于扩展功能 |
| Evidence | 执行验证的证据（截图、日志等）|
| Checkpoint | 任务检查点，用于恢复 |
| Boulder | 类比 Sisyphus 的巨石，指需要持续推动的任务 |

### 11.2 参考实现

- **oh-my-opencode**: `src/hooks/todo-continuation-enforcer/` - 任务强制完成机制
- **oh-my-opencode**: `src/features/boulder-state/` - 状态持久化
- **oh-my-opencode**: `src/hooks/atlas/` - 任务编排
- **tmp/eko**: `packages/eko-core/src/agent/` - Agent 基础实现

---

**文档版本**: v0.1  
**创建日期**: 2026-03-02  
**作者**: Eko-Agent Design Team  
**状态**: 草案阶段
