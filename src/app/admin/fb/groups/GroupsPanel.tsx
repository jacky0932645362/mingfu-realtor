"use client";
/**
 * 社團清單 —— 選取式。
 *
 * 勾選框 = **選取**（不是發文開關）。選了幾個之後上面浮出工具列：
 *   [封存] [加入發文清單] [移出發文清單]（已封存分頁則是 [取消封存]）。
 * 「會不會發文」用綠色標籤顯示，點標籤可以單獨切一個。
 * 「手動加一個」收在最下面。
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkToggleGroupsAction,
  toggleGroupAction,
  updateGroupSettingAction,
  addGroupsAction,
  deleteGroupAction,
  archiveGroupsAction,
  archiveNonHailineAction,
} from "@/lib/actions/fb-actions";
import { CIS, CHIP } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import styles from "../fb.module.css";

type Row = {
  id: string;
  name: string;
  url: string;
  accepts: string;
  cooldownDays: number;
  active: boolean;
  memberCount: number | null;
  memberLabel: string;
  privacy: string | null;
  needsApproval: boolean;
  canPost: boolean;
  canMarket: boolean;
  capability: "both" | "post" | "marketplace" | "none";
  scanned: boolean;
  hailine: boolean;
  lastPostedDays: number | null;
  /** 這一輪實際要滿幾天（設定值＋擬真加碼） */
  effectiveCooldown: number;
  cooling: boolean;
};

type Filter = "all" | "active" | "inactive" | "hailine" | "post" | "marketplace";

const inputStyle = { background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, color: CIS.text };

export function GroupsPanel({
  groups,
  viewingArchived,
}: {
  groups: Row[];
  channel: string;
  viewingArchived: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [manualOpen, setManualOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return groups.filter((g) => {
      if (kw && !g.name.toLowerCase().includes(kw)) return false;
      if (viewingArchived) return true;
      if (filter === "active") return g.active;
      if (filter === "inactive") return !g.active;
      if (filter === "hailine") return g.hailine;
      if (filter === "post") return g.canPost;
      if (filter === "marketplace") return g.canMarket;
      return true;
    });
  }, [groups, q, filter, viewingArchived]);

  const shownIds = useMemo(() => shown.map((g) => g.id), [shown]);
  const pickedShown = shownIds.filter((id) => picked.has(id));
  const allShownPicked = shown.length > 0 && pickedShown.length === shown.length;

  const flash = (r: { ok: boolean; message?: string; error?: string }) => {
    setMsg(r.ok ? { tone: "ok", text: r.message || "好了" } : { tone: "bad", text: r.error || "失敗" });
    if (r.ok) {
      setPicked(new Set());
      router.refresh();
    }
  };

  const pick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickAllShown = (on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of shownIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const runBulk = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => flash(await fn()));

  const toggleOne = (id: string, active: boolean) =>
    start(async () => {
      await toggleGroupAction(id, active);
      router.refresh();
    });

  const setCooldown = (id: string, days: number) =>
    start(async () => {
      await updateGroupSettingAction({ id, cooldownDays: days });
      router.refresh();
    });

  const setAccepts = (id: string, accepts: string) =>
    start(async () => {
      await updateGroupSettingAction({ id, accepts });
      router.refresh();
    });

  const archiveSweep = () => {
    if (!window.confirm("把名稱裡沒有「台中／海線」關鍵字、而且還沒加進發文清單的社團全部封存？\n（發文清單裡的不會動。之後在「已封存」分頁可以拿回來。）")) return;
    runBulk(archiveNonHailineAction);
  };

  const addManual = () =>
    start(async () => {
      const res = await addGroupsAction({ raw, accepts: "both", cooldownDays: 7 });
      flash(res);
      if (res.ok) {
        setRaw("");
        setManualOpen(false);
      }
    });

  const removeOne = (r: Row) => {
    if (!window.confirm(`永久刪除「${r.name}」？\n\n⚠️ 桌機抓來的社團刪了，下次 npm run groups 又會回來。\n要收起來請用「封存」。`)) return;
    start(async () => {
      await deleteGroupAction(r.id);
      router.refresh();
    });
  };

  const ids = [...picked];

  return (
    <>
      {msg ? (
        <div
          className={styles.notice}
          style={
            msg.tone === "ok"
              ? { background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", color: "#16a34a" }
              : { background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)", color: "#e11d48" }
          }
        >
          <Icon name={msg.tone === "ok" ? "success" : "error"} size={16} className={styles.noticeIcon} />
          <div>{msg.text}</div>
        </div>
      ) : null}

      {/* 搜尋 + 篩選 */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 12,
          padding: "12px 14px",
          borderRadius: 12,
          background: CIS.card,
          border: `1px solid ${CIS.cardBorder}`,
        }}
      >
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <Icon name="search" size={15} color={CIS.textMute} style={{ position: "absolute", left: 10, top: 11 }} />
          <input
            className={styles.input}
            style={{ ...inputStyle, paddingLeft: 32 }}
            placeholder="搜尋社團名稱"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {!viewingArchived
          ? (
              [
                ["all", "全部"],
                ["hailine", "海線/台中"],
                ["post", "能發一般貼文"],
                ["marketplace", "能上架 Marketplace"],
                ["active", `發文清單（${groups.filter((g) => g.active).length}）`],
                ["inactive", "不在清單"],
              ] as Array<[Filter, string]>
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={styles.tab}
                onClick={() => setFilter(k)}
                style={{
                  background: filter === k ? "rgba(90,145,225,0.18)" : "transparent",
                  color: filter === k ? CIS.blueSoft : CIS.textMute,
                  border: `1px solid ${filter === k ? "rgba(90,145,225,0.42)" : CIS.cardBorder}`,
                }}
              >
                {label}
              </button>
            ))
          : null}
      </div>

      {/* 選取工具列（有選才出現，浮在最上面） */}
      {picked.size > 0 ? (
        <div
          className={styles.selectBar}
          style={{ background: CIS.blue, color: "#fff", border: `1px solid ${CIS.blue}` }}
        >
          <strong style={{ fontSize: 14 }}>已選 {picked.size} 個</strong>
          <button
            type="button"
            onClick={() => setPicked(new Set())}
            style={{ all: "unset", cursor: "pointer", fontSize: 12, opacity: 0.85, textDecoration: "underline" }}
          >
            清除
          </button>
          <div style={{ flex: 1 }} />

          {viewingArchived ? (
            <button
              type="button"
              className={styles.btn}
              style={{ background: "#fff", color: CIS.blue, fontWeight: 700 }}
              disabled={pending}
              onClick={() => runBulk(() => archiveGroupsAction(ids, false))}
            >
              <Icon name="chevronUp" size={14} />
              取消封存（拿回清單）
            </button>
          ) : (
            <>
              <button
                type="button"
                className={styles.btn}
                style={{ background: "rgba(15,23,42,0.16)", color: "#fff" }}
                disabled={pending}
                onClick={() => runBulk(() => bulkToggleGroupsAction(ids, true))}
              >
                <Icon name="success" size={14} />
                加入發文清單
              </button>
              <button
                type="button"
                className={styles.btn}
                style={{ background: "rgba(15,23,42,0.16)", color: "#fff" }}
                disabled={pending}
                onClick={() => runBulk(() => bulkToggleGroupsAction(ids, false))}
              >
                移出發文清單
              </button>
              <button
                type="button"
                className={styles.btn}
                style={{ background: "#fff", color: "#b45309", fontWeight: 700 }}
                disabled={pending}
                onClick={() => runBulk(() => archiveGroupsAction(ids, true))}
              >
                <Icon name="package" size={14} />
                封存這 {picked.size} 個
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* 全選列 + 一鍵封存 */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <label
          className={styles.checkBox}
          style={{ background: CIS.bgSoft, border: `1px solid ${CIS.cardBorder}`, padding: "8px 12px" }}
        >
          <input
            type="checkbox"
            checked={allShownPicked}
            ref={(el) => {
              if (el) el.indeterminate = pickedShown.length > 0 && !allShownPicked;
            }}
            onChange={(e) => pickAllShown(e.target.checked)}
            disabled={shown.length === 0}
          />
          <span style={{ fontWeight: 700 }}>{allShownPicked ? "取消全選" : "選取目前顯示的全部"}</span>
        </label>
        <span style={{ fontSize: 13, color: CIS.textMute }}>
          顯示 {shown.length} 個{!viewingArchived ? ` · 發文清單裡 ${shown.filter((g) => g.active).length} 個` : ""}
        </span>

        {!viewingArchived && picked.size === 0 ? (
          <button
            type="button"
            className={styles.btn}
            style={{ background: "rgba(245,158,11,0.12)", color: "#b45309", borderColor: "rgba(245,158,11,0.3)", marginLeft: "auto" }}
            disabled={pending}
            onClick={archiveSweep}
          >
            <Icon name="cleanup" size={14} />
            把不是海線/台中的都封存
          </button>
        ) : null}
      </div>

      {/* 清單 */}
      {shown.length === 0 ? (
        <div className={styles.empty} style={{ borderColor: CIS.cardBorder, color: CIS.textMute }}>
          {viewingArchived ? "沒有封存的社團。" : "沒有符合的社團。"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {shown.map((g) => {
            const sel = picked.has(g.id);
            return (
              <div
                key={g.id}
                className={styles.groupRow}
                style={{
                  background: sel ? "rgba(90,145,225,0.14)" : CIS.card,
                  borderLeft: `3px solid ${
                    sel ? CIS.blue : g.active && !viewingArchived ? "#22c55e" : "transparent"
                  }`,
                  border: `1px solid ${sel ? "rgba(90,145,225,0.5)" : CIS.cardBorder}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={sel}
                  onChange={() => pick(g.id)}
                  style={{ width: 17, height: 17, accentColor: "#5a91e1", flexShrink: 0, cursor: "pointer", marginTop: 2 }}
                  aria-label={`選取 ${g.name}`}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <a
                      href={g.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 14, fontWeight: 700, color: CIS.text, textDecoration: "none" }}
                    >
                      {g.name}
                    </a>
                    {g.hailine ? (
                      <span
                        className={styles.chip}
                        style={{ background: CHIP.info.bg, color: CHIP.info.color, borderColor: CHIP.info.border }}
                      >
                        海線
                      </span>
                    ) : null}
                    {!viewingArchived ? (
                      <button
                        type="button"
                        className={styles.selectChip}
                        onClick={() => toggleOne(g.id, !g.active)}
                        disabled={pending}
                        title={g.active ? "點一下移出發文清單" : "點一下加入發文清單"}
                        style={
                          g.active
                            ? { background: "rgba(34,197,94,0.18)", color: "#16a34a" }
                            : { background: "rgba(146,152,166,0.14)", color: CIS.textMute }
                        }
                      >
                        {g.active ? "✓ 會發文" : "不發"}
                      </button>
                    ) : null}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      flexWrap: "wrap",
                      marginTop: 4,
                      fontSize: 12,
                      color: CIS.textMute,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: g.memberCount ? CIS.textSub : CIS.textMute }}>
                      <Icon name="users" size={11} /> {g.memberLabel}
                      {g.memberLabel !== "—" ? " 人" : ""}
                    </span>
                    {g.privacy ? <span>{g.privacy === "private" ? "🔒 私密" : "公開"}</span> : null}
                    {g.capability === "both" ? (
                      <span
                        className={styles.chip}
                        style={{ background: CHIP.success.bg, color: CHIP.success.color, borderColor: CHIP.success.border }}
                      >
                        一般貼文 ＋ Marketplace
                      </span>
                    ) : g.capability === "post" ? (
                      <span
                        className={styles.chip}
                        style={{ background: CHIP.info.bg, color: CHIP.info.color, borderColor: CHIP.info.border }}
                      >
                        只能發一般貼文
                      </span>
                    ) : g.capability === "marketplace" ? (
                      <span
                        className={styles.chip}
                        style={{ background: CHIP.warn.bg, color: CHIP.warn.color, borderColor: CHIP.warn.border }}
                      >
                        只能上架 Marketplace
                      </span>
                    ) : g.scanned ? (
                      <span
                        className={styles.chip}
                        style={{ background: CHIP.danger.bg, color: CHIP.danger.color, borderColor: CHIP.danger.border }}
                      >
                        沒有可發的分頁
                      </span>
                    ) : (
                      <span style={{ color: CIS.textMute }}>分頁還沒抓</span>
                    )}
                    {g.needsApproval ? <span style={{ color: "#b45309" }}>要審核</span> : null}
                    {g.lastPostedDays != null ? (
                      <span style={{ color: g.cooling ? "#b45309" : "#16a34a" }}>
                        {g.cooling
                          ? `冷卻中（${g.lastPostedDays}天前貼過，這輪要滿 ${g.effectiveCooldown} 天）`
                          : `${g.lastPostedDays}天前貼過`}
                      </span>
                    ) : null}
                  </div>
                </div>

                {viewingArchived ? (
                  <button
                    type="button"
                    onClick={() => start(async () => flash(await archiveGroupsAction([g.id], false)))}
                    disabled={pending}
                    className={styles.btn}
                    style={{ background: "transparent", color: CIS.blueSoft, borderColor: CIS.cardBorder, flexShrink: 0 }}
                  >
                    取消封存
                  </button>
                ) : (
                  <details onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, position: "relative" }}>
                    <summary
                      style={{
                        cursor: "pointer",
                        listStyle: "none",
                        color: CIS.textMute,
                        fontSize: 12,
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: `1px solid ${CIS.cardBorder}`,
                      }}
                    >
                      設定
                    </summary>
                    <div
                      style={{
                        position: "absolute",
                        right: 0,
                        marginTop: 6,
                        padding: 12,
                        borderRadius: 10,
                        background: CIS.bgSoft,
                        border: `1px solid ${CIS.cardBorder}`,
                        zIndex: 5,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        minWidth: 210,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => start(async () => flash(await archiveGroupsAction([g.id], true)))}
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: CIS.textSub,
                          background: "rgba(146,152,166,0.15)",
                          border: `1px solid ${CIS.cardBorder}`,
                          borderRadius: 7,
                          padding: "7px 10px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          justifyContent: "center",
                        }}
                      >
                        <Icon name="package" size={13} />
                        封存
                      </button>
                      <label style={{ fontSize: 12, color: CIS.textSub }}>
                        幾天內不重複貼
                        <input
                          type="number"
                          min={0}
                          max={90}
                          defaultValue={g.cooldownDays}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (v !== g.cooldownDays) setCooldown(g.id, v);
                          }}
                          className={styles.input}
                          style={{ ...inputStyle, marginTop: 4 }}
                        />
                      </label>
                      <label style={{ fontSize: 12, color: CIS.textSub }}>
                        這個社團收哪一種
                        <select
                          defaultValue={g.accepts}
                          onChange={(e) => setAccepts(g.id, e.target.value)}
                          className={styles.select}
                          style={{ ...inputStyle, marginTop: 4 }}
                        >
                          <option value="both">兩種都收</option>
                          <option value="post">只收一般貼文</option>
                          <option value="marketplace">只收 Marketplace</option>
                        </select>
                        <span style={{ fontSize: 11, color: CIS.textMute }}>重抓社團會照 FB 分頁重設</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => removeOne(g)}
                        style={{
                          fontSize: 12,
                          color: "#e11d48",
                          background: "transparent",
                          border: `1px solid rgba(244,63,94,0.3)`,
                          borderRadius: 6,
                          padding: "5px 8px",
                          cursor: "pointer",
                        }}
                      >
                        永久刪除（不建議）
                      </button>
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 手動加一個 */}
      {!viewingArchived ? (
        <section className={styles.card} style={{ background: CIS.card, border: `1px solid ${CIS.cardBorder}`, marginTop: 18 }}>
          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            style={{
              all: "unset",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
              fontWeight: 700,
              color: CIS.textSub,
              width: "100%",
            }}
          >
            <Icon name="add" size={15} color={CIS.textMute} />
            手動加一個社團（桌機沒抓到的）
            <Icon name={manualOpen ? "chevronUp" : "chevronDown"} size={14} color={CIS.textMute} style={{ marginLeft: "auto" }} />
          </button>
          {manualOpen ? (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea
                className={styles.textarea}
                style={{ ...inputStyle, minHeight: 90 }}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={"名字 | https://www.facebook.com/groups/123456789\n（一行一個，只貼網址也可以）"}
              />
              <div>
                <button
                  type="button"
                  className={styles.btn}
                  style={{ background: CIS.blue, color: "#fff" }}
                  disabled={pending || !raw.trim()}
                  onClick={addManual}
                >
                  <Icon name="add" size={14} />
                  加進清單
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
