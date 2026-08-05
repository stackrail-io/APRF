/**
 * Shared live auth helpers for credentialed collectors (AUTHN-M2, AUTHZ-M1, …).
 * Passwords/tokens are never logged or written to reports by these helpers.
 */
import { randomBytes } from "node:crypto";
import type { CollectorContext } from "../types.ts";

export function resolveBaseUrl(ctx: CollectorContext): string | undefined {
  const u = ctx.baseUrl?.trim() || process.env.APRF_AUTH_PROBE_BASE_URL?.trim();
  return u ? u.replace(/\/$/, "") : undefined;
}

export function resolveAdminToken(ctx: CollectorContext): string | undefined {
  return (
    ctx.adminToken?.trim() ||
    process.env.APRF_ADMIN_TOKEN?.trim() ||
    process.env.APRF_AUTH_PROBE_ADMIN_TOKEN?.trim() ||
    undefined
  );
}

export function resolveAdminEmail(ctx: CollectorContext): string | undefined {
  return (
    ctx.adminEmail?.trim() ||
    process.env.APRF_ADMIN_EMAIL?.trim() ||
    process.env.APRF_ADMIN_USER?.trim() ||
    undefined
  );
}

export function resolveAdminPassword(ctx: CollectorContext): string | undefined {
  return (
    ctx.adminPassword?.trim() ||
    process.env.APRF_ADMIN_PASSWORD?.trim() ||
    undefined
  );
}

/** Optional limited (non-admin) principal for AUTHZ denial probes. */
export function resolveLimitedEmail(ctx: CollectorContext): string | undefined {
  return (
    ctx.limitedEmail?.trim() ||
    process.env.APRF_AUTHZ_LIMITED_EMAIL?.trim() ||
    process.env.APRF_LIMITED_EMAIL?.trim() ||
    undefined
  );
}

export function resolveLimitedPassword(
  ctx: CollectorContext,
): string | undefined {
  return (
    ctx.limitedPassword?.trim() ||
    process.env.APRF_AUTHZ_LIMITED_PASSWORD?.trim() ||
    process.env.APRF_LIMITED_PASSWORD?.trim() ||
    undefined
  );
}

export function resolveLimitedToken(ctx: CollectorContext): string | undefined {
  return (
    ctx.limitedToken?.trim() ||
    process.env.APRF_AUTHZ_LIMITED_TOKEN?.trim() ||
    undefined
  );
}

/**
 * Open WebUI-style password login → JWT bearer token.
 * POST /api/v1/auths/signin { email, password } → { token }
 */
export async function signInForToken(
  baseUrl: string,
  email: string,
  password: string,
  userAgent = "aprf-auditor-live-auth/0.2",
): Promise<{ token?: string; error?: string; role?: string }> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/auths/signin`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": userAgent,
      },
      body: JSON.stringify({ email, password }),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { error: `signin HTTP ${res.status}: non-JSON body` };
    }
    if (!res.ok) {
      const detail =
        (typeof data.detail === "string" && data.detail) ||
        (typeof data.detail === "object" ? JSON.stringify(data.detail) : "") ||
        text.slice(0, 200);
      return { error: `signin HTTP ${res.status}: ${detail}` };
    }
    const token =
      (data.token as string) ||
      (data.access_token as string) ||
      ((data.data as Record<string, unknown> | undefined)?.token as string);
    if (!token) {
      return { error: "signin succeeded but response had no token field" };
    }
    const role =
      typeof data.role === "string"
        ? data.role
        : typeof (data.data as Record<string, unknown> | undefined)?.role ===
            "string"
          ? ((data.data as Record<string, unknown>).role as string)
          : undefined;
    return { token, role };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}

/** @deprecated alias — prefer signInForToken */
export const signInForAdminToken = signInForToken;

export async function resolveLiveAdminToken(
  ctx: CollectorContext,
  baseUrl: string,
): Promise<{
  token?: string;
  error?: string;
  via: "token" | "password" | "none";
}> {
  const existing = resolveAdminToken(ctx);
  if (existing) return { token: existing, via: "token" };

  const email = resolveAdminEmail(ctx);
  const password = resolveAdminPassword(ctx);
  if (email && password) {
    const signed = await signInForToken(baseUrl, email, password);
    if (signed.token) return { token: signed.token, via: "password" };
    return { error: signed.error, via: "password" };
  }
  return { via: "none" };
}

/**
 * Resolve an authenticated-but-unauthorized (limited) bearer token for AUTHZ probes.
 * Prefers explicit limited token/email; else creates a temporary user via admin
 * POST /api/v1/auths/add (Open WebUI) when admin credentials are available.
 */
export async function resolveLimitedUserToken(
  ctx: CollectorContext,
  baseUrl: string,
): Promise<{
  token?: string;
  error?: string;
  via: "token" | "password" | "admin-create" | "none";
  createdUserId?: string;
  email?: string;
}> {
  const existing = resolveLimitedToken(ctx);
  if (existing) return { token: existing, via: "token" };

  const email = resolveLimitedEmail(ctx);
  const password = resolveLimitedPassword(ctx);
  if (email && password) {
    const signed = await signInForToken(baseUrl, email, password);
    if (signed.token) {
      if (signed.role && signed.role.toLowerCase() === "admin") {
        return {
          error:
            "Limited credentials resolved to role=admin — AUTHZ-M1 needs an authenticated non-admin principal",
          via: "password",
        };
      }
      return { token: signed.token, via: "password", email };
    }
    return { error: signed.error, via: "password" };
  }

  // Create a temporary limited user with admin credentials.
  const admin = await resolveLiveAdminToken(ctx, baseUrl);
  if (!admin.token) {
    return {
      via: "none",
      error:
        admin.error ||
        "Provide APRF_AUTHZ_LIMITED_EMAIL/PASSWORD (or token), or admin credentials to create a temporary limited user",
    };
  }

  const tempEmail = `aprf-authz-limited-${Date.now()}@aprf.local`;
  const tempPassword = `AprfAuthz!${randomBytes(12).toString("base64url")}A1`;
  const addUrl = `${baseUrl.replace(/\/$/, "")}/api/v1/auths/add`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(addUrl, {
      method: "POST",
      signal: ctrl.signal,
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${admin.token}`,
        "User-Agent": "aprf-auditor-authz-entry-tests/0.3",
      },
      body: JSON.stringify({
        email: tempEmail,
        password: tempPassword,
        name: "APRF AUTHZ limited probe",
        role: "user",
        profile_image_url: "/user.png",
      }),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return {
        via: "admin-create",
        error: `admin create user HTTP ${res.status}: non-JSON body`,
      };
    }
    if (!res.ok) {
      const detail =
        (typeof data.detail === "string" && data.detail) ||
        text.slice(0, 200);
      return {
        via: "admin-create",
        error: `admin create user HTTP ${res.status}: ${detail}`,
      };
    }
    const token =
      (data.token as string) ||
      (data.access_token as string) ||
      undefined;
    const id = typeof data.id === "string" ? data.id : undefined;
    if (!token) {
      // Fall back to sign-in with the temp password
      const signed = await signInForToken(baseUrl, tempEmail, tempPassword);
      if (signed.token) {
        return {
          token: signed.token,
          via: "admin-create",
          createdUserId: id,
          email: tempEmail,
        };
      }
      return {
        via: "admin-create",
        error: signed.error || "created user but could not obtain token",
        createdUserId: id,
        email: tempEmail,
      };
    }
    return {
      token,
      via: "admin-create",
      createdUserId: id,
      email: tempEmail,
    };
  } catch (err) {
    return {
      via: "admin-create",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

/** Best-effort cleanup of a temporary user created for probing. */
export async function deleteUserBestEffort(
  baseUrl: string,
  adminToken: string,
  userId: string,
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/users/${userId}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    await fetch(url, {
      method: "DELETE",
      signal: ctrl.signal,
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${adminToken}`,
        "User-Agent": "aprf-auditor-authz-entry-tests/0.3",
      },
    });
  } catch {
    /* best-effort */
  } finally {
    clearTimeout(t);
  }
}
