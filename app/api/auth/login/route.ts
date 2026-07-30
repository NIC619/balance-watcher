import { NextResponse } from "next/server";
import {
  authIsConfigured,
  credentialsAreValid,
  SESSION_COOKIE,
  sessionToken,
} from "../../../../lib/auth";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

declare global {
  var watchtowerLoginAttempts:
    | Map<string, { count: number; resetAt: number }>
    | undefined;
}

function attempts() {
  global.watchtowerLoginAttempts ||= new Map();
  return global.watchtowerLoginAttempts;
}

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  if (!authIsConfigured()) {
    return NextResponse.json(
      { error: "Authentication environment variables are not configured." },
      { status: 503 }
    );
  }

  const key = clientKey(request);
  const now = Date.now();
  const previous = attempts().get(key);
  const current =
    previous && previous.resetAt > now
      ? previous
      : { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
  if (current.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again in 15 minutes." },
      { status: 429 }
    );
  }

  const body = (await request.json()) as {
    username?: string;
    password?: string;
  };
  if (!credentialsAreValid(body.username || "", body.password || "")) {
    current.count += 1;
    attempts().set(key, current);
    return NextResponse.json(
      { error: "Incorrect username or password." },
      { status: 401 }
    );
  }

  attempts().delete(key);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
