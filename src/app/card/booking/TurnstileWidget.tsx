"use client";

import { useCallback, useEffect, useRef } from "react";
import styles from "./Booking.module.css";

// 沒填 site key 就整個不顯示，表單維持原本行為（後端 secret 也空著時會直接放行）。
// ⚠️ 兩把 key 必須同時設：只設後端 secret 而前端沒有 site key，
//    後端收不到 token 會讓每一筆預約都回 400。
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "cf-turnstile-api";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile script failed")));
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      scriptPromise = null;
      reject(new Error("turnstile script failed"));
    });
    document.head.appendChild(script);
  });

  return scriptPromise;
}

type Props = {
  /** 拿到 token 時回傳；過期／出錯時回傳空字串 */
  onToken: (token: string) => void;
  /** 腳本載不到或 Cloudflare 掛了 */
  onUnavailable: () => void;
  /** 數字一變就換一顆新 token（token 是一次性的，送出失敗後必須重來） */
  resetSignal: number;
  /** 讓 focusFirstError 能捲到這裡 */
  containerRef?: (node: HTMLDivElement | null) => void;
};

export default function TurnstileWidget({ onToken, onUnavailable, resetSignal, containerRef }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  const onUnavailableRef = useRef(onUnavailable);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  const setHost = useCallback(
    (node: HTMLDivElement | null) => {
      hostRef.current = node;
      containerRef?.(node);
    },
    [containerRef],
  );

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || widgetIdRef.current || !hostRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(hostRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          language: "zh-tw",
          theme: "light",
          callback: (token: string) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(""),
          "timeout-callback": () => onTokenRef.current(""),
          "error-callback": () => {
            onTokenRef.current("");
            onUnavailableRef.current();
          },
        });
      })
      .catch(() => {
        if (!cancelled) onUnavailableRef.current();
      });

    return () => {
      cancelled = true;
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, []);

  useEffect(() => {
    if (!resetSignal) return;
    const id = widgetIdRef.current;
    if (!id || !window.turnstile) return;
    window.turnstile.reset(id);
    onTokenRef.current("");
  }, [resetSignal]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div className={styles.turnstile} ref={setHost} tabIndex={-1} />;
}
