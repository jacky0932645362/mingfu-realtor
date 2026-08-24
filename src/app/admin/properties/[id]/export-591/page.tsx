import { redirect, notFound } from "next/navigation";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { getProperty } from "@/lib/property";
import { build591Package } from "@/lib/export-591";
import { CIS } from "@/app/admin/_components/cis";
import Export591View from "./Export591View";
import styles from "../../../customers/customers.module.css";

export const dynamic = "force-dynamic";

/**
 * 591 上架包（2026-08-24）
 *
 * 這頁會顯示完整門牌（591 上架必填），所以跟其他 /admin/* 一樣要過密碼登入，
 * 絕不能做成公開頁。
 */
export default async function Export591Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fproperties");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const { id } = await params;
  const property = await getProperty(id);
  if (!property) notFound();

  const pkg = build591Package(property);

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <Export591View pkg={pkg} propertyId={property.id} propertyTitle={property.title} />
      </div>
    </main>
  );
}
