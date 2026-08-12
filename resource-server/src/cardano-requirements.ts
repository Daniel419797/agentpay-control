import { createHash } from "node:crypto";

const CARDANO_ASSET_UNIT = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;

export function optionalCardanoAssetUnit(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!CARDANO_ASSET_UNIT.test(normalized)) throw new Error(`${name}_INVALID`);
  return normalized;
}

export function canonicalResourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

export function resourceBindingForUrl(value: string): string {
  return createHash("sha256").update(canonicalResourceUrl(value)).digest("hex");
}

export function cardanoRequirementExtra(resourceUrl: string) {
  return {
    assetTransferMethod: "default",
    submissionPolicy: "server",
    confirmationPolicy: { l1Confirmations: 1 },
    areFeesSponsored: false,
    resourceBinding: resourceBindingForUrl(resourceUrl),
  };
}
