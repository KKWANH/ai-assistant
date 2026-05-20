import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const N = 16384;
const R = 8;
const P = 1;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return { hash: derived.toString("hex"), salt };
}

export function verifyPassword(
  password: string,
  storedHash: string,
  salt: string
): boolean {
  try {
    const derived = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
    const stored = Buffer.from(storedHash, "hex");
    if (derived.length !== stored.length) return false;
    return timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}
