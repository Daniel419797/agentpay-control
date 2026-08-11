import assert from "node:assert/strict";
import test from "node:test";
import { cardanoRequirementExtra, optionalCardanoAssetUnit, resourceBindingForUrl } from "./cardano-requirements.js";

const USDCX = `${"ab".repeat(28)}5553444378`;

test("Cardano resource binding is deterministic for the same canonical URL", () => {
  assert.equal(resourceBindingForUrl("https://api.example/v1/data#fragment"), resourceBindingForUrl("https://api.example/v1/data"));
  assert.match(resourceBindingForUrl("https://api.example/v1/data"), /^[0-9a-f]{64}$/);
});

test("different paid resources produce different settlement bindings", () => {
  assert.notEqual(resourceBindingForUrl("https://api.example/v1/data"), resourceBindingForUrl("https://api.example/v1/research"));
  assert.notEqual(cardanoRequirementExtra("https://api.example/v1/data").resourceBinding, cardanoRequirementExtra("https://api.example/v1/research").resourceBinding);
});

test("Cardano native-asset configuration accepts only policy-id plus asset-name units", () => {
  assert.equal(optionalCardanoAssetUnit("CARDANO_USDCX_ASSET_ID", USDCX), USDCX);
  assert.throws(() => optionalCardanoAssetUnit("CARDANO_USDCX_ASSET_ID", "bad"), /CARDANO_USDCX_ASSET_ID_INVALID/);
});
