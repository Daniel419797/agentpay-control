import { redirect } from "next/navigation";

import { CreateAgentForm } from "@/components/create-agent-form";
import { FormPage } from "@/components/workspace-page";
import {
  isCardanoMainnetEnabled,
  isHederaMainnetEnabled,
  isManagedArcEnabled,
  isManagedCardanoPreprodEnabled,
} from "@/domain/network-router";
import { cardanoAssetConfigFromEnv } from "@/lib/cardano-assets";
import { getConfig } from "@/lib/config";
import { currentWorkspace, workspaceHasRole } from "@/lib/workspace";

export default async function NewAgentPage() {
  const workspace = await currentWorkspace();
  if (!workspace) redirect("/sign-in");
  if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) {
    return <FormPage title="Create agent" description="Owner or Operator access is required."><div className="form-error">You do not have permission to provision payment agents in this workspace.</div></FormPage>;
  }

  const config = getConfig();
  const cardanoAssets = cardanoAssetConfigFromEnv();
  const usdcxEnabled = process.env.CARDANO_USDCX_ENABLED === "true";
  return (
    <FormPage
      title="Create agent"
      description="Create a policy-controlled payment identity with a signer appropriate to the selected rail."
    >
      <CreateAgentForm
        mainnetEnabled={isHederaMainnetEnabled(config)}
        arcEnabled={isManagedArcEnabled(config)}
        cardanoPreprodEnabled={isManagedCardanoPreprodEnabled(config)}
        cardanoMainnetEnabled={isCardanoMainnetEnabled(config)}
        cardanoPreprodUsdcxEnabled={usdcxEnabled && Boolean(cardanoAssets.preprodUsdcxAssetId)}
        cardanoMainnetUsdcxEnabled={usdcxEnabled && Boolean(cardanoAssets.mainnetUsdcxAssetId)}
      />
    </FormPage>
  );
}
