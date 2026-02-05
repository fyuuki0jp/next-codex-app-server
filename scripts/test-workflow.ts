/**
 * Test script for Codex workflow todo functionality
 * Run with: npx tsx scripts/test-workflow.ts
 */

import { CodexAppServer } from "../src/infrastructure/codex";

// Workflow todo JSON Schema for structured output
const WORKFLOW_TODO_SCHEMA = {
  type: "object",
  additionalProperties: false,
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
        additionalProperties: false,
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
        required: ["id", "executor", "description", "output", "depends"],
      },
    },
  },
  required: ["title", "description", "tasks"],
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

async function main() {
  console.log("Starting Codex workflow test...\n");

  const codex = CodexAppServer.getInstance();

  // Register handlers
  codex.onServerRequest("item/commandExecution/requestApproval", async () => ({
    decision: "accept" as const,
  }));
  codex.onServerRequest("item/fileChange/requestApproval", async () => ({
    decision: "accept" as const,
  }));

  // Handle user input requests - auto-respond for testing
  codex.onServerRequest("item/tool/requestUserInput", async (params) => {
    console.log("\n=== USER INPUT REQUEST ===");
    console.log("Questions:", JSON.stringify(params.questions, null, 2));

    // Auto-respond with test answers
    const answers: Record<string, { answers: string[] }> = {};
    for (const q of params.questions) {
      if (q.options && q.options.length > 0) {
        // Pick first option
        answers[q.id] = { answers: [q.options[0].label] };
        console.log(
          `Auto-answering "${q.question}" with: ${q.options[0].label}`,
        );
      } else {
        // Free text - provide test answer
        answers[q.id] = { answers: ["Test answer for: " + q.question] };
        console.log(`Auto-answering "${q.question}" with test text`);
      }
    }
    console.log("=========================\n");

    return { answers };
  });

  // Initialize
  console.log("Initializing Codex...");
  await codex.initialize(
    {
      name: "workflow-test",
      version: "0.1.0",
      title: "Workflow Test Script",
    },
    { experimentalApi: true },
  );
  console.log("Codex initialized.\n");

  // Start a thread
  console.log("Starting thread...");
  const { thread } = await codex.startThread({});
  console.log(`Thread started: ${thread.id}\n`);

  // Set up event listeners
  codex.onNotification("item/agentMessage/delta", (params) => {
    const p = params as { delta?: string };
    if (p.delta) {
      process.stdout.write(p.delta);
    }
  });

  codex.onNotification("turn/plan/updated", (params) => {
    const p = params as {
      explanation: string | null;
      plan: Array<{ step: string; status: string }>;
    };
    console.log("\n\n=== PLAN UPDATED ===");
    if (p.explanation) console.log("Explanation:", p.explanation);
    console.log("Plan:", JSON.stringify(p.plan, null, 2));
    console.log("====================\n");
  });

  codex.onNotification("item/completed", (params) => {
    const p = params as {
      item: { type: string; text?: string; id: string };
    };
    if (p.item.type === "agentMessage" && p.item.text) {
      try {
        const parsed = JSON.parse(p.item.text);
        if (parsed.tasks && Array.isArray(parsed.tasks)) {
          console.log("\n\n=== STRUCTURED WORKFLOW OUTPUT ===");
          console.log(JSON.stringify(parsed, null, 2));
          console.log("==================================\n");
        }
      } catch {
        // Not JSON
      }
    }
  });

  codex.onNotification("turn/completed", (params) => {
    const p = params as { turn?: { status?: string } };
    console.log("\n\n=== TURN COMPLETED ===");
    console.log("Status:", p.turn?.status);
    console.log("======================\n");
  });

  codex.onNotification("error", (params) => {
    const p = params as { message?: string };
    console.error("\n\n=== ERROR ===");
    console.error("Message:", p.message);
    console.error("=============\n");
  });

  // Send message
  const testMessage =
    "省庁への補助金申請のワークフローを作成してください。申請書類の作成、省庁との打ち合わせ、修正対応を含めてください。";

  console.log("Sending message:", testMessage);
  console.log("\n--- Response ---\n");

  try {
    await codex.sendMessage(thread.id, testMessage, {
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.1-codex-mini",
          reasoning_effort: null,
          developer_instructions: WORKFLOW_TODO_INSTRUCTIONS,
        },
      },
      outputSchema: WORKFLOW_TODO_SCHEMA,
    });
  } catch (error) {
    console.error("Error sending message:", error);
  }

  // Keep process alive for a bit to receive all notifications
  await new Promise((resolve) => setTimeout(resolve, 60000));

  console.log("\nTest completed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
