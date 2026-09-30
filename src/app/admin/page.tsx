import { requireAdmin } from "@/server/admin-auth";
import { AdminInbox } from "./AdminInbox";

export const metadata = { title: "Inbox · Twist Feedback" };

export default async function AdminPage() {
  await requireAdmin("/admin");
  return <AdminInbox />;
}
