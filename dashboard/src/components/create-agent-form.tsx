"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AgentNetwork = "hedera:testnet" | "hedera:mainnet" | "eip155:5042002" | "cardano:preprod" | "cardano:mainnet";
type Custody = "PLATFORM_MANAGED_TESTNET" | "SELF_CUSTODY" | "EXTERNAL_DELEGATED";
type Asset = "HBAR" | "USDC" | "ADA" | "USDCX";

type Props = {
  mainnetEnabled: boolean;
  arcEnabled: boolean;
  cardanoPreprodEnabled: boolean;
  cardanoMainnetEnabled: boolean;
  cardanoPreprodUsdcxEnabled: boolean;
  cardanoMainnetUsdcxEnabled: boolean;
};

function defaultsForNetwork(network: AgentNetwork): { custody: Custody; asset: Asset } {
  if (network === "eip155:5042002") return { custody: "SELF_CUSTODY", asset: "USDC" };
  if (network === "cardano:preprod" || network === "cardano:mainnet") return { custody: "SELF_CUSTODY", asset: "ADA" };
  if (network === "hedera:mainnet") return { custody: "SELF_CUSTODY", asset: "HBAR" };
  return { custody: "PLATFORM_MANAGED_TESTNET", asset: "HBAR" };
}

export function CreateAgentForm({
  mainnetEnabled,
  arcEnabled,
  cardanoPreprodEnabled,
  cardanoMainnetEnabled,
  cardanoPreprodUsdcxEnabled,
  cardanoMainnetUsdcxEnabled,
}: Props) {
  const router = useRouter();
  const [network, setNetwork] = useState<AgentNetwork>("hedera:testnet");
  const [custody, setCustody] = useState<Custody>("PLATFORM_MANAGED_TESTNET");
  const [asset, setAsset] = useState<Asset>("HBAR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function changeNetwork(value: AgentNetwork) {
    const next = defaultsForNetwork(value);
    setNetwork(value);
    setCustody(next.custody);
    setAsset(next.asset);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name")).trim(),
          description: String(form.get("description")).trim() || undefined,
          network,
          asset,
          custody,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { data?: { id?: string }; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "The agent could not be created.");
      router.push(payload.data?.id ? `/app/agents/${payload.data.id}` : "/app/agents");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The agent could not be created.");
    } finally {
      setBusy(false);
    }
  }

  const cardano = network.startsWith("cardano:");
  const usdcxEnabled = network === "cardano:preprod" ? cardanoPreprodUsdcxEnabled : network === "cardano:mainnet" ? cardanoMainnetUsdcxEnabled : false;

  return <form className="app-form" onSubmit={submit}>
    {error && <div className="form-error" role="alert">{error}</div>}
    <label>Agent name<input name="name" required minLength={2} maxLength={80} placeholder="Treasury research agent" /></label>
    <label>Description<textarea name="description" maxLength={500} rows={4} placeholder="What this agent is permitted to do" /></label>
    <label>Payment rail<select name="network" value={network} onChange={(event) => changeNetwork(event.target.value as AgentNetwork)}>
      <option value="hedera:testnet">Hedera Testnet</option>
      {mainnetEnabled && <option value="hedera:mainnet">Hedera Mainnet</option>}
      {arcEnabled && <option value="eip155:5042002">Arc Testnet</option>}
      {cardanoPreprodEnabled && <option value="cardano:preprod">Cardano Preprod</option>}
      {cardanoMainnetEnabled && <option value="cardano:mainnet">Cardano Mainnet</option>}
    </select></label>
    <label>Custody<select name="custody" value={custody} onChange={(event) => setCustody(event.target.value as Custody)} disabled={network === "hedera:mainnet" || network === "cardano:mainnet"}>
      {network === "hedera:testnet" ? <><option value="PLATFORM_MANAGED_TESTNET">Dedicated managed testnet wallet · autonomous</option><option value="SELF_CUSTODY">Verified wallet · confirmation required</option></> : null}
      {network === "hedera:mainnet" && <option value="SELF_CUSTODY">Verified wallet · confirmation required</option>}
      {network === "eip155:5042002" && <><option value="SELF_CUSTODY">Verified wallet · confirmation required</option><option value="PLATFORM_MANAGED_TESTNET">Dedicated managed Arc wallet · autonomous</option></>}
      {network === "cardano:preprod" && <><option value="SELF_CUSTODY">Verified wallet · confirmation required</option><option value="PLATFORM_MANAGED_TESTNET">Dedicated managed Cardano wallet · autonomous</option></>}
      {network === "cardano:mainnet" && <option value="SELF_CUSTODY">Verified wallet · confirmation required</option>}
    </select></label>
    <label>Default asset<select name="asset" value={asset} onChange={(event) => setAsset(event.target.value as Asset)} disabled={network === "eip155:5042002" || (cardano && !usdcxEnabled)}>
      {network.startsWith("hedera:") && <option value="HBAR">HBAR</option>}
      {network.startsWith("hedera:") && <option value="USDC">USDC</option>}
      {network === "eip155:5042002" && <option value="USDC">USDC</option>}
      {cardano && <option value="ADA">ADA</option>}
      {cardano && usdcxEnabled && <option value="USDCX">USDCx</option>}
    </select></label>
    {network === "hedera:testnet" && custody === "PLATFORM_MANAGED_TESTNET" && <p className="form-help">AgentPay creates a separate Hedera testnet account and signer identity for this agent. No other agent shares its payer account or key.</p>}
    {network === "hedera:mainnet" && <p className="form-help">Hedera Mainnet requires a previously verified wallet identity and explicit wallet confirmation for payments.</p>}
    {network === "eip155:5042002" && custody === "PLATFORM_MANAGED_TESTNET" && <p className="form-help">AgentPay derives a unique Arc testnet address for this agent. Fund that address separately before autonomous payments.</p>}
    {network === "eip155:5042002" && custody === "SELF_CUSTODY" && <p className="form-help">Self custody requires the verified Arc wallet to confirm every USDC authorization.</p>}
    {network === "cardano:preprod" && custody === "PLATFORM_MANAGED_TESTNET" && <p className="form-help">AgentPay derives a unique Cardano Preprod address for this agent. Fund that address with test ADA and the required token before autonomous payments.</p>}
    {network === "cardano:preprod" && custody === "SELF_CUSTODY" && <p className="form-help">Self custody requires the verified CIP-30 wallet to sign every transaction.</p>}
    {network === "cardano:mainnet" && <p className="form-help">Mainnet defaults to per-transaction wallet confirmation. Autonomous Mainnet delegation stays disabled until an isolated per-agent HSM/KMS key and explicit spending bounds are provisioned.</p>}
    <p className="form-help">Provisioning requires recent authentication and is blocked while the organization emergency stop is active.</p>
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Creating…" : "Create agent"}</button>
  </form>;
}
