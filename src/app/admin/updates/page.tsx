import { requireAdmin } from "@/server/admin-auth";
import { AdminUpdates } from "./AdminUpdates";

export const metadata = { title: "Updates · Twist Feedback" };

export default async function UpdatesPage() {
  await requireAdmin("/admin/updates");
  return <AdminUpdates />;
}
