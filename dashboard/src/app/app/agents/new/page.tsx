import { FormPage } from "@/components/workspace-page";

export default function NewAgentPage() {
  return <FormPage title="Create agent" description="Create a policy-controlled agent backed by your verified HashPack testnet account."><form className="app-form" action="/api/v1/agents" method="post"><label>Name<input name="name" required placeholder="Research assistant" /></label><label>Description<textarea name="description" placeholder="What this agent is allowed to purchase" /></label><label>Custody<input value="Self custody · connected HashPack wallet" readOnly /></label><label>Default asset<select name="asset"><option>HBAR</option></select></label><button className="primary-button" type="submit">Create agent</button></form></FormPage>;
}
