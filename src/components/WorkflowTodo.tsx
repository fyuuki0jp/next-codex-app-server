"use client";

// Legacy plan step from turn/plan/updated
interface PlanStep {
  step: string;
  status: "pending" | "inProgress" | "completed";
}

// Structured workflow output from outputSchema
export interface StructuredWorkflow {
  title: string;
  description?: string;
  tasks: StructuredTask[];
}

export interface StructuredTask {
  id: string;
  executor: "AI" | "HUMAN";
  description: string;
  output?: string[];
  depends?: string[];
  status?: "pending" | "inProgress" | "completed";
}

// Internal parsed step for display
interface ParsedStep {
  id?: string;
  executor: "AI" | "HUMAN" | "UNKNOWN";
  description: string;
  output?: string[];
  depends?: string[];
  status: "pending" | "inProgress" | "completed";
}

// Props for legacy plan format
interface WorkflowTodoProps {
  explanation: string | null;
  plan: PlanStep[];
}

// Props for structured workflow format
interface StructuredWorkflowProps {
  workflow: StructuredWorkflow;
}

function parseStep(step: string): Omit<ParsedStep, "status"> {
  // Try to parse as JSON first (structured output)
  try {
    const parsed = JSON.parse(step) as StructuredTask;
    if (parsed.executor && parsed.description) {
      return {
        id: parsed.id,
        executor: parsed.executor.toUpperCase() as "AI" | "HUMAN",
        description: parsed.description,
        output: parsed.output,
        depends: parsed.depends,
      };
    }
  } catch {
    // Not JSON, fall through to legacy parsing
  }

  // Legacy format: [EXECUTOR] Description | output: xxx | depends: yyy
  const executorMatch = step.match(/^\[(AI|HUMAN)\]\s*/i);
  const executor = executorMatch
    ? (executorMatch[1].toUpperCase() as "AI" | "HUMAN")
    : "UNKNOWN";

  let description = executorMatch ? step.slice(executorMatch[0].length) : step;

  // Parse output
  const outputMatch = description.match(/\|\s*output:\s*([^|]+)/i);
  const output = outputMatch
    ? outputMatch[1].split(",").map((s) => s.trim())
    : undefined;

  // Parse depends
  const dependsMatch = description.match(/\|\s*depends:\s*([^|]+)/i);
  const depends = dependsMatch
    ? dependsMatch[1].split(",").map((s) => s.trim())
    : undefined;

  // Clean description
  description = description
    .replace(/\|\s*output:\s*[^|]+/gi, "")
    .replace(/\|\s*depends:\s*[^|]+/gi, "")
    .trim();

  return { executor, description, output, depends };
}

export function WorkflowTodo({ explanation, plan }: WorkflowTodoProps) {
  const parsedSteps: ParsedStep[] = plan.map((item) => ({
    ...parseStep(item.step),
    status: item.status,
  }));

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <span className="text-green-400">&#x2713;</span>;
      case "inProgress":
        return <span className="text-yellow-400 animate-pulse">&#x25B6;</span>;
      default:
        return <span className="text-zinc-500">&#x25CB;</span>;
    }
  };

  const getExecutorBadge = (executor: string) => {
    switch (executor) {
      case "AI":
        return (
          <span className="rounded bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400">
            AI
          </span>
        );
      case "HUMAN":
        return (
          <span className="rounded bg-orange-600/20 px-2 py-0.5 text-xs font-medium text-orange-400">
            HUMAN
          </span>
        );
      default:
        return null;
    }
  };

  if (plan.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">&#x1F4CB;</span>
        <h3 className="font-medium text-white">Workflow Tasks</h3>
      </div>

      {explanation && (
        <p className="mb-3 text-sm text-zinc-400">{explanation}</p>
      )}

      <div className="space-y-2">
        {parsedSteps.map((step, index) => (
          <div
            key={index}
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
              step.status === "inProgress"
                ? "border-yellow-500/50 bg-yellow-500/5"
                : step.status === "completed"
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-zinc-700 bg-zinc-800/30"
            }`}
          >
            <div className="mt-0.5">{getStatusIcon(step.status)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {getExecutorBadge(step.executor)}
                <span
                  className={`text-sm ${
                    step.status === "completed"
                      ? "text-zinc-400 line-through"
                      : "text-white"
                  }`}
                >
                  {step.description}
                </span>
              </div>
              {(step.output || step.depends) && (
                <div className="flex flex-wrap gap-3 text-xs mt-1">
                  {step.output && step.output.length > 0 && (
                    <span className="text-zinc-500">
                      <span className="text-zinc-600">output:</span>{" "}
                      {step.output.map((o, i) => (
                        <span
                          key={i}
                          className="inline-block rounded bg-zinc-700/50 px-1.5 py-0.5 ml-1"
                        >
                          {o}
                        </span>
                      ))}
                    </span>
                  )}
                  {step.depends && step.depends.length > 0 && (
                    <span className="text-zinc-500">
                      <span className="text-zinc-600">depends:</span>{" "}
                      {step.depends.map((d, i) => (
                        <span
                          key={i}
                          className="inline-block rounded bg-zinc-700/50 px-1.5 py-0.5 ml-1"
                        >
                          {d}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Structured workflow display component for outputSchema results
export function StructuredWorkflowDisplay({
  workflow,
}: StructuredWorkflowProps) {
  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "completed":
        return <span className="text-green-400">&#x2713;</span>;
      case "inProgress":
        return <span className="text-yellow-400 animate-pulse">&#x25B6;</span>;
      default:
        return <span className="text-zinc-500">&#x25CB;</span>;
    }
  };

  const getExecutorBadge = (executor: string) => {
    switch (executor) {
      case "AI":
        return (
          <span className="rounded bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400">
            AI
          </span>
        );
      case "HUMAN":
        return (
          <span className="rounded bg-orange-600/20 px-2 py-0.5 text-xs font-medium text-orange-400">
            HUMAN
          </span>
        );
      default:
        return null;
    }
  };

  if (!workflow.tasks || workflow.tasks.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">&#x1F4CB;</span>
          <h3 className="font-medium text-white">{workflow.title}</h3>
        </div>
        {workflow.description && (
          <p className="mt-1 text-sm text-zinc-400">{workflow.description}</p>
        )}
      </div>

      <div className="space-y-2">
        {workflow.tasks.map((task, index) => (
          <div
            key={task.id || index}
            className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
              task.status === "inProgress"
                ? "border-yellow-500/50 bg-yellow-500/5"
                : task.status === "completed"
                  ? "border-green-500/30 bg-green-500/5"
                  : "border-zinc-700 bg-zinc-800/30"
            }`}
          >
            <div className="mt-0.5">{getStatusIcon(task.status)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {getExecutorBadge(task.executor)}
                <span
                  className={`text-sm ${
                    task.status === "completed"
                      ? "text-zinc-400 line-through"
                      : "text-white"
                  }`}
                >
                  {task.description}
                </span>
              </div>
              {(task.output || task.depends) && (
                <div className="flex flex-wrap gap-3 text-xs mt-1">
                  {task.output && task.output.length > 0 && (
                    <span className="text-zinc-500">
                      <span className="text-zinc-600">output:</span>{" "}
                      {task.output.map((o, i) => (
                        <span
                          key={i}
                          className="inline-block rounded bg-zinc-700/50 px-1.5 py-0.5 ml-1"
                        >
                          {o}
                        </span>
                      ))}
                    </span>
                  )}
                  {task.depends && task.depends.length > 0 && (
                    <span className="text-zinc-500">
                      <span className="text-zinc-600">depends:</span>{" "}
                      {task.depends.map((d, i) => (
                        <span
                          key={i}
                          className="inline-block rounded bg-zinc-700/50 px-1.5 py-0.5 ml-1"
                        >
                          {d}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
