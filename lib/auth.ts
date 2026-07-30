import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "watchtower_session";
const SESSION_PAYLOAD = "watchtower-owner-session-v1";

function authSecret() {
  return process.env.AUTH_SECRET || "";
}

export function authIsConfigured() {
  return Boolean(
    process.env.APP_USERNAME &&
      process.env.APP_PASSWORD &&
      authSecret().length >= 32
  );
}

export function sessionToken() {
  const secret = authSecret();
  if (secret.length < 32) return "";
  return createHmac("sha256", secret)
    .update(
      `${SESSION_PAYLOAD}:${process.env.APP_USERNAME || ""}:${process.env.APP_PASSWORD || ""}`
    )
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function credentialsAreValid(username: string, password: string) {
  if (!authIsConfigured()) return false;
  return (
    safeEqual(username, process.env.APP_USERNAME || "") &&
    safeEqual(password, process.env.APP_PASSWORD || "")
  );
}

function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

export function requestIsAuthenticated(request: Request) {
  const supplied = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  const expected = sessionToken();
  return Boolean(expected && supplied && safeEqual(supplied, expected));
}

export function unauthorizedResponse() {
  return Response.json({ error: "Authentication required." }, { status: 401 });
}
