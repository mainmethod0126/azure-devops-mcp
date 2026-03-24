// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer as createNetServer } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { startStreamableHttpServer, type StreamableHttpServerHandle } from "../../../src/http/server";
import type { HttpSessionMode, McpServerFactory } from "../../../src/runtime/types";
import { UserAgentComposer } from "../../../src/useragent";

const AUTH_TOKEN = "test-secret";

describe("startStreamableHttpServer", () => {
  let servers: StreamableHttpServerHandle[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers = [];
  });

  it.each([
    { sessionMode: "stateful" as const },
    { sessionMode: "stateless" as const },
  ])("returns 404 for the wrong path in $sessionMode mode", async ({ sessionMode }) => {
    const server = await startTestServer({ sessionMode });

    const response = await fetch(server.url.replace("/mcp", "/wrong"), {
      method: "POST",
      headers: createHeaders(),
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
  });

  it.each([
    { sessionMode: "stateful" as const, allow: "POST, DELETE" },
    { sessionMode: "stateless" as const, allow: "POST" },
  ])("returns 405 for GET requests in $sessionMode mode", async ({ sessionMode, allow }) => {
    const server = await startTestServer({ sessionMode });

    const response = await fetch(server.url, {
      method: "GET",
      headers: createHeaders(),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(allow);
  });

  it.each([
    { sessionMode: "stateful" as const },
    { sessionMode: "stateless" as const },
  ])("returns 401 when the bearer token is missing or invalid in $sessionMode mode", async ({ sessionMode }) => {
    const server = await startTestServer({ sessionMode });

    const missingTokenResponse = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const invalidTokenResponse = await fetch(server.url, {
      method: "POST",
      headers: createHeaders({
        Authorization: "Bearer wrong-token",
      }),
      body: JSON.stringify({}),
    });

    expect(missingTokenResponse.status).toBe(401);
    expect(invalidTokenResponse.status).toBe(401);
  });

  it.each([
    { sessionMode: "stateful" as const },
    { sessionMode: "stateless" as const },
  ])("returns 403 when the request origin is not allowed in $sessionMode mode", async ({ sessionMode }) => {
    const server = await startTestServer({
      sessionMode,
      allowedOrigins: ["https://allowed.example"],
    });

    const response = await fetch(server.url, {
      method: "POST",
      headers: createHeaders({
        Origin: "https://blocked.example",
      }),
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(403);
  });

  it("returns 400 when a stateful non-initialize POST omits the session id", async () => {
    const server = await startTestServer({ sessionMode: "stateful" });

    const response = await fetch(server.url, {
      method: "POST",
      headers: createHeaders(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Bad Request: No valid session ID provided",
      },
    });
  });

  it("supports initialize and tools/list through the stateful streamable HTTP client transport", async () => {
    const server = await startTestServer({ sessionMode: "stateful" });
    const { client, transport } = await connectClient(server.url);
    const tools = await client.listTools();

    expect(transport.sessionId).toBeDefined();
    expect(tools.tools.some((tool) => tool.name === "test_echo")).toBe(true);

    await client.close();
  });

  it("returns 404 after a stateful session is explicitly deleted", async () => {
    const server = await startTestServer({ sessionMode: "stateful" });
    const { client, transport } = await connectClient(server.url);
    const sessionId = transport.sessionId;

    expect(sessionId).toBeDefined();

    const deleteResponse = await fetch(server.url, {
      method: "DELETE",
      headers: createHeaders({
        "MCP-Session-Id": sessionId!,
      }),
    });

    expect(deleteResponse.ok).toBe(true);

    const expiredSessionResponse = await fetch(server.url, {
      method: "POST",
      headers: createHeaders({
        "MCP-Session-Id": sessionId!,
      }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
    });

    expect(expiredSessionResponse.status).toBe(404);

    await client.close();
  });

  it("expires idle stateful sessions and allows a new session to start afterwards", async () => {
    const server = await startTestServer({
      sessionMode: "stateful",
      sessionIdleTimeoutSeconds: 1,
    });

    const { client, transport } = await connectClient(server.url);
    const expiredSessionId = transport.sessionId;

    expect(expiredSessionId).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 1_200));

    const expiredSessionResponse = await fetch(server.url, {
      method: "POST",
      headers: createHeaders({
        "MCP-Session-Id": expiredSessionId!,
      }),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {},
      }),
    });

    expect(expiredSessionResponse.status).toBe(404);

    await client.close();

    const nextConnection = await connectClient(server.url);
    expect(nextConnection.transport.sessionId).toBeDefined();
    expect(nextConnection.transport.sessionId).not.toBe(expiredSessionId);

    await nextConnection.client.close();
  });

  it("supports initialize and tools/list without a session id in stateless mode", async () => {
    const server = await startTestServer({ sessionMode: "stateless" });
    const { client, transport } = await connectClient(server.url);
    const tools = await client.listTools();

    expect(transport.sessionId).toBeUndefined();
    expect(tools.tools.some((tool) => tool.name === "test_echo")).toBe(true);

    await client.close();
  });

  it("returns 405 for DELETE requests in stateless mode", async () => {
    const server = await startTestServer({ sessionMode: "stateless" });

    const response = await fetch(server.url, {
      method: "DELETE",
      headers: createHeaders(),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("supports stateless clients across multiple replicas without sticky routing", async () => {
    const firstServer = await startTestServer({ sessionMode: "stateless" });
    const secondServer = await startTestServer({ sessionMode: "stateless" });
    const routedHosts: string[] = [];
    const transport = new StreamableHTTPClientTransport(new URL(firstServer.url), {
      fetch: createAlternatingFetch([firstServer.url, secondServer.url], routedHosts),
      requestInit: {
        headers: createHeaders(),
      },
    });
    const client = new Client({
      name: "Jest",
      version: "1.0.0",
    });

    await client.connect(transport);
    const tools = await client.listTools();

    expect(transport.sessionId).toBeUndefined();
    expect(tools.tools.some((tool) => tool.name === "test_echo")).toBe(true);
    expect(new Set(routedHosts).size).toBeGreaterThan(1);

    await client.close();
  });

  async function startTestServer(overrides: Partial<TestServerOptions> = {}): Promise<StreamableHttpServerHandle> {
    const options: TestServerOptions = {
      host: "127.0.0.1",
      port: await findAvailablePort(),
      path: "/mcp",
      authToken: AUTH_TOKEN,
      allowedOrigins: [],
      sessionMode: "stateful",
      sessionIdleTimeoutSeconds: 30,
      ...overrides,
    };

    const server = await startStreamableHttpServer({
      host: options.host,
      port: options.port,
      path: options.path,
      authToken: options.authToken,
      allowedOrigins: options.allowedOrigins,
      sessionMode: options.sessionMode,
      sessionIdleTimeoutSeconds: options.sessionIdleTimeoutSeconds,
      serverFactory: createTestServerFactory(),
    });

    servers.push(server);

    return server;
  }
});

async function connectClient(url: string): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
}> {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: createHeaders(),
    },
  });
  const client = new Client({
    name: "Jest",
    version: "1.0.0",
  });

  await client.connect(transport);

  return {
    client,
    transport,
  };
}

function createTestServerFactory(): McpServerFactory {
  return ({ deploymentMode } = {}) => {
    const server = new McpServer({
      name: "Test Server",
      version: "1.0.0",
    });

    server.registerTool(
      "test_echo",
      {
        description: "Returns a fixed response for testing.",
      },
      async () => ({
        content: [
          {
            type: "text",
            text: "ok",
          },
        ],
      })
    );

    return {
      server,
      userAgentComposer: new UserAgentComposer("1.0.0", deploymentMode ?? "local"),
    };
  };
}

function createHeaders(extraHeaders: Record<string, string> = {}): HeadersInit {
  return {
    "Authorization": `Bearer ${AUTH_TOKEN}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
}

function createAlternatingFetch(urls: string[], routedHosts: string[]): typeof fetch {
  let nextIndex = 0;

  return async (input, init) => {
    const requestUrl = toUrl(input);
    const targetBaseUrl = new URL(urls[nextIndex % urls.length]);
    const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, targetBaseUrl);

    nextIndex += 1;
    routedHosts.push(targetUrl.host);

    return fetch(targetUrl, init);
  };
}

function toUrl(input: string | URL | Request): URL {
  if (input instanceof URL) {
    return input;
  }

  if (input instanceof Request) {
    return new URL(input.url);
  }

  return new URL(input);
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine an available port.")));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

interface TestServerOptions {
  host: string;
  port: number;
  path: string;
  authToken: string;
  allowedOrigins: string[];
  sessionMode: HttpSessionMode;
  sessionIdleTimeoutSeconds: number;
}
