import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_DAYS = 90;

function secret(): string | null {
  const configured =
    process.env.APPOINTMENT_TOKEN_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    "";
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? null : "dev-only-insecure-secret";
}

function sign(payload: string): string {
  const signingSecret = secret();
  if (!signingSecret) {
    throw new Error("appointment_token_secret_missing");
  }
  return createHmac("sha256", signingSecret).update(payload).digest("base64url");
}

export function createAppointmentManageToken(id: string, email: string, ttlDays = DEFAULT_TTL_DAYS): string {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const payload = `${id}.${Buffer.from(email.toLowerCase()).toString("base64url")}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAppointmentManageToken(token: string): { id: string; email: string } | null {
  if (!secret()) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, emailPart, expPart, sig] = parts;
  if (!/^[a-z0-9]{16,80}$/i.test(id)) return null;
  const exp = Number(expPart);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const payload = `${id}.${emailPart}.${expPart}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const email = Buffer.from(emailPart, "base64url").toString("utf8");
  if (!email || !email.includes("@")) return null;
  return { id, email };
}
