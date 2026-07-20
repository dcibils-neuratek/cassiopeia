// M11 authentication & RBAC. Local users with scrypt-hashed passwords, opaque
// session tokens, and hierarchical roles. OIDC/SAML can slot in later behind the
// same session model.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  createSession,
  createUser,
  countUsers,
  deleteSession,
  getSessionUser,
  getUserByUsername,
  toPublicUser,
  type PublicUser,
  type Role,
  type UserRow,
} from "./db.js";

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 days

// Hierarchical roles: each includes the capabilities of the ones below it.
const RANK: Record<Role, number> = { viewer: 0, operator: 1, analyst: 2, admin: 3 };

/** Minimum role for a capability. read=any authed, operate=run/inbox, build=designer, admin=settings/users. */
export type Capability = "read" | "operate" | "build" | "admin";
const CAP_MIN: Record<Capability, Role> = { read: "viewer", operate: "operator", build: "analyst", admin: "admin" };

export function can(role: Role, cap: Capability): boolean {
  return RANK[role] >= RANK[CAP_MIN[cap]];
}

export const ALL_ROLES: Role[] = ["viewer", "operator", "analyst", "admin"];

function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 64).toString("hex");
  return { hash, salt: s };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function registerUser(username: string, password: string, displayName: string, role: Role): PublicUser {
  if (getUserByUsername(username)) throw new Error("Username already exists");
  if (!username || !password) throw new Error("Username and password are required");
  const { hash, salt } = hashPassword(password);
  const user = createUser({ username, displayName: displayName || username, role, passwordHash: hash, passwordSalt: salt });
  return toPublicUser(user);
}

export function login(username: string, password: string): { token: string; user: PublicUser } | null {
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) return null;
  const token = randomBytes(32).toString("hex");
  createSession(user.id, token, new Date(Date.now() + SESSION_TTL_MS).toISOString());
  return { token, user: toPublicUser(user) };
}

export function logout(token: string): void {
  deleteSession(token);
}

export function userForToken(token: string | undefined): UserRow | undefined {
  if (!token) return undefined;
  return getSessionUser(token);
}

/** Seed a default admin on first run so the app is usable immediately. */
export function seedAuth(): void {
  if (countUsers() > 0) return;
  registerUser("admin", "admin", "Administrator", "admin");
  console.warn("[auth] Seeded default admin (admin/admin). Change this password in production.");
}
