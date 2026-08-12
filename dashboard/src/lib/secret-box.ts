import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { getConfig } from "@/lib/config";

function configuredMasterKey() {
  const master = getConfig().KEY_ENCRYPTION_MASTER_KEY;
  if (!master) throw new Error("KEY_ENCRYPTION_MASTER_KEY_REQUIRED");
  return master;
}

function currentKey() {
  const key = Buffer.from(configuredMasterKey(), "base64url");
  if (key.length !== 32) throw new Error("KEY_ENCRYPTION_MASTER_KEY_INVALID");
  return key;
}

function legacyKey() {
  return createHash("sha256").update(configuredMasterKey()).digest();
}

export function encryptSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", currentKey(), iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v2", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(":");
  if (!version || !["v1", "v2"].includes(version) || !iv || !tag || !encrypted) throw new Error("ENCRYPTED_SECRET_INVALID");

  const ivBytes = Buffer.from(iv, "base64url");
  const tagBytes = Buffer.from(tag, "base64url");
  if (ivBytes.length !== 12 || tagBytes.length !== 16) throw new Error("ENCRYPTED_SECRET_INVALID");

  const decipher = createDecipheriv(
    "aes-256-gcm",
    version === "v2" ? currentKey() : legacyKey(),
    ivBytes,
    { authTagLength: 16 },
  );
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
