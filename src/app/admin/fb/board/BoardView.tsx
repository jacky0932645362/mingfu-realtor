"use client";
/**
 * 上架／下架看板。
 * 排版照本人給的同業「EZup好上架」截圖：置中大標＋四色分頁籤（可上架／等待上架／完成上架／需處理物件）
 * ＋上方設定說明條＋表格。2026-10-05 改白底（色票走 fb/_ui/theme）。
 *
 * 第二階段（2026-10-05）：每則可以綁太平洋官網物件頁（貼網址或只貼 S 編號），桌機 runner 每天檢查一次，
 * 官網下架（多半是成交）就移到「需處理物件」，本人按「確認成交，封存」收進「已封存」，或按「誤判，恢復」。
 * 排程的寫入只有「取消上架／取消排程」，沿用排程頁的 cancelTaskAction；不會自動幫你取消。
 */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  cancelTaskAction,
  bindPacificUrlAction,
  checkPacificOneAction,
  checkPacificAllAction,
  resetPacificAction,
  archiveDraftAction,
  setRecycleAction,
} from "@/lib/actions/fb-actions";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import type { BoardStage, FbChannel } from "@/lib/fb-factory";
import styles from "./board.module.css";

export type BoardItem = {
  draftId: string;
  title: string;
  stage: BoardStage;
  priceWan: number | null;
  area: string;
  createdAt: string;
  createdTs: number;
  lastPostedAt: string | null;
  lastPostedTs: number;
  runAt: string | null;
  runTs: number;
  overdue: boolean;
  taskId: string | null;
  taskStatus: string | null;
  groups: number;
  targets: number;
  taskFailed: number;
  lastError: string | null;
  postedTargets: number;
  failedTargets: number;
  fbUrl: string | null;
  pacificUrl: string | null;
  pacificId: string;
  pacificStatus: string | null;
  pacificNote: string | null;
  pacificCheckedAt: string | null;
  pacificCheckedTs: number;
  attentionKind: "delisted" | "failed" | "recycle" | null;
  hasPendingTask: boolean;
  recycleEnabled: boolean;
  recycleState: string | null;
  recycleNote: string | null;
  /** 最近一次發到社團＋N 天（沒有掛在社團上就是 null） */
  recycleDueAt: string | null;
  recycleOverdue: boolean;
};

const TABS: Array<{ key: BoardStage; label: string; color: string }> = [
  { key: "ready", label: "可上架", color: "#8b95a7" },
  { key: "waiting", label: "等待上架", color: "#f59e0b" },
  { key: "done", label: "完成上架", color: "#3b82f6" },
  { key: "attention", label: "需處理物件", color: "#ef4444" },
  { key: "archived", label: "已封存", color: "#475569" },
];

const CHANNELS: Array<{ key: FbChannel; label: string }> = [
  { key: "post", label: "一般貼文（主頁＋社團）" },
  { key: "marketplace", label: "Marketplace" },
];

const TIME_HEADER: Record<BoardStage, string> = {
  ready: "建立時間",
  waiting: "預計上架時間",
  done: "上次上架時間",
  attention: "時間",
  archived: "上次上架時間",
};

type SortKey = "title" | "price" | "time";

function fmtPrice(v: number | null) {
  if (v == null) return "—";
  return `${Number.isInteger(v) ? v : v.toFixed(1)} 萬`;
}

export function BoardView({
  channel,
  initialTab,
  items,
  recycleDays,
}: {
  channel: FbChannel;
  initialTab: BoardStage;
  items: BoardItem[];
  recycleDays: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<BoardStage>(initialTab);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({
    key: "time",
    asc: initialTab === "waiting",
  });
  const [checking, startCheck] = useTransition();
  const [checkMsg, setCheckMsg] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<BoardStage, number> = { ready: 0, waiting: 0, done: 0, attention: 0, archived: 0 };
    for (const it of items) c[it.stage]++;
    return c;
  }, [items]);

  const bound = items.filter((it) => it.stage !== "archived" && it.pacificUrl).length;
  const active = items.filter((it) => it.stage !== "archived").length;
  const recycleOn = items.filter((it) => it.recycleEnabled).length;
  // 自動重新曝光只做一般貼文的社團那篇（刪文工具走不到 Marketplace）
  const showRecycle = channel === "post" && (tab === "ready" || tab === "waiting" || tab === "done");

  const current = TABS.find((t) => t.key === tab)!;

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = items.filter(
      (it) =>
        it.stage === tab &&
        (!kw ||
          it.title.toLowerCase().includes(kw) ||
          it.area.toLowerCase().includes(kw) ||
          it.pacificId.toLowerCase().includes(kw) ||
          String(it.priceWan ?? "").includes(kw)),
    );
    // 「時間」欄每一格意思不同：可上架看建立時間、等待看預計時間、完成／封存看上架時間、
    // 需處理裡官網下架的看檢查時間、發文失敗的看排程時間
    const timeOf = (it: BoardItem) =>
      tab === "ready"
        ? it.createdTs
        : tab === "done" || tab === "archived"
          ? it.lastPostedTs
          : it.attentionKind === "delisted"
            ? it.pacificCheckedTs
            : it.runTs;
    list.sort((a, b) => {
      let d = 0;
      if (sort.key === "title") d = a.title.localeCompare(b.title, "zh-Hant");
      else if (sort.key === "price") d = (a.priceWan ?? -1) - (b.priceWan ?? -1);
      else d = timeOf(a) - timeOf(b);
      return sort.asc ? d : -d;
    });
    return list;
  }, [items, tab, q, sort]);

  const switchTab = (key: BoardStage) => {
    setTab(key);
    // 等待上架最想先看「下一筆幾點發」，預設由近到遠；其他分頁看最新的
    setSort({ key: "time", asc: key === "waiting" });
    window.history.replaceState(null, "", `/admin/fb/board?channel=${channel}&tab=${key}`);
  };

  const checkAll = () =>
    startCheck(async () => {
      setCheckMsg("檢查中…（每則約 1～2 秒）");
      const res = await checkPacificAllAction();
      setCheckMsg(res.ok ? res.message || "檢查完成" : res.error || "檢查失敗");
      router.refresh();
    });

  const sortTh = (k: SortKey, label: string, align: "left" | "center" = "center") => (
    <th
      className={styles.sortable}
      style={{ textAlign: align }}
      onClick={() => setSort((s) => ({ key: k, asc: s.key === k ? !s.asc : k !== "time" }))}
    >
      {label}
      <span className={styles.sortMark} style={{ opacity: sort.key === k ? 1 : 0.35 }}>
        {sort.key === k ? (sort.asc ? "▲" : "▼") : "↕"}
      </span>
    </th>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.channelRow}>
        {CHANNELS.map((c) => (
          <Link
            key={c.key}
            href={`/admin/fb/board?channel=${c.key}&tab=${tab}`}
            className={styles.channelPill}
            style={
              c.key === channel
                ? { background: CIS.blue, color: "#fff", borderColor: CIS.blue }
                : { color: CIS.textSub, borderColor: CIS.cardBorder }
            }
          >
            {c.label}
          </Link>
        ))}
      </div>

      <h1 className={styles.title}>上架／下架</h1>
      <div className={styles.titleBar} style={{ background: CIS.blue }} />

      <div className={styles.toolRow}>
        <div className={styles.search} style={{ borderColor: CIS.cardBorder, background: CIS.bgSoft }}>
          <Icon name="search" size={15} color={CIS.textMute} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜尋名稱、區域、價格、官網編號…"
            style={{ color: CIS.text }}
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} className={styles.clear} aria-label="清除搜尋">
              <Icon name="close" size={13} />
            </button>
          ) : null}
        </div>
        <div className={styles.toolBtns}>
          <Link href="/admin/fb/compose" className={styles.toolBtn} style={{ background: "#16a34a" }}>
            <Icon name="add" size={14} /> 新增文案
          </Link>
          <Link href="/admin/fb/schedule" className={styles.toolBtn} style={{ background: "#475569" }}>
            <Icon name="calendar" size={14} /> 排程任務
          </Link>
        </div>
      </div>

      <div className={styles.banner}>
        <div className={styles.bannerMain}>
          <div className={styles.bannerTitle}>
            <Icon name="refresh" size={16} color="#16a34a" />
            <span>
              目前設定：社團貼文發出 <b style={{ color: "#dc2626" }}>{recycleDays} 天</b>後自動下架、再重新上架一次，讓它回到最前面
            </span>
          </div>
          <div className={styles.bannerSub} style={{ color: CIS.textSub }}>
            已幫 {recycleOn} 則打開「自動重新曝光」（每則各自開關，預設關）。桌機只在白天 9～21 點、一次一則：先刪社團舊文，刪完才重貼同一批社團；
            自己動態那篇不動。任何一步失敗會自動關掉、列進「需處理物件」。
            <br />
            太平洋官網：已綁 {bound} / {active} 則，桌機每天檢查一次，官網下架就移到「需處理物件」。
            {checkMsg ? (
              <span style={{ display: "block", marginTop: 4, color: CIS.text, fontWeight: 700 }}>{checkMsg}</span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={checkAll}
          disabled={checking || bound === 0}
          className={styles.bannerBtn}
          title={bound === 0 ? "還沒有任何一則綁官網網址" : ""}
        >
          <Icon name="search" size={15} /> {checking ? "檢查中…" : "立即檢查成交"}
        </button>
      </div>

      <div className={styles.tabs}>
        {TABS.map((t) => {
          const isActive = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => switchTab(t.key)}
              className={styles.tab}
              style={{
                // 白底版本照 EZup：分頁都是實心色塊白字，選中的那個浮起來、其他淡一點
                background: t.color,
                color: "#fff",
                opacity: isActive ? 1 : 0.62,
                transform: isActive ? "translateY(0)" : "translateY(4px)",
              }}
            >
              {t.label}
              <span className={styles.tabCount} style={{ background: isActive ? "rgba(0,0,0,0.28)" : `${t.color}40` }}>
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.tableBox} style={{ borderColor: current.color }}>
        <table className={styles.table}>
          <thead>
            <tr style={{ background: "rgba(15,23,42,0.04)" }}>
              {sortTh("title", "物件名稱", "left")}
              {sortTh("price", "價格")}
              <th>狀態</th>
              {sortTh("time", TIME_HEADER[tab])}
              <th>
                {tab === "done" || tab === "archived"
                  ? "成果"
                  : tab === "attention"
                    ? "原因"
                    : tab === "ready"
                      ? "上次發文"
                      : "發到哪"}
              </th>
              {showRecycle ? <th>自動重新曝光</th> : null}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showRecycle ? 7 : 6} className={styles.emptyCell} style={{ color: CIS.textMute }}>
                  {q ? "沒有符合搜尋的物件" : `「${current.label}」目前沒有物件`}
                </td>
              </tr>
            ) : (
              rows.map((it) => <Row key={it.draftId} it={it} tab={tab} channel={channel} showRecycle={showRecycle} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Tone = "gray" | "orange" | "green" | "red" | "blue";
const TONE: Record<Tone, string> = {
  gray: "#64748b",
  orange: "#d97706",
  green: "#16a34a",
  red: "#dc2626",
  blue: "#2563eb",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const c = TONE[tone];
  return (
    <span className={styles.pill} style={{ background: `${c}1a`, color: c, borderColor: `${c}55` }}>
      {children}
    </span>
  );
}

/** 物件名稱下方那一小行：綁官網／官網狀態／改網址。 */
function PacificTag({ it }: { it: BoardItem }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(it.pacificUrl || "");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await bindPacificUrlAction(it.draftId, value);
      setMsg(res.ok ? res.message || null : res.error || "綁定失敗");
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });

  const recheck = () =>
    start(async () => {
      const res = await checkPacificOneAction(it.draftId);
      setMsg(res.ok ? res.message || null : res.error || "檢查失敗");
      router.refresh();
    });

  if (editing) {
    return (
      <div className={styles.bindRow}>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="貼太平洋官網網址，或只貼 S2906738"
          className={styles.bindInput}
        />
        <button type="button" onClick={save} disabled={pending} className={styles.act} style={{ background: "#16a34a" }}>
          {pending ? "檢查中…" : "儲存"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className={styles.act} style={{ background: "#94a3b8" }}>
          取消
        </button>
        {msg ? <div className={styles.bindMsg}>{msg}</div> : null}
      </div>
    );
  }

  if (!it.pacificUrl) {
    return (
      <div className={styles.pacRow}>
        <button type="button" onClick={() => setEditing(true)} className={styles.linkBtn}>
          ＋綁官網
        </button>
        {msg ? <span className={styles.bindMsg}>{msg}</span> : null}
      </div>
    );
  }

  const st = it.pacificStatus;
  const color =
    st === "ok" ? "#16a34a" : st === "gone" || st === "changed" ? "#dc2626" : st === "never_seen" ? "#d97706" : "#64748b";
  const label =
    st === "ok"
      ? "官網上架中"
      : st === "gone"
        ? "官網已下架"
        : st === "changed"
          ? "官網內容對不上"
          : st === "never_seen"
            ? "連結可能貼錯"
            : "還沒檢查";

  return (
    <div className={styles.pacRow}>
      <a href={it.pacificUrl} target="_blank" rel="noreferrer" className={styles.pacId} style={{ color, borderColor: `${color}55` }}>
        {it.pacificId || "官網"} · {label}
      </a>
      <button type="button" onClick={recheck} disabled={pending} className={styles.linkBtn}>
        {pending ? "檢查中…" : "重新檢查"}
      </button>
      <button type="button" onClick={() => setEditing(true)} className={styles.linkBtn}>
        改
      </button>
      {it.pacificCheckedAt ? <span className={styles.muted}>檢查於 {it.pacificCheckedAt}</span> : null}
      {msg ? <span className={styles.bindMsg}>{msg}</span> : null}
      {st === "ok" && it.pacificNote ? <span className={styles.pacNote}>{it.pacificNote}</span> : null}
    </div>
  );
}

function RecycleSwitch({ it }: { it: BoardItem }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const mid = it.recycleState === "deleting" || it.recycleState === "reposting";
  const toggle = () => {
    const on = !it.recycleEnabled;
    if (on && !window.confirm(`打開「${it.title}」的自動重新曝光？

到期後桌機會自動：先刪掉這則在社團的舊文 → 刪完再重貼到同一批社團（會真的發出去）。自己動態那篇不動。`)) return;
    start(async () => {
      const res = await setRecycleAction(it.draftId, on);
      if (!res.ok) window.alert(res.error || "設定失敗");
      else if (res.message) window.alert(res.message);
      router.refresh();
    });
  };
  return (
    <div className={styles.recycleCell}>
      <button
        type="button"
        role="switch"
        aria-checked={it.recycleEnabled}
        aria-label="自動重新曝光"
        onClick={toggle}
        disabled={pending}
        className={styles.switch}
        style={{ background: it.recycleEnabled ? "#16a34a" : "#cbd5e1" }}
      >
        <span className={styles.knob} style={{ transform: it.recycleEnabled ? "translateX(18px)" : "translateX(0)" }} />
      </button>
      {mid ? (
        <span className={styles.recycleNow}>{it.recycleState === "deleting" ? "♻ 刪舊文中" : "♻ 重貼排隊中"}</span>
      ) : it.recycleEnabled && it.recycleDueAt ? (
        <span className={styles.muted}>
          {it.recycleOverdue ? "已到期，白天 9～21 點會處理" : `預計下架 ${it.recycleDueAt}`}
        </span>
      ) : it.recycleNote ? (
        <span className={styles.muted}>{it.recycleNote}</span>
      ) : null}
    </div>
  );
}

function Row({ it, tab, channel, showRecycle }: { it: BoardItem; tab: BoardStage; channel: FbChannel; showRecycle: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const scheduleHref = `/admin/fb/schedule?draft=${it.draftId}&channel=${channel}`;
  const detailHref = `/admin/fb/library/${it.draftId}?channel=${channel}`;
  const activityHref = `/admin/fb/activity?channel=${channel}`;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) window.alert(res.error || "操作失敗");
      router.refresh();
    });

  const cancel = () => {
    if (!it.taskId) return;
    if (!window.confirm(`取消這筆上架排程？\n\n「${it.title}」${it.runAt}`)) return;
    run(() => cancelTaskAction(it.taskId!));
  };

  const archive = (on: boolean) => {
    const text = on
      ? `把「${it.title}」封存？\n\n只是從看板收起來（移到「已封存」），文案、發文紀錄都不會刪。${
          it.hasPendingTask ? "\n\n⚠️ 這則還有沒發的排程，封存不會自動取消，請先按「取消排程」。" : ""
        }`
      : `把「${it.title}」從已封存拿回來？`;
    if (!window.confirm(text)) return;
    run(() => archiveDraftAction(it.draftId, on));
  };

  const where =
    channel === "marketplace"
      ? "Marketplace"
      : [it.targets - it.groups > 0 ? "主頁" : "", it.groups > 0 ? `${it.groups} 個社團` : ""]
          .filter(Boolean)
          .join("＋") || "—";

  let status: React.ReactNode;
  let sub: string;
  let time: string;
  let col5: React.ReactNode;
  let actions: React.ReactNode;

  if (tab === "ready") {
    status = <Pill tone="gray">○ 可上架</Pill>;
    sub = "按「排程上架」選時間";
    time = it.createdAt;
    col5 = <span className={styles.muted}>{it.lastPostedAt || "還沒發過"}</span>;
    actions = (
      <>
        <Link href={scheduleHref} className={styles.act} style={{ background: "#16a34a" }}>
          排程上架
        </Link>
        <Link href={detailHref} className={styles.act} style={{ background: "#2563eb" }}>
          看內容
        </Link>
      </>
    );
  } else if (tab === "waiting") {
    const running = it.taskStatus === "running";
    status = running ? <Pill tone="blue">▶ 發文中</Pill> : <Pill tone="orange">⏳ 排隊中</Pill>;
    sub = running ? "桌機正在發" : it.overdue ? "已到點，等桌機接手" : "時間到會自動上架";
    time = it.runAt || "—";
    col5 = where;
    actions = (
      <>
        <Link href="/admin/fb/schedule" className={styles.act} style={{ background: "#2563eb" }}>
          改時間
        </Link>
        <button
          type="button"
          onClick={cancel}
          disabled={pending || running}
          className={styles.act}
          style={{ background: "#64748b" }}
        >
          {pending ? "取消中…" : "取消上架"}
        </button>
      </>
    );
  } else if (tab === "done" || tab === "archived") {
    status = tab === "done" ? <Pill tone="green">✓ 已上架</Pill> : <Pill tone="gray">▣ 已封存</Pill>;
    sub = tab === "done" ? "已發到 FB" : "不在看板上追蹤";
    time = it.lastPostedAt || "—";
    col5 = (
      <span>
        {it.postedTargets > 0 ? `${it.postedTargets} 處成功` : tab === "done" ? "已標成發過" : "—"}
        {it.failedTargets > 0 ? <span style={{ color: "#e11d48" }}> · {it.failedTargets} 處失敗</span> : null}
      </span>
    );
    actions =
      tab === "done" ? (
        <>
          {it.fbUrl ? (
            <a href={it.fbUrl} target="_blank" rel="noreferrer" className={styles.act} style={{ background: "#2563eb" }}>
              到FB查看
            </a>
          ) : (
            <Link href={activityHref} className={styles.act} style={{ background: "#2563eb" }}>
              看紀錄
            </Link>
          )}
          <Link href={scheduleHref} className={styles.act} style={{ background: "#16a34a" }}>
            再發一次
          </Link>
        </>
      ) : (
        <button type="button" onClick={() => archive(false)} disabled={pending} className={styles.act} style={{ background: "#2563eb" }}>
          取消封存
        </button>
      );
  } else if (it.attentionKind === "recycle") {
    status = <Pill tone="red">⚠ 重新曝光中斷</Pill>;
    sub = "已自動關掉，沒有重試";
    time = it.lastPostedAt || "—";
    col5 = (
      <span className={styles.reason} title={it.recycleNote || ""}>
        {it.recycleNote || "自動重新曝光途中失敗"}
      </span>
    );
    actions = (
      <>
        <Link href={scheduleHref} className={styles.act} style={{ background: "#ea580c" }}>
          手動排重貼
        </Link>
        <button type="button" onClick={() => run(() => setRecycleAction(it.draftId, true))} disabled={pending} className={styles.act} style={{ background: "#16a34a" }}>
          重新打開
        </button>
        <button type="button" onClick={() => run(() => setRecycleAction(it.draftId, false))} disabled={pending} className={styles.act} style={{ background: "#64748b" }}>
          知道了
        </button>
      </>
    );
  } else if (it.attentionKind === "delisted") {
    status = <Pill tone="red">⚠ 官網已下架</Pill>;
    sub = it.hasPendingTask ? "還有排程沒發！" : "可能已成交";
    time = it.pacificCheckedAt || "—";
    col5 = (
      <span className={styles.reason} title={it.pacificNote || ""}>
        {it.pacificNote || "太平洋官網已經沒有這戶"}
      </span>
    );
    actions = (
      <>
        {it.hasPendingTask && it.taskId ? (
          <button type="button" onClick={cancel} disabled={pending} className={styles.act} style={{ background: "#dc2626" }}>
            取消排程
          </button>
        ) : null}
        <button type="button" onClick={() => archive(true)} disabled={pending} className={styles.act} style={{ background: "#7c3aed" }}>
          確認成交，封存
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("官網其實還在？會重新抓一次官網，確定還在才恢復。")) run(() => resetPacificAction(it.draftId));
          }}
          disabled={pending}
          className={styles.act}
          style={{ background: "#16a34a" }}
        >
          誤判，恢復
        </button>
      </>
    );
  } else {
    const expired = it.taskStatus === "expired";
    status = <Pill tone="red">⚠ {expired ? "逾時沒發" : "發文失敗"}</Pill>;
    sub = expired ? "桌機沒在時限內接手" : "請重新排程";
    time = it.runAt || "—";
    col5 = (
      <span className={styles.reason} title={it.lastError || ""}>
        {it.lastError || (it.taskFailed > 0 ? `${it.taskFailed} 處失敗` : expired ? "超過時限" : "—")}
      </span>
    );
    actions = (
      <>
        <Link href="/admin/fb/schedule" className={styles.act} style={{ background: "#ea580c" }}>
          重新排程
        </Link>
        <Link href={activityHref} className={styles.act} style={{ background: "#64748b" }}>
          看紀錄
        </Link>
      </>
    );
  }

  return (
    <tr>
      <td style={{ textAlign: "left" }}>
        <Link href={detailHref} className={styles.name}>
          {it.title}
        </Link>
        {it.area ? <div className={styles.muted}>{it.area}</div> : null}
        <PacificTag it={it} />
      </td>
      <td className={styles.num}>{fmtPrice(it.priceWan)}</td>
      <td>
        {status}
        <div className={styles.statusSub} style={sub === "還有排程沒發！" ? { color: "#dc2626", fontWeight: 800 } : undefined}>
          {sub}
        </div>
      </td>
      <td className={styles.num}>{time}</td>
      <td className={styles.col5}>{col5}</td>
      {showRecycle ? (
        <td>
          <RecycleSwitch it={it} />
        </td>
      ) : null}
      <td>
        <div className={styles.acts}>{actions}</div>
      </td>
    </tr>
  );
}
