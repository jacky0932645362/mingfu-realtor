import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getAdminCheckArgs, isCurrentUserAdmin } from "@/lib/admin-check";
import { getCustomer } from "@/lib/customer";
import { listShowingsForCustomer } from "@/lib/showing";
import { CIS } from "@/app/admin/_components/cis";
import { Icon } from "@/app/admin/_ui/icons";
import CustomerForm from "../CustomerForm";
import ShowingSection from "../ShowingSection";
import styles from "../customers.module.css";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { email } = await getAdminCheckArgs();
  if (!email) redirect("/api/auth/signin?callbackUrl=%2Fadmin%2Fcustomers");
  if (!(await isCurrentUserAdmin())) throw new Error("權限不足");

  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const showings = await listShowingsForCustomer(id);

  return (
    <main className={styles.page} style={{ background: CIS.bg, color: CIS.text, fontFamily: CIS.font }}>
      <div className={styles.shell}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>
              <Icon name="user" size={26} />
              {customer.name}
            </h1>
            <p className={styles.subtitle} style={{ color: CIS.textSub }}>
              {[customer.phone, customer.line_id ? `LINE ${customer.line_id}` : null].filter(Boolean).join(" ・ ") || "尚未填寫聯絡方式"}
            </p>
          </div>
          <div className={styles.headerActions}>
            {customer.phone ? (
              <a
                href={`tel:${customer.phone}`}
                className={styles.button}
                style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
              >
                <Icon name="mobile" size={16} />
                撥打電話
              </a>
            ) : null}
            <Link
              href="/admin/customers"
              className={styles.button}
              style={{ background: "rgba(255,255,255,0.05)", color: CIS.textSub, border: `1px solid ${CIS.cardBorder}` }}
            >
              返回列表
            </Link>
          </div>
        </div>
        <ShowingSection customerId={customer.id} showings={showings} />
        {/* key 綁 updated_at：帶看紀錄存檔會順便更新客戶的追蹤時間，
            router.refresh() 只會給新 props，不會重新 mount，表單自己的 useState 不會跟著換，
            所以用 key 強制换成新的 instance，讓表單重新從新資料初始化。 */}
        <CustomerForm key={`${customer.id}-${customer.updated_at?.getTime() ?? 0}`} customer={customer} />
      </div>
    </main>
  );
}
