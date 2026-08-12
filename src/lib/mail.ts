/**
 * 寄信 —— 走 Resend。
 *
 * 沒設 `RESEND_API_KEY` 也不會壞：會把信的內容印到 console 然後回報成功，
 * 讓你在本機開發時看得到信長什麼樣，不用真的寄出去。
 *
 * 🔴 為什麼失敗不 throw：預約已經成立了，寄信只是通知。
 *    信寄不出去不該讓客戶看到「預約失敗」—— 那會讓他再送一次，變成兩筆預約。
 *    寄不出去就回 { success: false }，由呼叫端決定要不要提示。
 */

export type SendMailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** 客戶按「回覆」時要寄到哪 */
  replyTo?: string;
  /** 只覆寫顯示名，寄件位址永遠是你在 Resend 驗證過的網域 */
  fromName?: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    contentType?: string;
    contentId?: string;
    disposition?: "inline" | "attachment";
  }>;
};

export type SendMailResult = {
  success: boolean;
  provider: "resend" | "mock";
  messageId?: string;
  error?: string;
};

const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || "onboarding@resend.dev";
const FROM_NAME = process.env.MAIL_FROM_NAME || "線上預約";

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  const to = Array.isArray(input.to) ? input.to : [input.to];

  if (!apiKey) {
    // 本機開發模式：不真的寄，把內容印出來
    console.log("─".repeat(60));
    console.log("[mail] 沒設 RESEND_API_KEY，這封信沒有真的寄出去");
    console.log("  收件:", to.join(", "));
    console.log("  主旨:", input.subject);
    console.log("─".repeat(60));
    return { success: true, provider: "mock" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${input.fromName || FROM_NAME} <${FROM_EMAIL}>`,
        to,
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });
    const data = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) {
      const error = data?.message || `HTTP ${res.status}`;
      console.error("[mail] 寄送失敗:", error);
      return { success: false, provider: "resend", error };
    }
    return { success: true, provider: "resend", messageId: data?.id };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[mail] 寄送例外:", error);
    return { success: false, provider: "resend", error };
  }
}

/** HTML 逸出 —— 客戶填的內容要進信件模板時一定要過這個，不然會被注入 */
export function escapeHtml(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
