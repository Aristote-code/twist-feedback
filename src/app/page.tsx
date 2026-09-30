import { signUserId } from "@/server/security";
import { DemoDashboard } from "./DemoDashboard";

// A stand-in for the Twist parent dashboard, to try the widget end to end.
// Add ?theme=light and/or ?locale=de to check the other looks and German.
//
// Locally it signs you in as a verified demo parent. Deployed, everyone would
// share that one parent and see each other's conversations, so visitors are
// anonymous instead: each browser only sees its own.
export default async function Home(props: PageProps<"/">) {
  const query = await props.searchParams;
  const theme = query.theme === "light" ? "light" : "dark";
  const locale = query.locale === "de" ? "de" : "en";
  const userId = "demo-parent-1";
  const user =
    process.env.NODE_ENV === "production" ? null : { id: userId, name: "Demo parent", hash: signUserId(userId) ?? undefined };
  return <DemoDashboard theme={theme} locale={locale} user={user} />;
}
