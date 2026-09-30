import { signUserId } from "@/server/security";
import { DemoDashboard } from "./DemoDashboard";

// A stand-in for the Twist parent dashboard, to try the widget end to end.
// Add ?theme=light and/or ?locale=de to check the other looks and German.
export default async function Home(props: PageProps<"/">) {
  const query = await props.searchParams;
  const theme = query.theme === "light" ? "light" : "dark";
  const locale = query.locale === "de" ? "de" : "en";
  const userId = "demo-parent-1";
  return (
    <DemoDashboard
      theme={theme}
      locale={locale}
      user={{ id: userId, name: "Demo parent", hash: signUserId(userId) ?? undefined }}
    />
  );
}
