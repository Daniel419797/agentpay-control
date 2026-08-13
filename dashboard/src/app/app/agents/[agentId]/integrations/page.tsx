import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CredentialManager } from "@/components/credential-manager";
import { FormPage } from "@/components/workspace-page";
import { INTEGRATION_META, INTEGRATION_TYPES, integrationCredentialLabel, parseIntegrationCredentialLabel, type IntegrationType } from "@/lib/agent-integration";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

function originFromHeaders(values: Headers) {
  const host = values.get("x-forwarded-host") ?? values.get("host");
  const proto = values.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

function setupFor(type: IntegrationType, endpoint: string, agentId: string, apiBase: string) {
  if (type === "CLAUDE_CODE") return {
    filename: ".mcp.json",
    code: JSON.stringify({ mcpServers: { agentpay: { type: "http", url: endpoint, headers: { Authorization: "Bearer ${AGENTPAY_API_KEY}" } } } }, null, 2),
    verify: "claude mcp get agentpay\n# Then start Claude Code and use /mcp",
    note: "Set AGENTPAY_API_KEY in your shell before starting Claude Code. Do not commit the AgentPay credential.",
  };
  if (type === "CODEX") return {
    filename: ".codex/config.toml",
    code: `[mcp_servers.agentpay]\nurl = "${endpoint}"\nbearer_token_env_var = "AGENTPAY_API_KEY"\nrequired = true\ndefault_tools_approval_mode = "writes"`,
    verify: "codex mcp list\n# In the Codex TUI use /mcp",
    note: "Set AGENTPAY_API_KEY before starting Codex. Codex approval settings and AgentPay financial policy are separate controls.",
  };
  if (type === "CURSOR") return {
    filename: ".cursor/mcp.json",
    code: JSON.stringify({ mcpServers: { agentpay: { type: "http", url: endpoint, headers: { Authorization: "Bearer <paste AgentPay credential here>" } } } }, null, 2),
    verify: "cursor-agent mcp list\ncursor-agent mcp list-tools agentpay",
    note: "Keep the Cursor MCP configuration private when it contains the credential.",
  };
  if (type === "MCP") return {
    filename: "mcp.json",
    code: JSON.stringify({ mcpServers: { agentpay: { type: "http", url: endpoint, headers: { Authorization: "Bearer <AgentPay credential>" } } } }, null, 2),
    verify: "Initialize the MCP server, list tools, then call agentpay_get_connection_status.",
    note: "Use Streamable HTTP and send the AgentPay credential as a Bearer authorization header.",
  };
  if (type === "LANGCHAIN") return {
    filename: "agentpay-tool.ts",
    code: `const AGENTPAY_URL = ${JSON.stringify(apiBase)};\nconst AGENTPAY_AGENT_ID = ${JSON.stringify(agentId)};\n\nexport async function purchaseWithAgentPay(input, idempotencyKey) {\n  const response = await fetch(\`${apiBase}/api/v1/agents/${agentId}/paid-requests\`, {\n    method: "POST",\n    headers: {\n      authorization: \`Bearer \${process.env.AGENTPAY_API_KEY}\`,\n      "content-type": "application/json",\n      "idempotency-key": idempotencyKey,\n    },\n    body: JSON.stringify(input),\n  });\n  const body = await response.json();\n  if (!response.ok) throw new Error(body.detail ?? "AgentPay request failed");\n  return body.data;\n}`,
    verify: `GET ${apiBase}/api/v1/agents/${agentId}/connection with the same Bearer credential`,
    note: "Wrap this function in your framework's normal tool abstraction. Reuse the idempotency key when retrying the same intended purchase.",
  };
  return {
    filename: "HTTPS API",
    code: `POST ${apiBase}/api/v1/agents/${agentId}/paid-requests\nAuthorization: Bearer <AgentPay credential>\nContent-Type: application/json\nIdempotency-Key: <stable unique key>\n\n{\n  "resourceUrl": "https://provider.example/resource",\n  "purpose": "Why the agent needs this purchase",\n  "maxAmountAtomic": "1000000"\n}`,
    verify: `GET ${apiBase}/api/v1/agents/${agentId}/connection\nAuthorization: Bearer <AgentPay credential>`,
    note: "Any AI runtime that can make authenticated HTTPS requests can use this integration; it does not need an AgentPay-specific framework adapter.",
  };
}

function formatDate(value: Date | null) {
  return value ? value.toLocaleString() : "Never";
}

export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const [{ agentId }, query, workspace, requestHeaders] = await Promise.all([params, searchParams, currentWorkspace(), headers()]);
  if (!workspace) notFound();
  const selectedType = INTEGRATION_TYPES.includes(query.type as IntegrationType) ? query.type as IntegrationType : "CLAUDE_CODE";
  const agent = await db.agent.findFirst({
    where: { id: agentId, organizationId: workspace.organization.id },
    include: { effectivePolicy: true, accounts: { take: 1 } },
  });
  if (!agent) notFound();
  const credentials = await db.agentCredential.findMany({
    where: { agentId },
    select: { id: true, label: true, prefix: true, scopes: true, status: true, expiresAt: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const origin = originFromHeaders(requestHeaders);
  const endpoint = `${origin}/api/v1/agents/${agentId}/mcp`;
  const setup = setupFor(selectedType, endpoint, agentId, origin);
  const suggestedLabel = integrationCredentialLabel(selectedType, INTEGRATION_META[selectedType].name);
  const connectionCredentials = credentials.flatMap((credential) => {
    const parsed = parseIntegrationCredentialLabel(credential.label);
    return parsed ? [{ ...credential, ...parsed }] : [];
  });
  const blockers = [
    ...(agent.status === "ACTIVE" ? [] : ["Agent is not active"]),
    ...(agent.accounts[0]?.status === "ACTIVE" ? [] : ["Payment account is not active"]),
    ...(agent.effectivePolicy?.status === "PUBLISHED" ? [] : ["No published spending policy"]),
    ...(workspace.organization.killSwitchEnabled ? ["Organization emergency stop is active"] : []),
  ];
  const ready = blockers.length === 0;

  return <FormPage title={`${agent.name} · AI connections`} description="Connect Claude Code, Codex, Cursor, MCP clients, agent frameworks, or any HTTPS-capable AI runtime without exposing wallet signing keys.">
    <section className="workspace-section">
      <div className="section-heading"><div><h3>1. Choose the client</h3><p>The payment identity and policy stay the same; only the client configuration changes.</p></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        {INTEGRATION_TYPES.map((type) => <Link
          key={type}
          href={`/app/agents/${agentId}/integrations?type=${type}`}
          className={type === selectedType ? "primary-button" : "secondary-button"}
          style={{ display: "block", minHeight: 94 }}
        >
          <strong style={{ display: "block" }}>{INTEGRATION_META[type].name}</strong>
          <span style={{ display: "block", fontSize: 12, marginTop: 6, opacity: 0.8 }}>{INTEGRATION_META[type].transport}</span>
        </Link>)}
      </div>
    </section>

    <section className="workspace-section">
      <div className="section-heading"><div><h3>2. Financial readiness</h3><p>AgentPay does not treat a client as payment-ready until the account, agent and published policy are active.</p></div></div>
      {ready ? <div className="form-success">Ready for an external AI connection. Every paid request will pass through the published policy before signing.</div> : <div className="form-error">{blockers.join(" · ")}</div>}
      <div className="button-row" style={{ marginTop: 12 }}>
        <Link className="secondary-button" href={`/app/agents/${agentId}/policy`}>{agent.effectivePolicy ? "Review policy" : "Publish spending policy"}</Link>
        <Link className="secondary-button" href={`/app/agents/${agentId}`}>Agent details</Link>
      </div>
    </section>

    <section className="workspace-section">
      <div className="section-heading"><div><h3>3. Create a scoped connection credential</h3><p>Create one credential per AI client so each connection can be independently revoked and its authenticated activity tracked.</p></div></div>
      <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
        <strong>Suggested label</strong>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{suggestedLabel}</pre>
        <p className="form-help">Use this label if you want AgentPay to classify the credential as {INTEGRATION_META[selectedType].name}. Select payments:create, payments:read and resources:read for the complete connection.</p>
      </div>
      {ready ? <CredentialManager key={selectedType} agentId={agentId} existing={credentials} /> : <p className="form-help">Credential issuance is shown after financial readiness is complete. This avoids presenting an AI client as connected before it can operate under policy.</p>}
    </section>

    <section className="workspace-section">
      <div className="section-heading"><div><h3>4. Configure {INTEGRATION_META[selectedType].name}</h3><p>Use the one-time credential from the previous step as AGENTPAY_API_KEY or the private Bearer value shown below.</p></div></div>
      <div className="panel" style={{ padding: 14, marginBottom: 12 }}><strong>MCP endpoint</strong><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{endpoint}</pre></div>
      <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
        <strong>{setup.filename}</strong>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{setup.code}</pre>
        <p className="form-help">{setup.note}</p>
      </div>
      <div className="panel" style={{ padding: 14 }}><strong>Verify from the AI client</strong><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{setup.verify}</pre></div>
    </section>

    <section className="workspace-section">
      <div className="section-heading"><div><h3>Connection activity</h3><p>CONNECTED is based on actual credential use. AgentPay does not manufacture heartbeat status.</p></div></div>
      {connectionCredentials.length ? <div className="record-list">
        {connectionCredentials.map((credential) => <div className="record-row" key={credential.id}>
          <div>
            <div className="record-title">{credential.name} · {INTEGRATION_META[credential.type].name}</div>
            <div className="record-subtitle">{credential.status} · {credential.lastUsedAt ? "CONNECTED" : "READY"} · Last authenticated: {formatDate(credential.lastUsedAt)}</div>
          </div>
        </div>)}
      </div> : <div className="empty-state"><strong>No classified AI connections yet</strong><p>Create a credential using the suggested AgentPay integration label above. Generic credentials continue to work through REST and MCP.</p></div>}
    </section>
  </FormPage>;
}
