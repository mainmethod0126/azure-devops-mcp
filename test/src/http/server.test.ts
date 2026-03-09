// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createServer as createNetServer } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";

import { startStreamableHttpServer, type StreamableHttpServerHandle } from "../../../src/http/server";
import type { McpServerFactory } from "../../../src/runtime/types";
import { UserAgentComposer } from "../../../src/useragent";

const AUTH_TOKEN = "test-secret";

describe("startStreamableHttpServer", () => {
  let server: StreamableHttpServerHandle | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns 404 for the wrong path", async () => {
    server = await startTestServer();

    const response = await fetch(server.url.replace("/mcp", "/wrong"), {
      method: "POST",
      headers: createHeaders(),
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
  });

  it("returns 405 for GET requests", async () => {
    server = await startTestServer();

    const response = await fetch(server.url, {
      method: "GET",
      headers: createHeaders(),
    });

    expect(response.status).toBe(405);
  });

  it("returns 401 when the bearer token is missing or invalid", async () => {
    server = await startTestServer();

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

  it("returns 403 when the request origin is not allowed", async () => {
    server = await startTestServer({
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

  it("returns 400 when a non-initialize POST omits the session id", async () => {
    server = await startTestServer();

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

  it("supports initialize and tools/list through the streamable HTTP client transport", async () => {
    server = await startTestServer();

    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
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

    expect(transport.sessionId).toBeDefined();
    expect(tools.tools.some((tool) => tool.name === "test_echo")).toBe(true);

    await client.close();
  });

  it("returns 404 after a session is explicitly deleted", async () => {
    server = await startTestServer();
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

  it("expires idle sessions and allows a new session to start afterwards", async () => {
    server = await startTestServer({
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
});

async function startTestServer(overrides: Partial<TestServerOptions> = {}): Promise<StreamableHttpServerHandle> {
  const options: TestServerOptions = {
    host: "127.0.0.1",
    port: await findAvailablePort(),
    path: "/mcp",
    authToken: AUTH_TOKEN,
    allowedOrigins: [],
    sessionIdleTimeoutSeconds: 30,
    ...overrides,
  };

  return startStreamableHttpServer({
    host: options.host,
    port: options.port,
    path: options.path,
    authToken: options.authToken,
    allowedOrigins: options.allowedOrigins,
    sessionIdleTimeoutSeconds: options.sessionIdleTimeoutSeconds,
    serverFactory: createTestServerFactory(),
  });
}

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
  sessionIdleTimeoutSeconds: number;
}
