// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { buildCliConfig } from "../../../src/bootstrap/config";

describe("buildCliConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CODESPACES;
    delete process.env.CODESPACE_NAME;
    delete process.env.ADO_MCP_HTTP_AUTH_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("defaults to stdio with interactive authentication outside Codespaces", () => {
    const config = buildCliConfig(createParsedArgs());

    expect(config.organization).toBe("contoso");
    expect(config.transport).toBe("stdio");
    expect(config.authentication).toBe("interactive");
    expect(config.domains).toEqual(["all"]);
    expect(config.http.host).toBe("127.0.0.1");
    expect(config.http.path).toBe("/mcp");
  });

  it("requires a static bearer token for streamable-http mode", () => {
    expect(() => buildCliConfig(createParsedArgs({ transport: "streamable-http" }))).toThrow(
      "HTTP transport requires --http-auth-token or the ADO_MCP_HTTP_AUTH_TOKEN environment variable."
    );
  });

  it("uses the environment variable fallback for the HTTP auth token", () => {
    process.env.ADO_MCP_HTTP_AUTH_TOKEN = "env-secret";

    const config = buildCliConfig(
      createParsedArgs({
        transport: "streamable-http",
      })
    );

    expect(config.http.authToken).toBe("env-secret");
  });

  it("defaults hosted streamable-http authentication to env on non-loopback hosts", () => {
    const config = buildCliConfig(
      createParsedArgs({
        transport: "streamable-http",
        httpHost: "0.0.0.0",
        httpAuthToken: "secret",
      })
    );

    expect(config.authentication).toBe("env");
    expect(config.http.isHosted).toBe(true);
  });

  it("rejects interactive authentication when streamable-http binds to a non-loopback host", () => {
    expect(() =>
      buildCliConfig(
        createParsedArgs({
          transport: "streamable-http",
          httpHost: "0.0.0.0",
          httpAuthToken: "secret",
          authentication: "interactive",
        })
      )
    ).toThrow("Interactive authentication is not allowed when streamable-http binds to a non-loopback host. Use 'env' or 'envvar'.");
  });

  it("rejects non-env authentication types for hosted streamable-http mode", () => {
    expect(() =>
      buildCliConfig(
        createParsedArgs({
          transport: "streamable-http",
          httpHost: "0.0.0.0",
          httpAuthToken: "secret",
          authentication: "azcli",
        })
      )
    ).toThrow("Authentication 'azcli' is not allowed when streamable-http binds to a non-loopback host. Use 'env' or 'envvar'.");
  });

  it("keeps local defaults for loopback streamable-http mode", () => {
    const config = buildCliConfig(
      createParsedArgs({
        transport: "streamable-http",
        httpHost: "127.0.0.1",
        httpAuthToken: "secret",
      })
    );

    expect(config.authentication).toBe("interactive");
    expect(config.http.isHosted).toBe(false);
  });

  it("normalizes the HTTP path and allowed origins", () => {
    const config = buildCliConfig(
      createParsedArgs({
        transport: "streamable-http",
        httpAuthToken: "secret",
        httpPath: "custom",
        httpAllowedOrigin: [" https://example.com ", ""],
        domains: [" repositories ", "WIKI"],
      })
    );

    expect(config.http.path).toBe("/custom");
    expect(config.http.allowedOrigins).toEqual(["https://example.com"]);
    expect(config.domains).toEqual(["repositories", "wiki"]);
  });
});

function createParsedArgs(overrides: Partial<Parameters<typeof buildCliConfig>[0]> = {}): Parameters<typeof buildCliConfig>[0] {
  return {
    organization: "contoso",
    transport: "stdio",
    domains: ["all"],
    authentication: undefined,
    tenant: undefined,
    httpHost: "127.0.0.1",
    httpPort: 3001,
    httpPath: "/mcp",
    httpAuthToken: undefined,
    httpAllowedOrigin: [],
    httpSessionIdleTimeoutSeconds: 1800,
    ...overrides,
  };
}
