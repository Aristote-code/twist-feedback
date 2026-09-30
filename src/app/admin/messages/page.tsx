import { requireAdmin } from "@/server/admin-auth";
import { AdminMessages } from "./AdminMessages";

export const metadata = { title: "Messages · Twist Feedback" };

export default async function MessagesPage() {
  await requireAdmin("/admin/messages");
  return <AdminMessages />;
}
