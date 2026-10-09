/**
 * 2026-10-09：IG／Threads 帳號（以及新的粉絲專頁）都整合進「發文身分」頁——每一組帳號都是一個身分，可以連好幾組。
 * 這個舊網址留著轉過去，免得書籤或舊連結打不開。
 */
import { redirect } from "next/navigation";

export default function SocialPage() {
  redirect("/admin/fb/identities");
}
