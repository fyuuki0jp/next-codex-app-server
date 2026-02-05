import { CodexAppServer } from "@/infrastructure/codex";
import type {
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
  ToolRequestUserInputAnswer,
} from "@/infrastructure/codex/schemas/v2";

// Workflow todo JSON Schema for structured output
const WORKFLOW_TODO_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Title of the workflow",
    },
    description: {
      type: "string",
      description: "Brief description of the overall workflow goal",
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Unique identifier for the task",
          },
          executor: {
            type: "string",
            enum: ["AI", "HUMAN"],
            description: "Who executes this task: AI or HUMAN",
          },
          description: {
            type: "string",
            description: "Description of the task",
          },
          output: {
            type: "array",
            items: { type: "string" },
            description: "Artifacts/deliverables this task produces",
          },
          depends: {
            type: "array",
            items: { type: "string" },
            description: "Task IDs this task depends on",
          },
        },
        required: ["id", "executor", "description"],
      },
    },
  },
  required: ["title", "tasks"],
};

// Developer instructions for workflow creation
const WORKFLOW_TODO_INSTRUCTIONS = `
## Workflow Task Creation

You are a workflow planning assistant. Your goal is to create a structured workflow with tasks that can be executed by either AI or HUMAN.

### Process
1. Use request_user_input to ask clarifying questions about the workflow requirements
2. Based on user responses, create a comprehensive workflow plan
3. Output the final workflow as structured JSON

### Task Assignment Rules
- **AI tasks**: Document creation, data analysis, code generation, research, calculations, formatting
- **HUMAN tasks**: Meetings, phone calls, physical actions, approvals, signatures, external communications, decisions requiring human judgment

### Important
- Each HUMAN task should clearly specify what artifacts/information the human needs to provide
- Use task IDs in the "depends" field to indicate dependencies between tasks
- Ask questions via request_user_input if requirements are unclear
`;

// Global state for the Codex instance and current thread
let codexInstance: CodexAppServer | null = null;
let currentThreadId: string | null = null;

// Pending user input requests - maps itemId to resolve/reject functions
interface PendingUserInput {
  resolve: (response: ToolRequestUserInputResponse) => void;
  reject: (error: Error) => void;
  params: ToolRequestUserInputParams;
}
export const pendingUserInputs = new Map<string, PendingUserInput>();

// Current SSE send function for forwarding requests to frontend
let currentSendEvent: ((event: string, data: unknown) => void) | null = null;

export function setCurrentSendEvent(
  sendEvent: ((event: string, data: unknown) => void) | null,
) {
  currentSendEvent = sendEvent;
}

async function getCodex(): Promise<CodexAppServer> {
  if (!codexInstance) {
    codexInstance = CodexAppServer.getInstance();

    // Register approval handlers - auto-accept for demo
    codexInstance.onServerRequest(
      "item/commandExecution/requestApproval",
      async () => ({ decision: "accept" as const }),
    );
    codexInstance.onServerRequest(
      "item/fileChange/requestApproval",
      async () => ({ decision: "accept" as const }),
    );

    // Register user input request handler
    codexInstance.onServerRequest(
      "item/tool/requestUserInput",
      async (
        params: ToolRequestUserInputParams,
      ): Promise<ToolRequestUserInputResponse> => {
        // Forward the request to the frontend via SSE
        if (currentSendEvent) {
          currentSendEvent("user_input_request", params);
        }

        // Wait for user response
        return new Promise((resolve, reject) => {
          pendingUserInputs.set(params.itemId, {
            resolve,
            reject,
            params,
          });

          // Timeout after 5 minutes
          setTimeout(
            () => {
              if (pendingUserInputs.has(params.itemId)) {
                pendingUserInputs.delete(params.itemId);
                reject(new Error("User input request timed out"));
              }
            },
            5 * 60 * 1000,
          );
        });
      },
    );

    await codexInstance.initialize(
      {
        name: "next-codex-chat",
        version: "0.1.0",
        title: "Next.js Codex Chat",
      },
      { experimentalApi: true },
    );
  }
  return codexInstance;
}

export async function POST(request: Request) {
  const { message } = await request.json();

  if (!message || typeof message !== "string") {
    return new Response(JSON.stringify({ error: "Message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const codex = await getCodex();

  // Start a new thread if we don't have one
  if (!currentThreadId) {
    const { thread } = await codex.startThread({});
    currentThreadId = thread.id;
  }

  // Create a streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // Set current send event for user input requests
      setCurrentSendEvent(sendEvent);

      // Set up event listeners
      const unsubscribers: (() => void)[] = [];

      // Use v2 notifications for streaming text (item/agentMessage/delta)
      unsubscribers.push(
        codex.onNotification("item/agentMessage/delta", (params) => {
          const p = params as { delta?: string };
          if (p.delta) {
            sendEvent("delta", { text: p.delta });
          }
        }),
      );

      // Command execution events (via EventMsg)
      unsubscribers.push(
        codex.onEvent("exec_command_begin", (event) => {
          sendEvent("command_start", { command: event.call_id });
        }),
      );

      unsubscribers.push(
        codex.onEvent("exec_command_output_delta", (event) => {
          sendEvent("command_output", { delta: event.chunk });
        }),
      );

      unsubscribers.push(
        codex.onEvent("exec_command_end", (event) => {
          sendEvent("command_end", { exitCode: event.exit_code });
        }),
      );

      // File change events (via EventMsg)
      unsubscribers.push(
        codex.onEvent("patch_apply_begin", (event) => {
          const paths = Object.keys(event.changes);
          sendEvent("file_change_start", { paths });
        }),
      );

      unsubscribers.push(
        codex.onEvent("patch_apply_end", (event) => {
          const paths = Object.keys(event.changes);
          sendEvent("file_change_end", { paths, success: event.success });
        }),
      );

      // Plan updated notification (workflow todo - legacy)
      unsubscribers.push(
        codex.onNotification("turn/plan/updated", (params) => {
          const p = params as {
            threadId: string;
            turnId: string;
            explanation: string | null;
            plan: Array<{ step: string; status: string }>;
          };
          sendEvent("plan_updated", {
            explanation: p.explanation,
            plan: p.plan,
          });
        }),
      );

      // Item completed notification - check for structured workflow output
      unsubscribers.push(
        codex.onNotification("item/completed", (params) => {
          const p = params as {
            item: { type: string; text?: string };
            threadId: string;
            turnId: string;
          };
          // Check if this is an agentMessage with structured workflow output
          if (p.item.type === "agentMessage" && p.item.text) {
            try {
              const parsed = JSON.parse(p.item.text);
              // Check if it matches our workflow schema
              if (parsed.tasks && Array.isArray(parsed.tasks)) {
                sendEvent("workflow_output", parsed);
              }
            } catch {
              // Not JSON, ignore
            }
          }
        }),
      );

      // Turn completed (v2 notification)
      unsubscribers.push(
        codex.onNotification("turn/completed", (params) => {
          const p = params as { turn?: { status?: string } };
          sendEvent("complete", { status: p.turn?.status });
          cleanup();
          controller.close();
        }),
      );

      // Error handling (v2 notification)
      unsubscribers.push(
        codex.onNotification("error", (params) => {
          const p = params as { message?: string };
          sendEvent("error", { message: p.message || "Unknown error" });
          cleanup();
          controller.close();
        }),
      );

      // Turn aborted (via EventMsg)
      unsubscribers.push(
        codex.onEvent("turn_aborted", (event) => {
          sendEvent("aborted", { reason: event.reason });
          cleanup();
          controller.close();
        }),
      );

      const cleanup = () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
        // Clear the send event reference
        setCurrentSendEvent(null);
      };

      try {
        // Start the turn with plan mode, structured output, and user input support
        if (currentThreadId) {
          await codex.sendMessage(currentThreadId, message, {
            collaborationMode: {
              mode: "plan",
              settings: {
                model: "codex-mini-latest",
                reasoning_effort: null,
                developer_instructions: WORKFLOW_TODO_INSTRUCTIONS,
              },
            },
            outputSchema: WORKFLOW_TODO_SCHEMA,
          });
        }
      } catch (error) {
        sendEvent("error", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
        cleanup();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// Reset thread endpoint
export async function DELETE() {
  currentThreadId = null;
  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
