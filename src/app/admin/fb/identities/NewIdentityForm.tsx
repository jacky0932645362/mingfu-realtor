"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIdentityAction } from "@/lib/actions/identity-actions";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../fb.module.css";

const inputStyle = { background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text };

export function NewIdentityForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const submit = () =>
    start(async () => {
      setMsg(null);
      const res = await createIdentityAction(name);
      if (res.ok) {
        setName("");
        setMsg({ tone: "ok", text: `${res.message || "已新增"}${res.authKey ? `（登入代號：${res.authKey}）` : ""}` });
        router.refresh();
      } else {
        setMsg({ tone: "bad", text: res.error || "新增失敗" });
      }
    });

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className={styles.input}
          style={{ ...inputStyle, flex: "1 1 260px", maxWidth: 420 }}
          value={name}
          maxLength={100}
          placeholder="取個認得出來的名字，例：房仲蕭邦第二帳號"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim() && !pending) submit();
          }}
        />
        <button
          type="button"
          className={styles.btn}
          style={{ background: CIS.blue, color: "#fff" }}
          disabled={pending || !name.trim()}
          onClick={submit}
        >
          <Icon name={pending ? "loading" : "add"} size={15} />
          新增個人帳號
        </button>
      </div>
      {msg ? (
        <div style={{ marginTop: 8, fontSize: 13, color: msg.tone === "ok" ? "#16a34a" : "#e11d48", lineHeight: 1.7 }}>
          {msg.text}
        </div>
      ) : null}
    </div>
  );
}
