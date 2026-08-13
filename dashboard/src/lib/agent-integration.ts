export const INTEGRATION_TYPES = ["CLAUDE_CODE", "CODEX", "CURSOR", "MCP", "LANGCHAIN", "CUSTOM"] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const INTEGRATION_CREDENTIAL_PREFIX = "agentpay:integration:";

export const INTEGRATION_META: Record<IntegrationType, { name: string; description: string; transport: string }> = {
  CLAUDE_CODE: { name: "Claude Code", description: "Connect Claude Code through AgentPay's hosted MCP endpoint.", transport: "Remote MCP" },
  CODEX: { name: "Codex", description: "Connect Codex CLI, IDE, or desktop through AgentPay's hosted MCP endpoint.", transport: "Remote MCP" },
  CURSOR: { name: "Cursor", description: "Give Cursor Agent access to AgentPay payment tools through MCP.", transport: "Remote MCP" },
  MCP: { name: "MCP client", description: "Connect any client that supports Streamable HTTP MCP.", transport: "Remote MCP" },
  LANGCHAIN: { name: "LangChain / framework", description: "Use AgentPay from an agent framework through the HTTP API or adapter.", transport: "REST / SDK" },
  CUSTOM: { name: "Custom AI", description: "Connect any runtime that can make authenticated HTTPS requests.", transport: "REST" },
};

export function integrationCredentialLabel(type: IntegrationType, name?: string) {
  const normalized = (name ?? INTEGRATION_META[type].name).trim().replace(/\s+/g, " ").slice(0, 38);
  return `${INTEGRATION_CREDENTIAL_PREFIX}${type}:${normalized}`.slice(0, 80);
}

export function parseIntegrationCredentialLabel(label: string): { type: IntegrationType; name: string } | null {
  if (!label.startsWith(INTEGRATION_CREDENTIAL_PREFIX)) return null;
  const value = label.slice(INTEGRATION_CREDENTIAL_PREFIX.length);
  const separator = value.indexOf(":");
  if (separator < 0) return null;
  const type = value.slice(0, separator) as IntegrationType;
  if (!INTEGRATION_TYPES.includes(type)) return null;
  const name = value.slice(separator + 1).trim() || INTEGRATION_META[type].name;
  return { type, name };
}

export type IntegrationSetup = {
  endpoint: string;
  environment: { bash: string; powershell: string };
  primary: { title: string; filename?: string; code: string; warning?: string };
  secondary: Array<{ title: string; filename?: string; code: string; warning?: string }>;
};

export function buildIntegrationSetup(
  type: IntegrationType,
  input: { baseUrl: string; agentId: string; credential: string },
): IntegrationSetup {
  const baseUrl = input.baseUrl.replace(/\/$/, "");
  const endpoint = `${baseUrl}/api/v1/agents/${input.agentId}/mcp`;
  const environment = {
    bash: `export AGENTPAY_API_KEY='${input.credential}'`,
    powershell: `$env:AGENTPAY_API_KEY = "${input.credential}"`,
  };

  if (type === "CLAUDE_CODE") {
    return {
      endpoint,
      environment,
      primary: {
        title: "Claude Code project configuration",
        filename: ".mcp.json",
        code: JSON.stringify({ mcpServers: { agentpay: { type: "http", url: endpoint, headers: { Authorization: "Bearer ${AGENTPAY_API_KEY}" } } } }, null, 2),
        warning: "Keep AGENTPAY_API_KEY outside source control. The credential is not a Cardano private key and can be revoked from AgentPay.",
      },
      secondary: [{ title: "Verify in Claude Code", code: "claude mcp get agentpay\n# Then start Claude Code and use /mcp" }],
    };
  }

  if (type === "CODEX") {
    return {
      endpoint,
      environment,
      primary: {
        title: "Codex project configuration",
        filename: ".codex/config.toml",
        code: `[mcp_servers.agentpay]\nurl = "${endpoint}"\nbearer_token_env_var = "AGENTPAY_API_KEY"\nrequired = true\ndefault_tools_approval_mode = "writes"`,
        warning: "Set AGENTPAY_API_KEY before starting Codex. AgentPay still enforces its own server-side payment policy.",
      },
      secondary: [{ title: "Verify in Codex", code: "codex mcp list\n# In the Codex TUI use /mcp" }],
    };
  }

  if (type === "CURSOR") {
    return {
      endpoint,
      environment,
      primary: {
        title: "Cursor project configuration",
        filename: ".cursor/mcp.json",
        code: JSON.stringify({ mcpServers: { agentpay: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${input.credential}` } } } }, null, 2),
        warning: "This snippet contains the one-time AgentPay credential. Keep the file private or move the server to a user-level Cursor configuration.",
      },
      secondary: [{ title: "Verify in Cursor CLI", code: "cursor-agent mcp list\ncursor-agent mcp list-tools agentpay" }],
    };
  }

  if (type === "MCP") {
    return {
      endpoint,
      environment,
      primary: {
        title: "Streamable HTTP MCP configuration",
        filename: "mcp.json",
        code: JSON.stringify({ mcpServers: { agentpay: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${input.credential}` } } } }, null, 2),
        warning: "MCP clients vary in environment-variable interpolation. If you store the credential directly, keep the configuration private.",
      },
      secondary: [],
    };
  }

  if (type === "LANGCHAIN") {
    return {
      endpoint,
      environment,
      primary: {
        title: "Framework HTTP tool",
        filename: "agentpay-tool.ts",
        code: `const AGENTPAY_URL = ${JSON.stringify(baseUrl)};\nconst AGENTPAY_AGENT_ID = ${JSON.stringify(input.agentId)};\n\nexport async function purchaseWithAgentPay(input: { resourceUrl: string; purpose?: string; maxAmountAtomic?: string }, idempotencyKey: string) {\n  const response = await fetch(\`${baseUrl}/api/v1/agents/${input.agentId}/paid-requests\`, {\n    method: "POST",\n    headers: {\n      authorization: \`Bearer \${process.env.AGENTPAY_API_KEY}\`,\n      "content-type": "application/json",\n      "idempotency-key": idempotencyKey,\n    },\n    body: JSON.stringify(input),\n  });\n  const body = await response.json();\n  if (!response.ok) throw new Error(body.detail ?? "AgentPay request failed");\n  return body.data;\n}`,
        warning: "Wrap this function with your framework's normal tool abstraction. Keep idempotencyKey stable when retrying the same intended purchase.",
      },
      secondary: [],
    };
  }

  return {
    endpoint,
    environment,
    primary: {
      title: "Custom HTTPS integration",
      code: `POST ${baseUrl}/api/v1/agents/${input.agentId}/paid-requests\nAuthorization: Bearer $AGENTPAY_API_KEY\nContent-Type: application/json\nIdempotency-Key: <stable-unique-key>\n\n{\n  "resourceUrl": "https://provider.example/resource",\n  "purpose": "Why the agent needs this purchase",\n  "maxAmountAtomic": "1000000"\n}`,
    },
    secondary: [{ title: "Read connection status", code: `GET ${baseUrl}/api/v1/agents/${input.agentId}/connection\nAuthorization: Bearer $AGENTPAY_API_KEY` }],
  };
}
