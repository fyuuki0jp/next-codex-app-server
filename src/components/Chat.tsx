"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { UserInputPrompt } from "./UserInputPrompt";
import {
  WorkflowTodo,
  StructuredWorkflowDisplay,
  type StructuredWorkflow,
} from "./WorkflowTodo";

interface UserInputOption {
  label: string;
  description: string;
}

interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: UserInputOption[] | null;
}

interface UserInputRequest {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: UserInputQuestion[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  commands?: CommandExecution[];
  fileChanges?: FileChange[];
}

interface CommandExecution {
  id: string;
  output: string;
  exitCode?: number;
}

interface FileChange {
  path: string;
  status: "pending" | "complete";
}

interface WorkflowPlan {
  explanation: string | null;
  plan: Array<{ step: string; status: "pending" | "inProgress" | "completed" }>;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [currentCommands, setCurrentCommands] = useState<CommandExecution[]>(
    [],
  );
  const [currentFileChanges, setCurrentFileChanges] = useState<FileChange[]>(
    [],
  );
  const [userInputRequest, setUserInputRequest] =
    useState<UserInputRequest | null>(null);
  const [workflowPlan, setWorkflowPlan] = useState<WorkflowPlan | null>(null);
  const [structuredWorkflow, setStructuredWorkflow] =
    useState<StructuredWorkflow | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, scrollToBottom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setStreamingContent("");
    setCurrentCommands([]);
    setCurrentFileChanges([]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.content }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const eventType = line.slice(7);
            continue;
          }
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              handleEvent(
                data,
                accumulatedContent,
                (content) => {
                  accumulatedContent = content;
                  setStreamingContent(content);
                },
                setCurrentCommands,
                setCurrentFileChanges,
                setUserInputRequest,
                setWorkflowPlan,
                setStructuredWorkflow,
              );
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Finalize the message
      if (accumulatedContent) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: accumulatedContent,
          commands:
            currentCommands.length > 0 ? [...currentCommands] : undefined,
          fileChanges:
            currentFileChanges.length > 0 ? [...currentFileChanges] : undefined,
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setStreamingContent("");
      }
    } catch (error) {
      console.error("Error:", error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setCurrentCommands([]);
      setCurrentFileChanges([]);
    }
  };

  const handleNewChat = async () => {
    await fetch("/api/chat", { method: "DELETE" });
    setMessages([]);
    setStreamingContent("");
    setCurrentCommands([]);
    setCurrentFileChanges([]);
    setUserInputRequest(null);
    setWorkflowPlan(null);
    setStructuredWorkflow(null);
  };

  const handleUserInputSubmit = async (answers: {
    [key: string]: { answers: string[] };
  }) => {
    if (!userInputRequest) return;

    try {
      const response = await fetch("/api/chat/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: userInputRequest.itemId,
          answers,
        }),
      });

      if (!response.ok) {
        console.error("Failed to submit user input");
      }
    } catch (error) {
      console.error("Error submitting user input:", error);
    } finally {
      setUserInputRequest(null);
    }
  };

  const handleUserInputCancel = async () => {
    if (!userInputRequest) return;

    // Submit empty answers to cancel
    try {
      await fetch("/api/chat/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: userInputRequest.itemId,
          answers: {},
        }),
      });
    } catch (error) {
      console.error("Error cancelling user input:", error);
    } finally {
      setUserInputRequest(null);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-900">
      {/* User Input Prompt Modal */}
      {userInputRequest && (
        <UserInputPrompt
          itemId={userInputRequest.itemId}
          questions={userInputRequest.questions}
          onSubmit={handleUserInputSubmit}
          onCancel={handleUserInputCancel}
        />
      )}

      {/* Header */}
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-semibold text-white">Codex Chat</h1>
        <button
          onClick={handleNewChat}
          className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          New Chat
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && !streamingContent && (
            <div className="flex h-full flex-col items-center justify-center py-20 text-center">
              <div className="mb-4 text-4xl">&#x1F916;</div>
              <h2 className="mb-2 text-xl font-medium text-white">
                Codex Agent
              </h2>
              <p className="max-w-md text-zinc-400">
                Ask me to help with coding tasks. I can read files, execute
                commands, and make changes to your codebase.
              </p>
            </div>
          )}

          {/* Structured Workflow (from outputSchema) */}
          {structuredWorkflow && (
            <StructuredWorkflowDisplay workflow={structuredWorkflow} />
          )}

          {/* Legacy Workflow Todo Panel (from turn/plan/updated) */}
          {!structuredWorkflow &&
            workflowPlan &&
            workflowPlan.plan.length > 0 && (
              <WorkflowTodo
                explanation={workflowPlan.explanation}
                plan={workflowPlan.plan}
              />
            )}

          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}

          {/* Streaming content */}
          {streamingContent && (
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-sm">
                &#x1F916;
              </div>
              <div className="flex-1">
                <div className="prose prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-zinc-300">
                    {streamingContent}
                  </pre>
                </div>
                {currentCommands.length > 0 && (
                  <CommandsDisplay commands={currentCommands} />
                )}
                {currentFileChanges.length > 0 && (
                  <FileChangesDisplay fileChanges={currentFileChanges} />
                )}
              </div>
            </div>
          )}

          {isLoading && !streamingContent && (
            <div className="flex gap-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-sm">
                &#x1F916;
              </div>
              <div className="flex items-center gap-2 text-zinc-400">
                <LoadingDots />
                <span>Thinking...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 px-4 py-4">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Codex something..."
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="rounded-lg bg-green-600 px-6 py-3 font-medium text-white transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className="flex gap-4">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
          isUser ? "bg-blue-600" : "bg-green-600"
        }`}
      >
        {isUser ? "&#x1F464;" : "&#x1F916;"}
      </div>
      <div className="flex-1">
        <div className="prose prose-invert max-w-none">
          <pre className="whitespace-pre-wrap text-sm text-zinc-300">
            {message.content}
          </pre>
        </div>
        {message.commands && <CommandsDisplay commands={message.commands} />}
        {message.fileChanges && (
          <FileChangesDisplay fileChanges={message.fileChanges} />
        )}
      </div>
    </div>
  );
}

function CommandsDisplay({ commands }: { commands: CommandExecution[] }) {
  return (
    <div className="mt-3 space-y-2">
      {commands.map((cmd) => (
        <div
          key={cmd.id}
          className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3"
        >
          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
            <span>&#x1F4BB;</span>
            <span>Command Execution</span>
            {cmd.exitCode !== undefined && (
              <span
                className={
                  cmd.exitCode === 0 ? "text-green-400" : "text-red-400"
                }
              >
                (exit: {cmd.exitCode})
              </span>
            )}
          </div>
          {cmd.output && (
            <pre className="overflow-x-auto text-xs text-zinc-300">
              {cmd.output}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

function FileChangesDisplay({ fileChanges }: { fileChanges: FileChange[] }) {
  return (
    <div className="mt-3 space-y-1">
      {fileChanges.map((file) => (
        <div
          key={file.path}
          className="flex items-center gap-2 text-xs text-zinc-400"
        >
          <span>&#x1F4C4;</span>
          <span>{file.path}</span>
          <span
            className={
              file.status === "complete" ? "text-green-400" : "text-yellow-400"
            }
          >
            {file.status === "complete" ? "Done" : "..."}
          </span>
        </div>
      ))}
    </div>
  );
}

function LoadingDots() {
  return (
    <span className="inline-flex gap-1">
      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500" />
    </span>
  );
}

// Event handler helper
function handleEvent(
  data: Record<string, unknown>,
  currentContent: string,
  setContent: (content: string) => void,
  setCommands: React.Dispatch<React.SetStateAction<CommandExecution[]>>,
  setFileChanges: React.Dispatch<React.SetStateAction<FileChange[]>>,
  setUserInputRequest: React.Dispatch<
    React.SetStateAction<UserInputRequest | null>
  >,
  setWorkflowPlan: React.Dispatch<React.SetStateAction<WorkflowPlan | null>>,
  setStructuredWorkflow: React.Dispatch<
    React.SetStateAction<StructuredWorkflow | null>
  >,
) {
  // Handle user input request events
  if ("questions" in data && "itemId" in data) {
    setUserInputRequest(data as unknown as UserInputRequest);
    return;
  }

  // Handle structured workflow output (from outputSchema)
  if ("tasks" in data && Array.isArray(data.tasks) && "title" in data) {
    setStructuredWorkflow(data as unknown as StructuredWorkflow);
    return;
  }

  // Handle plan updated events (legacy workflow todo)
  if ("plan" in data && Array.isArray(data.plan) && !("tasks" in data)) {
    setWorkflowPlan({
      explanation: (data.explanation as string) || null,
      plan: data.plan as WorkflowPlan["plan"],
    });
    return;
  }

  // Handle delta events (streaming text)
  if ("text" in data && typeof data.text === "string") {
    setContent(currentContent + data.text);
    return;
  }

  // Handle command events
  if ("command" in data) {
    const cmdId = data.command as string;
    setCommands((prev) => {
      if (!prev.find((c) => c.id === cmdId)) {
        return [...prev, { id: cmdId, output: "" }];
      }
      return prev;
    });
    return;
  }

  if ("delta" in data && typeof data.delta === "string") {
    setCommands((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = {
        ...updated[updated.length - 1],
        output: updated[updated.length - 1].output + data.delta,
      };
      return updated;
    });
    return;
  }

  if ("exitCode" in data) {
    setCommands((prev) => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      updated[updated.length - 1] = {
        ...updated[updated.length - 1],
        exitCode: data.exitCode as number,
      };
      return updated;
    });
    return;
  }

  // Handle file change events
  if ("paths" in data && Array.isArray(data.paths)) {
    const paths = data.paths as string[];
    const isComplete = "success" in data;
    setFileChanges((prev) => {
      const newChanges = [...prev];
      for (const path of paths) {
        const existing = newChanges.find((f) => f.path === path);
        if (existing) {
          if (isComplete) {
            existing.status = "complete";
          }
        } else {
          newChanges.push({
            path,
            status: isComplete ? "complete" : "pending",
          });
        }
      }
      return newChanges;
    });
    return;
  }
}
