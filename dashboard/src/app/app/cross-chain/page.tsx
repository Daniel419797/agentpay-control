import { CrossChainOperations } from "@/components/cross-chain-operations";
import { WorkspacePage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function CrossChainPage() {
  const workspace = await currentWorkspace();
  const organizationId = workspace?.organization.id;
  const [rows, agents, networks] = organizationId ? await Promise.all([
    db.crossChainTransfer.findMany({ where: { organizationId }, include: { quote: { include: { sourceNetwork: true, destinationNetwork: true } }, agent: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.agent.findMany({ where: { organizationId, status: "ACTIVE", network: { startsWith: "eip155:" }, accounts: { some: { status: "ACTIVE", evmAddress: { not: null } } } }, include: { accounts: { where: { status: "ACTIVE", evmAddress: { not: null } }, select: { network: true, evmAddress: true } } }, orderBy: { name: "asc" } }),
    db.chainNetwork.findMany({ where: { enabled: true, family: "EVM" }, select: { id: true, displayName: true, testnet: true }, orderBy: [{ testnet: "desc" }, { displayName: "asc" }] }),
  ]) : [[], [], []];

  return <WorkspacePage
      title="Cross-chain"
      description="Wallet-signed bridge routes with independent source and destination confirmation."
      empty="Prepared and submitted bridge transfers will appear here."
      rows={rows.map((transfer) => ({
        id: transfer.id,
        title: `${transfer.quote.sourceNetwork.displayName} → ${transfer.quote.destinationNetwork.displayName}`,
        subtitle: `${transfer.agent.name} · ${transfer.sourceTransactionHash ?? "Awaiting wallet signature"}`,
        meta: `${transfer.quote.inputAmountAtomic} ${transfer.quote.sourceToken} → ${transfer.quote.estimatedOutputAtomic} ${transfer.quote.destinationToken}`,
        status: transfer.status,
      }))}
    >
    <CrossChainOperations
      agents={agents.flatMap((agent) => {
        const account = agent.accounts.find((candidate) => candidate.network === agent.network && candidate.evmAddress);
        return account?.evmAddress ? [{ id: agent.id, label: `${agent.name} · ${agent.network}`, networkId: agent.network, sourceAddress: account.evmAddress }] : [];
      })}
      networks={networks.map((network) => ({ id: network.id, label: `${network.displayName}${network.testnet ? " · testnet" : ""}` }))}
    />
  </WorkspacePage>;
}
