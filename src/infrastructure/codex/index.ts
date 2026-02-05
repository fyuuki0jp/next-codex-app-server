import { spawn } from "child_process";
import type { ChildProcess } from "node:child_process";
import readline from "node:readline";
import { EventEmitter } from "node:events";

import type {
  ClientRequest,
  ClientInfo,
  InitializeParams,
  InitializeResponse,
  InitializeCapabilities,
  RequestId,
  ServerNotification,
  ServerRequest,
  EventMsg,
} from "./schemas";

import type {
  ThreadStartParams,
  ThreadStartResponse,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadForkParams,
  ThreadForkResponse,
  ThreadListParams,
  ThreadListResponse,
  ThreadArchiveParams,
  ThreadArchiveResponse,
  ThreadUnarchiveParams,
  ThreadUnarchiveResponse,
  ThreadRollbackParams,
  ThreadRollbackResponse,
  ThreadReadParams,
  ThreadReadResponse,
  ThreadSetNameParams,
  ThreadSetNameResponse,
  TurnStartParams,
  TurnStartResponse,
  TurnInterruptParams,
  TurnInterruptResponse,
  LoginAccountParams,
  LoginAccountResponse,
  GetAccountParams,
  GetAccountResponse,
  GetAccountRateLimitsResponse,
  ModelListParams,
  ModelListResponse,
  SkillsListParams,
  SkillsListResponse,
  CommandExecParams,
  CommandExecResponse,
  ConfigReadParams,
  ConfigReadResponse,
  ReviewStartParams,
  ReviewStartResponse,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
} from "./schemas/v2";

// ============================================================================
// Types
// ============================================================================

/** JSON-RPC response from the server */
interface JsonRpcResponse<T = unknown> {
  id: RequestId;
  result?: T;
  error?: JsonRpcError;
}

/** JSON-RPC error */
interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Pending request awaiting response */
interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  method: string;
}

/** Type-safe method-to-params/response mapping */
interface MethodMap {
  // Initialization
  initialize: { params: InitializeParams; response: InitializeResponse };

  // Thread management (v2)
  "thread/start": { params: ThreadStartParams; response: ThreadStartResponse };
  "thread/resume": {
    params: ThreadResumeParams;
    response: ThreadResumeResponse;
  };
  "thread/fork": { params: ThreadForkParams; response: ThreadForkResponse };
  "thread/list": { params: ThreadListParams; response: ThreadListResponse };
  "thread/read": { params: ThreadReadParams; response: ThreadReadResponse };
  "thread/archive": {
    params: ThreadArchiveParams;
    response: ThreadArchiveResponse;
  };
  "thread/unarchive": {
    params: ThreadUnarchiveParams;
    response: ThreadUnarchiveResponse;
  };
  "thread/rollback": {
    params: ThreadRollbackParams;
    response: ThreadRollbackResponse;
  };
  "thread/name/set": {
    params: ThreadSetNameParams;
    response: ThreadSetNameResponse;
  };

  // Turn operations (v2)
  "turn/start": { params: TurnStartParams; response: TurnStartResponse };
  "turn/interrupt": {
    params: TurnInterruptParams;
    response: TurnInterruptResponse;
  };

  // Account management (v2)
  "account/login/start": {
    params: LoginAccountParams;
    response: LoginAccountResponse;
  };
  "account/login/cancel": { params: undefined; response: unknown };
  "account/logout": { params: undefined; response: unknown };
  "account/read": { params: GetAccountParams; response: GetAccountResponse };
  "account/rateLimits/read": {
    params: undefined;
    response: GetAccountRateLimitsResponse;
  };

  // Model & Skills
  "model/list": { params: ModelListParams; response: ModelListResponse };
  "skills/list": { params: SkillsListParams; response: SkillsListResponse };

  // Commands & Review
  "command/exec": { params: CommandExecParams; response: CommandExecResponse };
  "review/start": { params: ReviewStartParams; response: ReviewStartResponse };

  // Configuration
  "config/read": { params: ConfigReadParams; response: ConfigReadResponse };
}

/** Extract method names from MethodMap */
type MethodName = keyof MethodMap;

/** Server request handler type */
type ServerRequestHandler<T extends ServerRequest["method"]> = (
  params: Extract<ServerRequest, { method: T }>["params"],
) => Promise<ServerRequestResponseMap[T]>;

/** Mapping server request methods to their response types */
interface ServerRequestResponseMap {
  "item/commandExecution/requestApproval": CommandExecutionRequestApprovalResponse;
  "item/fileChange/requestApproval": FileChangeRequestApprovalResponse;
  "item/tool/requestUserInput": ToolRequestUserInputResponse;
  "item/tool/call": unknown;
  "account/chatgptAuthTokens/refresh": unknown;
  applyPatchApproval: unknown;
  execCommandApproval: unknown;
}

/** Event handler callback type */
type EventHandler<T extends EventMsg["type"]> = (
  event: Extract<EventMsg, { type: T }>,
) => void;

/** Notification handler callback type - uses unknown for safer runtime handling */
type NotificationHandler = (params: unknown) => void;

// ============================================================================
// CodexAppServer Class
// ============================================================================

/**
 * Type-safe singleton client for Codex App Server.
 *
 * Provides bidirectional JSON-RPC 2.0 communication over stdio with the Codex CLI.
 *
 * @example
 * ```ts
 * const codex = CodexAppServer.getInstance();
 *
 * // Initialize
 * await codex.initialize({
 *   clientInfo: { name: "my-app", version: "1.0.0", title: null },
 *   capabilities: { experimentalApi: false },
 * });
 *
 * // Start a thread
 * const { thread } = await codex.request("thread/start", {
 *   experimentalRawEvents: false,
 * });
 *
 * // Listen for events
 * codex.onEvent("agent_message", (event) => {
 *   console.log("Agent:", event.content);
 * });
 *
 * // Start a turn
 * await codex.request("turn/start", {
 *   threadId: thread.id,
 *   input: [{ type: "text", text: "Hello!", text_elements: [] }],
 * });
 * ```
 */
export class CodexAppServer extends EventEmitter {
  private static instance: CodexAppServer | null = null;

  private process: ChildProcess;
  private reader: readline.Interface;
  private requestId = 0;
  private pendingRequests = new Map<RequestId, PendingRequest>();
  private serverRequestHandlers = new Map<
    string,
    ServerRequestHandler<never>
  >();
  private initialized = false;

  private constructor() {
    super();

    this.process = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    if (!this.process.stdout || !this.process.stdin) {
      throw new Error("Failed to create stdio pipes for Codex process");
    }

    this.reader = readline.createInterface({ input: this.process.stdout });
    this.setupLineHandler();
    this.setupProcessHandlers();
  }

  /**
   * Get the singleton instance of CodexAppServer.
   */
  static getInstance(): CodexAppServer {
    if (!CodexAppServer.instance) {
      CodexAppServer.instance = new CodexAppServer();
    }
    return CodexAppServer.instance;
  }

  /**
   * Reset the singleton instance (primarily for testing).
   */
  static resetInstance(): void {
    if (CodexAppServer.instance) {
      CodexAppServer.instance.dispose();
      CodexAppServer.instance = null;
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Initialize the Codex App Server connection.
   */
  async initialize(
    clientInfo: ClientInfo,
    capabilities: InitializeCapabilities | null = null,
  ): Promise<InitializeResponse> {
    if (this.initialized) {
      throw new Error("CodexAppServer is already initialized");
    }

    const response = await this.request("initialize", {
      clientInfo,
      capabilities,
    });

    this.initialized = true;
    return response;
  }

  /**
   * Check if the server is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose the Codex process and clean up resources.
   */
  dispose(): void {
    this.reader.close();
    this.process.stdin?.end();
    this.process.kill();
    this.pendingRequests.clear();
    this.serverRequestHandlers.clear();
    this.removeAllListeners();
    this.initialized = false;
  }

  // --------------------------------------------------------------------------
  // Request / Response
  // --------------------------------------------------------------------------

  /**
   * Send a type-safe request to the Codex App Server.
   *
   * @param method - The JSON-RPC method name
   * @param params - The method parameters
   * @returns Promise resolving to the response
   */
  async request<M extends MethodName>(
    method: M,
    params: MethodMap[M]["params"],
  ): Promise<MethodMap[M]["response"]> {
    const id = this.nextRequestId();

    const message: {
      method: M;
      id: RequestId;
      params: MethodMap[M]["params"];
    } = {
      method,
      id,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
      });

      this.send(message);
    });
  }

  /**
   * Send a notification (no response expected).
   *
   * @param method - The notification method name
   * @param params - The notification parameters
   */
  notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------

  /**
   * Register a handler for a specific event type.
   *
   * @param type - The event type
   * @param handler - The event handler callback
   * @returns Unsubscribe function
   */
  onEvent<T extends EventMsg["type"]>(
    type: T,
    handler: EventHandler<T>,
  ): () => void {
    const wrappedHandler = (event: EventMsg) => {
      if (event.type === type) {
        handler(event as Extract<EventMsg, { type: T }>);
      }
    };

    this.on("event", wrappedHandler);
    return () => this.off("event", wrappedHandler);
  }

  /**
   * Register a handler for a specific server notification.
   *
   * @param method - The notification method
   * @param handler - The notification handler callback
   * @returns Unsubscribe function
   */
  onNotification(
    method: ServerNotification["method"],
    handler: NotificationHandler,
  ): () => void {
    const wrappedHandler = (notification: ServerNotification) => {
      if (notification.method === method) {
        handler(notification.params);
      }
    };

    this.on("notification", wrappedHandler);
    return () => this.off("notification", wrappedHandler);
  }

  /**
   * Register a handler for server requests (approval workflows).
   *
   * @param method - The server request method
   * @param handler - The handler that returns a response
   */
  onServerRequest<T extends ServerRequest["method"]>(
    method: T,
    handler: ServerRequestHandler<T>,
  ): void {
    this.serverRequestHandlers.set(
      method,
      handler as unknown as ServerRequestHandler<never>,
    );
  }

  // --------------------------------------------------------------------------
  // Convenience Methods
  // --------------------------------------------------------------------------

  /**
   * Start a new thread.
   */
  async startThread(
    params: Omit<ThreadStartParams, "experimentalRawEvents"> & {
      experimentalRawEvents?: boolean;
    },
  ): Promise<ThreadStartResponse> {
    return this.request("thread/start", {
      experimentalRawEvents: false,
      ...params,
    });
  }

  /**
   * Resume an existing thread.
   */
  async resumeThread(
    params: ThreadResumeParams,
  ): Promise<ThreadResumeResponse> {
    return this.request("thread/resume", params);
  }

  /**
   * Start a new turn in a thread.
   */
  async startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    return this.request("turn/start", params);
  }

  /**
   * Send a text message in a turn.
   */
  async sendMessage(
    threadId: string,
    text: string,
    options?: Omit<TurnStartParams, "threadId" | "input">,
  ): Promise<TurnStartResponse> {
    return this.startTurn({
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
      ...options,
    });
  }

  /**
   * Interrupt the current turn.
   */
  async interruptTurn(
    params: TurnInterruptParams,
  ): Promise<TurnInterruptResponse> {
    return this.request("turn/interrupt", params);
  }

  /**
   * List available models.
   */
  async listModels(params: ModelListParams = {}): Promise<ModelListResponse> {
    return this.request("model/list", params);
  }

  /**
   * Get account information.
   */
  async getAccount(
    params: GetAccountParams = { refreshToken: false },
  ): Promise<GetAccountResponse> {
    return this.request("account/read", params);
  }

  /**
   * Login with API key.
   */
  async loginWithApiKey(apiKey: string): Promise<LoginAccountResponse> {
    return this.request("account/login/start", { type: "apiKey", apiKey });
  }

  /**
   * Start ChatGPT OAuth login flow.
   */
  async loginWithChatGpt(): Promise<LoginAccountResponse> {
    return this.request("account/login/start", { type: "chatgpt" });
  }

  /**
   * Logout from the current account.
   */
  async logout(): Promise<unknown> {
    return this.request("account/logout", undefined);
  }

  // --------------------------------------------------------------------------
  // Internal Methods
  // --------------------------------------------------------------------------

  private nextRequestId(): number {
    return ++this.requestId;
  }

  private send(message: unknown): void {
    if (!this.process.stdin) {
      throw new Error("Codex process stdin is not available");
    }
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private setupLineHandler(): void {
    this.reader.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (error) {
        this.emit("error", new Error(`Failed to parse message: ${line}`));
      }
    });
  }

  private setupProcessHandlers(): void {
    this.process.on("error", (error) => {
      this.emit("error", error);
    });

    this.process.on("exit", (code, signal) => {
      this.emit("exit", { code, signal });

      // Reject all pending requests
      for (const [id, pending] of this.pendingRequests) {
        pending.reject(
          new Error(`Codex process exited (code: ${code}, signal: ${signal})`),
        );
        this.pendingRequests.delete(id);
      }
    });
  }

  private handleMessage(message: unknown): void {
    if (!message || typeof message !== "object") {
      return;
    }

    const msg = message as Record<string, unknown>;

    // Response to a request we sent
    if ("id" in msg && msg.id !== undefined) {
      if ("result" in msg || "error" in msg) {
        this.handleResponse(msg as unknown as JsonRpcResponse);
        return;
      }

      // Server request (requires response from us)
      if ("method" in msg && "params" in msg) {
        this.handleServerRequest(
          msg as { method: string; id: RequestId; params: unknown },
        );
        return;
      }
    }

    // Notification (no id) - emit as notification
    // Also emit nested event if params contains msg.type (codex/event/* format)
    if ("method" in msg && !("id" in msg)) {
      const notification = msg as { method: string; params: unknown };
      this.handleNotification(notification);

      // Handle codex/event/* notifications that wrap EventMsg in params.msg
      const params = notification.params as Record<string, unknown> | null;
      if (
        params?.msg &&
        typeof params.msg === "object" &&
        "type" in (params.msg as object)
      ) {
        this.emit("event", params.msg as EventMsg);
      }
      return;
    }

    // Event message (has "type" field directly)
    if ("type" in msg) {
      this.emit("event", msg as EventMsg);
      return;
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.emit(
        "error",
        new Error(`Received response for unknown request: ${response.id}`),
      );
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(
        new Error(`${response.error.message} (code: ${response.error.code})`),
      );
    } else {
      pending.resolve(response.result);
    }
  }

  private handleNotification(notification: {
    method: string;
    params: unknown;
  }): void {
    this.emit("notification", notification as ServerNotification);
  }

  private async handleServerRequest(request: {
    method: string;
    id: RequestId;
    params: unknown;
  }): Promise<void> {
    const handler = this.serverRequestHandlers.get(request.method);

    if (!handler) {
      // Send error response if no handler registered
      this.send({
        id: request.id,
        error: {
          code: -32601,
          message: `No handler registered for method: ${request.method}`,
        },
      });
      return;
    }

    try {
      const result = await handler(request.params as never);
      this.send({ id: request.id, result });
    } catch (error) {
      this.send({
        id: request.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

const globalCodexInstance = globalThis as unknown as {
  codexInstance?: CodexAppServer;
};

/**
 * Get the singleton CodexAppServer instance.
 *
 * @deprecated Use `CodexAppServer.getInstance()` instead
 */
export const getCodexAppServer = (): CodexAppServer => {
  if (!globalCodexInstance.codexInstance) {
    globalCodexInstance.codexInstance = CodexAppServer.getInstance();
  }
  return globalCodexInstance.codexInstance;
};

export default CodexAppServer;
