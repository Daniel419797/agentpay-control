import { FormPage } from "@/components/workspace-page";

export default function NewAgentPage() {
  return (
    <FormPage
      title="Create agent"
      description="Create a policy-controlled payment identity with managed automation or wallet confirmation."
    >
      <form className="app-form" action="/api/v1/agents" method="post">
        <label>Name<input name="name" required placeholder="Research assistant" /></label>
        <label>Description<textarea name="description" placeholder="What this agent is allowed to purchase" /></label>
        <label>
          Custody
          <select name="custody" defaultValue="PLATFORM_MANAGED_TESTNET">
            <option value="PLATFORM_MANAGED_TESTNET">Managed testnet signer · autonomous</option>
            <option value="SELF_CUSTODY">Connected HashPack · confirmation required</option>
          </select>
        </label>
        <label>Default asset<select name="asset"><option>HBAR</option><option>USDC</option></select></label>
        <p className="form-help">
          Managed agents share the isolated facilitator treasury while policies and reservations maintain per-agent spending boundaries. Private keys never enter the dashboard.
        </p>
        <button className="primary-button" type="submit">Create agent</button>
      </form>
    </FormPage>
  );
}
