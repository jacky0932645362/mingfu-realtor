import { notFound } from "next/navigation";
import Link from "next/link";
import { getProperty } from "@/lib/property";
import { directImageUrl, parseImageList } from "@/lib/media-url";
import {
  getFbDraft,
  parseFacts,
  parseMarketplace,
  isChannel,
  fmtDateTime,
  fmtMemberCount,
  listFbGroups,
  MARKETPLACE_CONDITIONS,
  isSocialPlatform,
  socialLabel,
  getSocialVersions,
  type FbChannel,
} from "@/lib/fb-factory";
import { checkSocialPhotos } from "@/lib/social-publish";
import { listIdentities, identityTokenStatus } from "@/lib/fb-identity";
import { deriveIgCaption, deriveThreadsText, IG_CAPTION_LIMIT, THREADS_TEXT_LIMIT } from "@/lib/fb-social-copy";
import { SocialDetail } from "./SocialDetail";
import { buildPostText, checkCopy } from "@/lib/fb-copy";
import { cloudinaryEnabled } from "@/lib/cloudinary";
import { CIS } from "@/app/admin/fb/_ui/theme";
import { Icon } from "@/app/admin/_ui/icons";
import { DraftDetail } from "./DraftDetail";
import styles from "../../fb.module.css";

export const dynamic = "force-dynamic";

export default async function DraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ channel?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const draft = await getFbDraft(id);
  if (!draft) notFound();

  // ?channel=ig｜threads 是 2026-09-21 加的兩個分頁（不是 fb_task 的通路，是同一則文案的另外兩個版本）
  const socialPlatform = isSocialPlatform(sp.channel) ? sp.channel : null;
  const channel: FbChannel = isChannel(sp.channel) ? sp.channel : "post";
  const facts = parseFacts(draft.facts_json);
  const mp = parseMarketplace(draft.marketplace_json);

  // 只有收 Marketplace 的、沒封存的社團才列出來給勾 —— 跟排程頁的社團清單同一套資料。
  // isActive 沿用「社團清單」裡本人已經標好的「會發文」——這就是他要的「常用社團」清單，
  // 不用另外做一套 favorite 機制（2026-09-05 本人要求勾選要能記住常用組合）。
  const mpGroups =
    channel === "marketplace"
      ? (await listFbGroups({ channel: "marketplace" })).map((g) => ({
          id: g.id,
          name: g.name,
          note: fmtMemberCount(g.member_count) !== "—" ? `${fmtMemberCount(g.member_count)} 人` : "",
          isActive: g.is_active === 1,
        }))
      : [];

  // 重新掃一次外洩與 Markdown（文案可能被手動改過）
  let warnings: string[] = [];
  let photos: string[] = [];
  // 手動填的文案：照片自己帶（facts_json.photos），可以直接在這頁改。
  const manualPhotos = !draft.source_property_id;
  if (draft.source_property_id) {
    const prop = await getProperty(draft.source_property_id);
    if (prop) {
      warnings = checkCopy(draft.post_text || "", prop);
      photos = [
        ...(prop.cover_url ? [directImageUrl(prop.cover_url.trim())] : []),
        ...parseImageList(prop.photo_urls),
      ]
        .filter((u, i, a) => u && a.indexOf(u) === i)
        .slice(0, 10);
    }
  } else {
    photos = (facts.photos ?? []).slice(0, 10);
  }

  if (socialPlatform) {
    const versions = getSocialVersions(draft);
    const v = versions[socialPlatform];
    const [idRows, tokenMap, photoChecks] = await Promise.all([
      listIdentities({ onlyActive: true }),
      identityTokenStatus(),
      checkSocialPhotos(socialPlatform, photos),
    ]);
    // 2026-10-09 多組帳號：這個平台連了哪幾組（有授權鑰匙的才列）
    const accounts = idRows
      .filter((r) => r.kind === socialPlatform && tokenMap.has(r.id))
      .map((r) => ({ id: r.id, name: r.name }));
    const tabs = [
      { key: "post", label: "一般貼文", href: `/admin/fb/library/${draft.id}?channel=post` },
      { key: "marketplace", label: "Marketplace", href: draft.marketplace_json ? `/admin/fb/library/${draft.id}?channel=marketplace` : null },
      { key: "ig", label: "Instagram", href: `/admin/fb/library/${draft.id}?channel=ig` },
      { key: "threads", label: "Threads", href: `/admin/fb/library/${draft.id}?channel=threads` },
    ];
    return (
      <>
        <Link
          href="/admin/fb/library?channel=post"
          style={{ color: CIS.textMute, fontSize: 13, textDecoration: "none", display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          <Icon name="chevronLeft" size={14} />
          回貼文庫
        </Link>
        <h1 className={styles.pageTitle} style={{ marginTop: 12 }}>
          {draft.title}
        </h1>
        <div className={styles.meta} style={{ color: CIS.textMute, marginBottom: 20 }}>
          {socialLabel(socialPlatform)} 版本 · 產生於 {fmtDateTime(draft.created_at)}
          {draft.updated_at ? ` · 最後編輯 ${fmtDateTime(draft.updated_at)}` : ""}
        </div>
        <SocialDetail
          draftId={draft.id}
          platform={socialPlatform}
          label={socialLabel(socialPlatform)}
          tabs={tabs}
          text={v.text}
          derivedText={socialPlatform === "ig" ? deriveIgCaption(draft.post_text || "") : deriveThreadsText(draft.post_text || "", facts)}
          edited={v.edited}
          status={v.status}
          url={v.url}
          postedAtText={v.postedAt ? fmtDateTime(v.postedAt) : null}
          limit={socialPlatform === "ig" ? IG_CAPTION_LIMIT : THREADS_TEXT_LIMIT}
          accounts={accounts}
          photos={photoChecks.map((c) => ({ url: c.url, ok: c.ok, reason: c.reason }))}
        />
      </>
    );
  }

  return (
    <>
      <Link
        href={`/admin/fb/library?channel=${channel}`}
        style={{ color: CIS.textMute, fontSize: 13, textDecoration: "none", display: "inline-flex", gap: 6, alignItems: "center" }}
      >
        <Icon name="chevronLeft" size={14} />
        回貼文庫
      </Link>

      <h1 className={styles.pageTitle} style={{ marginTop: 12 }}>
        {draft.title}
      </h1>
      <div className={styles.meta} style={{ color: CIS.textMute, marginBottom: 20 }}>
        產生於 {fmtDateTime(draft.created_at)}
        {draft.updated_at ? ` · 最後編輯 ${fmtDateTime(draft.updated_at)}` : ""}
        {draft.source_property_id ? (
          <>
            {" · "}
            <Link href={`/admin/properties/${draft.source_property_id}`} style={{ color: CIS.blueSoft }}>
              看這筆物件
            </Link>
          </>
        ) : null}
      </div>

      <DraftDetail
        draft={{
          id: draft.id,
          title: draft.title,
          postText: draft.post_text || "",
          postStatus: draft.post_status,
          marketplaceStatus: draft.marketplace_status,
          mpTitle: mp?.title || null,
          mpPrice: mp?.priceTwd ?? null,
          mpDescription: mp?.description || null,
          mpLocation: mp?.location || null,
          mpCondition: mp?.condition || null,
          mpGroupIds: mp?.groupIds || [],
          hasMarketplace: Boolean(draft.marketplace_json),
        }}
        channel={channel}
        photos={photos}
        editablePhotos={manualPhotos}
        photosText={manualPhotos ? (facts.photos ?? []).join("\n") : ""}
        videoText={facts.video || ""}
        uploadEnabled={cloudinaryEnabled()}
        warnings={warnings}
        facts={facts}
        mpGroups={mpGroups}
        mpConditions={MARKETPLACE_CONDITIONS}
      />
    </>
  );
}
