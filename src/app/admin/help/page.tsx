import { requireAdmin } from "@/server/admin-auth";
import { AdminHelp } from "./AdminHelp";

export const metadata = { title: "Help centre · Twist Feedback" };

export default async function HelpPage() {
  await requireAdmin("/admin/help");
  return <AdminHelp />;
}
