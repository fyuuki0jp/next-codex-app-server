import { CodexAppServer } from "@/infrastructure/codex";

// Global state for the Codex instance and current thread
let codexInstance: CodexAppServer | null = null;
let currentThreadId: string | null = null;

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

    await codexInstance.initialize(
      {
        name: "next-codex-chat",
        version: "0.1.0",
        title: "Next.js Codex Chat",
      },
      { experimentalApi: false },
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
      };

      try {
        // Start the turn
        if (currentThreadId) {
          await codex.sendMessage(currentThreadId, message);
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
