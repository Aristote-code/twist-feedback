import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Twist Feedback" };

export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  const { next } = await searchParams;
  // Only send people back to admin pages, never to another site.
  const target = typeof next === "string" && next.startsWith("/admin") ? next : "/admin";
  return <LoginForm next={target} />;
}
