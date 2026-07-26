import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { getConfig } from "@/lib/config";

function key() {
  const master = getConfig().KEY_ENCRYPTION_MASTER_KEY;
  if (!master) throw new Error("KEY_ENCRYPTION_MASTER_KEY_REQUIRED");
  return createHash("sha256").update(master).digest();
}

export function encryptSecret(plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("ENCRYPTED_SECRET_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
