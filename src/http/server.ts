// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as NodeHttpServer, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { logger } from "../logger.js";
import type { HttpSessionMode, McpServerFactory, McpServerInstance } from "../runtime/types.js";

interface SessionState {
  serverInstance: McpServerInstance;
  transport: StreamableHTTPServerTransport;
  lastActivityAt: number;
  sessionId?: string;
  closed: boolean;
}

export interface StreamableHttpServerOptions {
  host: string;
  port: number;
  path: string;
  authToken: string;
  allowedOrigins: string[];
  sessionMode: HttpSessionMode;
  sessionIdleTimeoutSeconds: number;
  serverFactory: McpServerFactory;
}

export interface StreamableHttpServerHandle {
  readonly url: string;
  close(): Promise<void>;
}

export async function startStreamableHttpServer(options: StreamableHttpServerOptions): Promise<StreamableHttpServerHandle> {
  const allowedOrigins = new Set(options.allowedOrigins);
  const allowHeaderValue = options.sessionMode === "stateful" ? "POST, DELETE" : "POST";
  const statefulSessionController =
    options.sessionMode === "stateful" ? createStatefulSessionController(options.serverFactory, options.sessionIdleTimeoutSeconds) : undefined;
  const statelessRequests = new Set<SessionState>();
  const server = createServer((request, response) => {
    void handleHttpRequest(request, response).catch((error) => {
      logger.error("Failed to handle streamable-http request:", error);

      if (!response.headersSent) {
        sendPlainText(response, 500, "Internal Server Error");
      }
    });
  });

  await listen(server, options.port, options.host);

  return {
    url: buildServerUrl(options.host, options.port, options.path),
    close: async () => {
      if (statefulSessionController) {
        await statefulSessionController.close();
      } else {
        const activeRequests = Array.from(statelessRequests);
        statelessRequests.clear();
        await Promise.all(activeRequests.map((session) => closeSessionState(session)));
      }

      await closeNodeServer(server);
    },
  };

  async function handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!hasValidAuthorizationHeader(request, options.authToken)) {
      response.setHeader("WWW-Authenticate", "Bearer");
      sendPlainText(response, 401, "Unauthorized");
      return;
    }

    if (!isAllowedOrigin(request, allowedOrigins)) {
      sendPlainText(response, 403, "Forbidden");
      return;
    }

    const requestUrl = getRequestUrl(request);

    if (requestUrl.pathname !== options.path) {
      sendPlainText(response, 404, "Not Found");
      return;
    }

    switch (request.method) {
      case "POST":
        if (statefulSessionController) {
          await statefulSessionController.handlePostRequest(request, response);
        } else {
          await handleStatelessPostRequest(request, response);
        }
        return;
      case "DELETE":
        if (statefulSessionController) {
          await statefulSessionController.handleDeleteRequest(request, response);
        } else {
          sendMethodNotAllowed(response, allowHeaderValue);
        }
        return;
      case "GET":
        sendMethodNotAllowed(response, allowHeaderValue);
        return;
      default:
        sendMethodNotAllowed(response, allowHeaderValue);
        return;
    }
  }

  async function handleStatelessPostRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let parsedBody: unknown;

    try {
      parsedBody = await parseJsonBody(request);
    } catch {
      sendPlainText(response, 400, "Bad Request");
      return;
    }

    const session = createStatelessSessionState(options.serverFactory);
    statelessRequests.add(session);
    const closeRequest = createAsyncOnce(async () => {
      statelessRequests.delete(session);
      await closeSessionState(session);
    });

    response.once("close", () => {
      void closeRequest();
    });
    response.once("finish", () => {
      void closeRequest();
    });

    try {
      await session.serverInstance.server.connect(session.transport);
      await session.transport.handleRequest(request, response, parsedBody);
    } catch (error) {
      await closeRequest();
      throw error;
    }
  }
}

interface StatefulSessionController {
  handlePostRequest(request: IncomingMessage, response: ServerResponse): Promise<void>;
  handleDeleteRequest(request: IncomingMessage, response: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

function createStatefulSessionController(
  serverFactory: McpServerFactory,
  sessionIdleTimeoutSeconds: number
): StatefulSessionController {
  const sessions = new Map<string, SessionState>();
  const idleTimeoutMs = sessionIdleTimeoutSeconds * 1000;
  const cleanupIntervalMs = Math.max(1000, Math.min(idleTimeoutMs, 30_000));
  const cleanupTimer = setInterval(() => {
    const expirationTime = Date.now() - idleTimeoutMs;

    for (const [sessionId, session] of sessions.entries()) {
      if (session.lastActivityAt <= expirationTime) {
        void destroySession(sessionId);
      }
    }
  }, cleanupIntervalMs);

  cleanupTimer.unref?.();

  return {
    handlePostRequest: async (request, response) => {
      const sessionId = getHeaderValue(request.headers["mcp-session-id"]);
      let parsedBody: unknown;

      try {
        parsedBody = await parseJsonBody(request);
      } catch {
        sendPlainText(response, 400, "Bad Request");
        return;
      }

      if (sessionId) {
        const session = sessions.get(sessionId);

        if (!session || isExpired(session, idleTimeoutMs)) {
          await destroySession(sessionId);
          sendPlainText(response, 404, "Session not found");
          return;
        }

        touchSession(session);
        await session.transport.handleRequest(request, response, parsedBody);
        return;
      }

      if (!isInitializeRequest(parsedBody)) {
        sendJsonRpcError(response, 400, "Bad Request: No valid session ID provided");
        return;
      }

      const session = createStatefulSessionState(serverFactory, sessions);

      try {
        await session.serverInstance.server.connect(session.transport);
        await session.transport.handleRequest(request, response, parsedBody);
      } catch (error) {
        await closeSessionState(session);
        throw error;
      }

      if (!session.sessionId) {
        await closeSessionState(session);
      }
    },
    handleDeleteRequest: async (request, response) => {
      const sessionId = getHeaderValue(request.headers["mcp-session-id"]);

      if (!sessionId) {
        sendPlainText(response, 404, "Session not found");
        return;
      }

      const session = sessions.get(sessionId);
      if (!session || isExpired(session, idleTimeoutMs)) {
        await destroySession(sessionId);
        sendPlainText(response, 404, "Session not found");
        return;
      }

      touchSession(session);
      await session.transport.handleRequest(request, response);
      await destroySession(sessionId);
    },
    close: async () => {
      clearInterval(cleanupTimer);
      await Promise.all(Array.from(sessions.keys()).map((sessionId) => destroySession(sessionId)));
    },
  };

  async function destroySession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    sessions.delete(sessionId);
    await closeSessionState(session);
  }
}

function createStatefulSessionState(serverFactory: McpServerFactory, sessions: Map<string, SessionState>): SessionState {
  let session: SessionState;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      session.sessionId = sessionId;
      touchSession(session);
      sessions.set(sessionId, session);
    },
  });

  session = createHostedSessionState(serverFactory, transport);
  transport.onclose = () => {
    if (session.sessionId) {
      sessions.delete(session.sessionId);
    }
    session.closed = true;
  };

  return session;
}

function createStatelessSessionState(serverFactory: McpServerFactory): SessionState {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const session = createHostedSessionState(serverFactory, transport);

  transport.onclose = () => {
    session.closed = true;
  };

  return session;
}

function createHostedSessionState(serverFactory: McpServerFactory, transport: StreamableHTTPServerTransport): SessionState {
  return {
    serverInstance: serverFactory({ deploymentMode: "hosted" }),
    transport,
    lastActivityAt: Date.now(),
    closed: false,
  };
}

function touchSession(session: SessionState): void {
  session.lastActivityAt = Date.now();
}

function isExpired(session: SessionState, idleTimeoutMs: number): boolean {
  return Date.now() - session.lastActivityAt >= idleTimeoutMs;
}

async function closeSessionState(session: SessionState): Promise<void> {
  if (session.closed) {
    return;
  }

  session.closed = true;

  try {
    await session.transport.close();
  } catch (error) {
    logger.error("Failed to close streamable-http transport:", error);
  }

  try {
    await session.serverInstance.server.close();
  } catch (error) {
    logger.error("Failed to close MCP server session:", error);
  }
}

async function parseJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const body = Buffer.concat(chunks).toString("utf-8").trim();

  if (!body) {
    return undefined;
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Failed to parse HTTP request body as JSON.");
  }
}

function hasValidAuthorizationHeader(request: IncomingMessage, expectedToken: string): boolean {
  const headerValue = getHeaderValue(request.headers.authorization);
  if (!headerValue?.startsWith("Bearer ")) {
    return false;
  }

  const presentedToken = headerValue.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(expectedToken, "utf-8");
  const presentedBuffer = Buffer.from(presentedToken, "utf-8");

  if (expectedBuffer.length !== presentedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, presentedBuffer);
}

function isAllowedOrigin(request: IncomingMessage, allowedOrigins: Set<string>): boolean {
  const origin = getHeaderValue(request.headers.origin);
  if (!origin) {
    return true;
  }

  return allowedOrigins.has(origin);
}

function getHeaderValue(header: string | string[] | undefined): string | undefined {
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
}

function createAsyncOnce(action: () => Promise<void>): () => Promise<void> {
  let result: Promise<void> | undefined;

  return () => {
    result ??= action();
    return result;
  };
}

function sendMethodNotAllowed(response: ServerResponse, allowHeaderValue: string): void {
  response.setHeader("Allow", allowHeaderValue);
  sendPlainText(response, 405, "Method Not Allowed");
}

function sendPlainText(response: ServerResponse, statusCode: number, message: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(message);
}

function sendJsonRpcError(response: ServerResponse, statusCode: number, message: string): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message,
      },
      id: null,
    })
  );
}

function getRequestUrl(request: IncomingMessage): URL {
  const host = getHeaderValue(request.headers.host) ?? "127.0.0.1";
  return new URL(request.url ?? "/", `http://${host}`);
}

function buildServerUrl(host: string, port: number, path: string): string {
  const normalizedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}${path}`;
}

async function listen(server: NodeHttpServer, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeNodeServer(server: NodeHttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
