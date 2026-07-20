// Encryption for connector secrets at rest (M11). Secret config fields (apiKey,
// token, …) are AES-256-GCM encrypted before they touch SQLite and only ever
// decrypted server-side to run a connector — never returned to the client.
//
// Key material comes from CASSIOPEIA_SECRET_KEY; if unset (dev), a random key is
// generated once into data/secret.key. The derived 32-byte key is scrypt'd from
// that material so any string works as the env value.

import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const ENC_PREFIX = "enc:";
const KEY_FILE = "data/secret.key";

function keyMaterial(): string {
  if (process.env.CASSIOPEIA_SECRET_KEY) return process.env.CASSIOPEIA_SECRET_KEY;
  if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, "utf8").trim();
  mkdirSync(dirname(KEY_FILE), { recursive: true });
  const generated = randomBytes(32).toString("hex");
  writeFileSync(KEY_FILE, generated, { mode: 0o600 });
  console.warn(
    "[secrets] No CASSIOPEIA_SECRET_KEY set — generated data/secret.key for dev. " +
    "Set CASSIOPEIA_SECRET_KEY in production and keep it stable.",
  );
  return generated;
}

const KEY = scryptSync(keyMaterial(), "cassiopeia.secrets.v1", 32);

/** Config field names treated as secrets (encrypted at rest, masked to clients). */
export const SECRET_FIELDS = new Set(["apiKey", "apikey", "token", "secret", "password"]);

export function encryptValue(plain: string): string {
  if (plain === "") return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Decrypt; tolerates legacy plaintext (values without the enc: prefix). */
export function decryptValue(value: string): string {
  if (typeof value !== "string" || !value.startsWith(ENC_PREFIX)) return value;
  try {
    const buf = Buffer.from(value.slice(ENC_PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return ""; // undecryptable (e.g. key rotated) — fail closed
  }
}

export function isSecretField(name: string): boolean {
  return SECRET_FIELDS.has(name);
}
