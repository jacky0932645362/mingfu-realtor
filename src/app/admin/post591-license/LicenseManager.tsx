"use client";

import { useState, useTransition } from "react";
import { CIS, CHIP, type ChipTone } from "@/app/admin/_components/cis";
import type { LicenseWithUsage, InstallRow } from "@/lib/post591-license";
import {
  createLicenseAction,
  setRevokedAction,
  extendLicenseAction,
  setSeatLimitAction,
  removeInstallAction,
  deleteLicenseAction,
  listInstallsAction,
} from "@/lib/actions/post591-license-actions";
import styles from "../customers/customers.module.css";

const inputStyle: React.CSSProperties = {
  minHeight: 40,
  padding: "8px 10px",
  borderRadius: 7,
  border: `1px solid ${CIS.cardBorder}`,
  background: CIS.bgSoft,
  color: CIS.text,
  fontSize: 14,
  fontFamily: "inherit",
};

function fmtDate(d: Date | string): string {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function inNDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
function isExpired(d: Date | string): boolean {
  const dt = new Date(d);
  dt.setHours(23, 59, 59, 999);
  return dt.getTime() < Date.now();
}

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
  const c = CHIP[tone];
  return (
    <span style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}`, borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 600 }}>
      {children}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={styles.button}
      style={{ padding: "4px 10px", fontSize: 13 }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* 剪貼簿權限被擋，使用者自己選字複製 */
        }
      }}
    >
      {copied ? "已複製 ✓" : "複製代碼"}
    </button>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [seatLimit, setSeatLimit] = useState(10);
  const [expiresAt, setExpiresAt] = useState(inNDays(30));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [newKey, setNewKey] = useState("");

  return (
    <div className={styles.formSection}>
      <div className={styles.sectionTitle}>建立新的授權碼</div>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          備註（給誰用，例如「第一批同事」）
          <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例：沙鹿海線團隊" />
        </label>
        <label className={styles.field}>
          可用電腦數上限
          <input style={inputStyle} type="number" min={1} max={500} value={seatLimit} onChange={(e) => setSeatLimit(Number(e.target.value) || 1)} />
        </label>
        <label className={styles.field}>
          到期日
          <input style={inputStyle} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </label>
      </div>
      {error && <p style={{ color: CHIP.danger.color, fontSize: 13 }}>{error}</p>}
      {newKey && (
        <p style={{ color: CHIP.success.color, fontSize: 14 }}>
          已建立：<code style={{ fontSize: 15 }}>{newKey}</code> —— 把這組碼傳給同事，同事版手冊裡「⚙ 我的資料」貼這個。
        </p>
      )}
      <div className={styles.formActions}>
        <button
          type="button"
          className={styles.button}
          style={{ background: CIS.blue, color: "#fff" }}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError("");
              setNewKey("");
              const r = await createLicenseAction({ label, seatLimit, expiresAt });
              if (!r.ok) setError(r.error || "建立失敗");
              else {
                setNewKey(r.key || "");
                setLabel("");
                onCreated();
              }
            })
          }
        >
          {pending ? "建立中…" : "建立授權碼"}
        </button>
      </div>
    </div>
  );
}

function InstallList({ licenseKey, installs, onChanged }: { licenseKey: string; installs: InstallRow[]; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  if (!installs.length) return <p style={{ color: CIS.textMute, fontSize: 13, padding: "8px 0" }}>還沒有電腦用過這組碼。</p>;
  return (
    <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginTop: 8 }}>
      <thead>
        <tr style={{ color: CIS.textMute, textAlign: "left" }}>
          <th style={{ padding: "4px 8px" }}>安裝編號</th>
          <th style={{ padding: "4px 8px" }}>版本</th>
          <th style={{ padding: "4px 8px" }}>上架次數</th>
          <th style={{ padding: "4px 8px" }}>最後使用</th>
          <th style={{ padding: "4px 8px" }} />
        </tr>
      </thead>
      <tbody>
        {installs.map((i) => (
          <tr key={i.id} style={{ borderTop: `1px solid ${CIS.divider}` }}>
            <td style={{ padding: "4px 8px", fontFamily: "monospace", fontSize: 12 }}>{i.install_id.slice(0, 12)}…</td>
            <td style={{ padding: "4px 8px" }}>{i.version || "—"}</td>
            <td style={{ padding: "4px 8px" }}>{i.launch_count}</td>
            <td style={{ padding: "4px 8px" }}>{fmtDate(i.last_seen_at)}</td>
            <td style={{ padding: "4px 8px" }}>
              <button
                type="button"
                className={styles.button}
                style={{ padding: "2px 8px", fontSize: 12 }}
                disabled={pending}
                onClick={() => {
                  if (!window.confirm("移除這台電腦的名額？（同事那台的外掛下次驗證會失敗，要用需要重貼一次授權碼，會算成新的一台）")) return;
                  startTransition(async () => {
                    await removeInstallAction(licenseKey, i.install_id);
                    onChanged();
                  });
                }}
              >
                移除
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LicenseCard({ lic, onChanged }: { lic: LicenseWithUsage; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [installs, setInstalls] = useState<InstallRow[] | null>(null);
  const [extendTo, setExtendTo] = useState(inNDays(30));
  const [seatLimit, setSeatLimitInput] = useState(lic.seat_limit);
  const expired = isExpired(lic.expires_at);
  const full = lic.install_count >= lic.seat_limit;

  async function loadInstalls() {
    setInstalls(await listInstallsAction(lic.license_key));
  }

  return (
    <div className={styles.card} style={{ display: "block", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <code style={{ fontSize: 16, fontWeight: 700 }}>{lic.license_key}</code>
            <CopyButton text={lic.license_key} />
            {lic.revoked ? <Chip tone="danger">已停用</Chip> : expired ? <Chip tone="warn">已到期</Chip> : <Chip tone="success">有效</Chip>}
            {full && !lic.revoked && !expired && <Chip tone="warn">電腦數已滿</Chip>}
          </div>
          <p style={{ margin: "6px 0 0", color: CIS.textSub, fontSize: 14 }}>{lic.label || "（沒有備註）"}</p>
          <p style={{ margin: "4px 0 0", color: CIS.textMute, fontSize: 13 }}>
            電腦數 {lic.install_count} / {lic.seat_limit}　·　累計上架 {lic.launch_count} 次　·　到期 {fmtDate(lic.expires_at)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={styles.button}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await setRevokedAction(lic.license_key, !lic.revoked);
                onChanged();
              })
            }
          >
            {lic.revoked ? "重新啟用" : "停用"}
          </button>
          <button
            type="button"
            className={styles.button}
            style={{ color: CHIP.danger.color }}
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`確定刪除這組授權碼？\n${lic.license_key}\n刪除後同事的外掛會立刻驗證失敗，且無法復原。`)) return;
              startTransition(async () => {
                await deleteLicenseAction(lic.license_key);
                onChanged();
              });
            }}
          >
            刪除
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setExpanded((v) => !v);
              if (!expanded && installs === null) loadInstalls();
            }}
          >
            {expanded ? "收起" : "看使用中的電腦"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className={styles.field} style={{ minWidth: 160 }}>
          延長到期日
          <div style={{ display: "flex", gap: 6 }}>
            <input style={inputStyle} type="date" value={extendTo} onChange={(e) => setExtendTo(e.target.value)} />
            <button
              type="button"
              className={styles.button}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await extendLicenseAction(lic.license_key, extendTo);
                  onChanged();
                })
              }
            >
              套用
            </button>
          </div>
        </label>
        <label className={styles.field} style={{ minWidth: 160 }}>
          電腦數上限
          <div style={{ display: "flex", gap: 6 }}>
            <input style={{ ...inputStyle, width: 80 }} type="number" min={1} max={500} value={seatLimit} onChange={(e) => setSeatLimitInput(Number(e.target.value) || 1)} />
            <button
              type="button"
              className={styles.button}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await setSeatLimitAction(lic.license_key, seatLimit);
                  onChanged();
                })
              }
            >
              套用
            </button>
          </div>
        </label>
      </div>

      {expanded && (installs ? <InstallList licenseKey={lic.license_key} installs={installs} onChanged={loadInstalls} /> : <p style={{ color: CIS.textMute, fontSize: 13 }}>載入中…</p>)}
    </div>
  );
}

export default function LicenseManager({ licenses }: { licenses: LicenseWithUsage[] }) {
  const [, startTransition] = useTransition();
  const refresh = () => startTransition(() => window.location.reload());

  return (
    <div>
      <CreateForm onCreated={refresh} />
      <div className={styles.sectionTitle} style={{ marginTop: 24 }}>
        現有授權碼（{licenses.length}）
      </div>
      {licenses.length === 0 ? (
        <p className={styles.empty}>還沒有任何授權碼，上面建立第一組。</p>
      ) : (
        <div className={styles.list}>
          {licenses.map((lic) => (
            <LicenseCard key={lic.license_key} lic={lic} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
