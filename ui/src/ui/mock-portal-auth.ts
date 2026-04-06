import {
  buildAgentMainSessionKey,
  normalizeAgentId,
  resolveAgentIdFromSessionKey,
} from "../../../src/routing/session-key.js";
import type { SessionsListResult } from "./types.ts";

const MOCK_PORTAL_USER_SESSION_KEY = "openclaw.control.mock-portal-user.v1";

export type MockPortalUser = {
  id: string;
  name: string;
  description: string;
};

const MOCK_PORTAL_USERS: readonly MockPortalUser[] = [
  {
    id: "u1001",
    name: "Ada",
    description: "Sales demo user",
  },
  {
    id: "u1002",
    name: "Linus",
    description: "Support demo user",
  },
  {
    id: "admin01",
    name: "Morgan",
    description: "Admin demo user",
  },
] as const;

function getSessionStorage(): Storage | null {
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage;
  }
  if (typeof sessionStorage !== "undefined") {
    return sessionStorage;
  }
  return null;
}

function normalizeMockPortalUserId(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function listMockPortalUsers(): readonly MockPortalUser[] {
  return MOCK_PORTAL_USERS;
}

export function resolveMockPortalUser(value: string | undefined | null): MockPortalUser | null {
  const normalized = normalizeMockPortalUserId(value);
  if (!normalized) {
    return null;
  }
  return MOCK_PORTAL_USERS.find((entry) => entry.id.toLowerCase() === normalized) ?? null;
}

export function loadMockPortalUserId(): string | null {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return null;
    }
    return resolveMockPortalUser(storage.getItem(MOCK_PORTAL_USER_SESSION_KEY))?.id ?? null;
  } catch {
    return null;
  }
}

export function saveMockPortalUserId(userId: string | null) {
  try {
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }
    const resolved = resolveMockPortalUser(userId);
    if (resolved) {
      storage.setItem(MOCK_PORTAL_USER_SESSION_KEY, resolved.id);
      return;
    }
    storage.removeItem(MOCK_PORTAL_USER_SESSION_KEY);
  } catch {
    // best-effort
  }
}

export function deriveMockPortalAgentId(userId: string): string {
  const resolved = resolveMockPortalUser(userId);
  const normalizedUserId = resolved?.id ?? (normalizeMockPortalUserId(userId) || "guest");
  return normalizeAgentId(`portal-${normalizedUserId}`);
}

export function deriveMockPortalSessionKey(userId: string): string {
  return buildAgentMainSessionKey({
    agentId: deriveMockPortalAgentId(userId),
  });
}

export function isMockPortalSessionKeyForUser(
  sessionKey: string | undefined | null,
  userId: string | undefined | null,
): boolean {
  const resolved = resolveMockPortalUser(userId);
  if (!resolved) {
    return false;
  }
  return resolveAgentIdFromSessionKey(sessionKey) === deriveMockPortalAgentId(resolved.id);
}

export function lockMockPortalSessionKey(
  sessionKey: string | undefined | null,
  userId: string | undefined | null,
): string {
  const resolved = resolveMockPortalUser(userId);
  if (!resolved) {
    const trimmed = (sessionKey ?? "").trim();
    return trimmed || "main";
  }
  return deriveMockPortalSessionKey(resolved.id);
}

export function filterSessionsForMockPortalUser(
  result: SessionsListResult,
  userId: string | undefined | null,
): SessionsListResult {
  const resolved = resolveMockPortalUser(userId);
  if (!resolved) {
    return result;
  }
  const sessions = result.sessions.filter((entry) => isMockPortalSessionKeyForUser(entry.key, userId));
  return {
    ...result,
    count: sessions.length,
    sessions,
  };
}

export function describeMockPortalUser(userId: string | undefined | null): string {
  const resolved = resolveMockPortalUser(userId);
  if (!resolved) {
    return "Guest";
  }
  return `${resolved.name} (${resolved.id})`;
}
