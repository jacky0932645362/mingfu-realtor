/**
 * 後台登入 —— 白名單制。
 *
 * 只有 `ADMIN_EMAILS` 裡列出的信箱能進 `/admin/appointments`。
 * 前台名片與預約表單不需要登入，這裡純粹是後台的門。
 *
 * 兩種登入方式，設哪個就開哪個，都沒設就誰都進不去：
 *   1. 密碼登入 —— 設 `ADMIN_PASSWORD` 就啟用（蕭茗馥用這個）
 *   2. Google 登入 —— 設 `AUTH_GOOGLE_ID` + `AUTH_GOOGLE_SECRET` 才啟用
 */
import { createHash, timingSafeEqual } from "node:crypto";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";

/** 允許進後台的信箱（.env 用逗號分隔多組） */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || process.env.APPOINTMENT_ADMIN_EMAIL || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 比對密碼。
 *
 * 🔴 先各自 sha256 再比，有兩個理由：
 *    一是長度先對齊，timingSafeEqual 長度不同會直接丟例外；
 *    二是逐字元比對（=== 或 ==）會因為「錯在第幾個字」而有時間差，
 *    可以被拿來一個字一個字猜出密碼。
 */
function passwordMatches(input: string, expected: string): boolean {
  if (!expected || !input) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const googleId = process.env.AUTH_GOOGLE_ID || "";
const googleSecret = process.env.AUTH_GOOGLE_SECRET || "";
const adminPassword = process.env.ADMIN_PASSWORD || "";

const providers: NextAuthConfig["providers"] = [];

if (adminPassword) {
  providers.push(
    Credentials({
      id: "password",
      name: "後台密碼",
      credentials: {
        password: { label: "後台密碼", type: "password" },
      },
      async authorize(credentials) {
        if (!passwordMatches(String(credentials?.password || ""), adminPassword)) return null;
        // 密碼過了，就以白名單第一組信箱的身分登入，
        // 這樣底下的 signIn 白名單檢查與後台的權限判斷都不用改。
        const email = adminEmails()[0];
        if (!email) return null;
        return { id: "admin", email, name: "後台管理員" };
      },
    }),
  );
}

if (googleId && googleSecret) {
  providers.push(Google({ clientId: googleId, clientSecret: googleSecret }));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Vercel 上是自動偵測的，寫明確一點，換到別的主機也不會壞
  trustHost: true,
  providers,
  callbacks: {
    /**
     * 🔴 白名單擋在登入這一關，不是等進了後台才擋 ——
     *    不在名單裡的人連 session 都拿不到。
     */
    async signIn({ user }) {
      const list = adminEmails();
      if (list.length === 0) return false; // 沒設白名單 = 誰都不准進，比誰都能進安全
      return list.includes((user.email || "").toLowerCase());
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = String(token.sub || "");
      }
      return session;
    },
  },
  pages: { signIn: "/api/auth/signin" },
});
