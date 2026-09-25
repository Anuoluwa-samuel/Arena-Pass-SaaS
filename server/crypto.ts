import "server-only"
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { env } from "@/server/env"

/**
 * Authenticated encryption for secrets we must be able to read back —
 * currently each arena's payment provider credentials.
 *
 * AES-256-GCM, random 96-bit IV per value, stored as
 * `v1.<iv>.<tag>.<ciphertext>` in base64url. GCM means a tampered ciphertext
 * fails to decrypt rather than silently returning wrong bytes, so a modified
 * row cannot redirect a tenant's money.
 *
 * This is not password hashing: passwords are one-way (scrypt) and must never
 * come through here.
 */

const VERSION = "v1"

function key(): Buffer {
  // A dedicated key is required in production. In development the session
  // secret is derived from, so a fresh checkout works without extra setup —
  // and rotating SESSION_SECRET there simply invalidates stored credentials,
  // which is the safe direction to fail.
  const material = env.CREDENTIALS_KEY ?? env.SESSION_SECRET
  return createHash("sha256").update(`arena-pass:credentials:${material}`).digest()
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".")
}

export function decryptSecret(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(".")
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Stored credential is not in a format this release can read")
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8")
}

/** Shows an operator which key is stored without revealing it. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return "••••"
  return `${plaintext.slice(0, 6)}…${plaintext.slice(-4)}`
}

/** Constant-time compare for values an attacker can submit repeatedly. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
