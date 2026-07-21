// M11 authentication & RBAC. Local users with scrypt-hashed passwords, opaque
// session tokens, and hierarchical roles. OIDC/SAML can slot in later behind the
// same session model.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  createSession,
  createUser,
  countAdmins,
  countUsers,
  deleteSession,
  deleteUser,
  getSessionUser,
  getUserByUsername,
  setUserPassword,
  toPublicUser,
  updateUser,
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

export function registerUser(username: string, password: string, displayName: string, role: Role, area?: string | null): PublicUser {
  if (getUserByUsername(username)) throw new Error("Username already exists");
  if (!username || !password) throw new Error("Username and password are required");
  const { hash, salt } = hashPassword(password);
  const user = createUser({ username, displayName: displayName || username, role, area: area?.trim() || null, passwordHash: hash, passwordSalt: salt });
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

/** Update a user's profile (display name, role, area). Guards the last admin. */
export function updateUserProfile(username: string, fields: { displayName?: string; role?: Role; area?: string | null }): PublicUser {
  const u = getUserByUsername(username);
  if (!u) throw new Error("Usuario no encontrado");
  if (fields.role && !ALL_ROLES.includes(fields.role)) throw new Error("Rol inválido");
  if (fields.role && u.role === "admin" && fields.role !== "admin" && countAdmins() <= 1)
    throw new Error("No podés quitar el último administrador");
  // area only makes sense for operators; clear it otherwise
  const role = fields.role ?? u.role;
  const patch = { ...fields };
  if (role === "admin" || role === "analyst") patch.area = null;
  updateUser(username, patch);
  return toPublicUser(getUserByUsername(username)!);
}

/** Reset a user's password (admin action). */
export function changePassword(username: string, newPassword: string): void {
  if (!newPassword || newPassword.length < 4) throw new Error("La contraseña debe tener al menos 4 caracteres");
  if (!getUserByUsername(username)) throw new Error("Usuario no encontrado");
  const { hash, salt } = hashPassword(newPassword);
  setUserPassword(username, hash, salt);
}

/** Delete a user (and revoke their sessions). Guards the last admin. */
export function removeUser(username: string): void {
  const u = getUserByUsername(username);
  if (!u) throw new Error("Usuario no encontrado");
  if (u.role === "admin" && countAdmins() <= 1) throw new Error("No podés eliminar el último administrador");
  deleteUser(username);
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
