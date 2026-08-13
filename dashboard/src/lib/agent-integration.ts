export const INTEGRATION_TYPES = ["CLAUDE_CODE", "CODEX", "CURSOR", "MCP", "LANGCHAIN", "CUSTOM"] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const INTEGRATION_CREDENTIAL_PREFIX = "agentpay:integration:";

export const INTEGRATION_META: Record<IntegrationType, { name: string; description: string; transport: string }> = {
  CLAUDE_CODE: { name: "Claude Code", description: "Connect Claude Code through AgentPay MCP tools.", transport: "MCP" },
  CODEX: { name: "Codex", description: "Connect Codex CLI, IDE, or desktop through AgentPay MCP tools.", transport: "MCP" },
  CURSOR: { name: "Cursor", description: "Give Cursor Agent access to AgentPay payment tools through MCP.", transport: "MCP" },
  MCP: { name: "MCP client", description: "Connect any client that supports MCP.", transport: "MCP" },
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
