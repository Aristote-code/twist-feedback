"use client";

import { TwistMessenger } from "@/components/twist-messenger";

type Props = {
  theme: "light" | "dark";
  locale: "en" | "de";
  user: { id: string; name: string; hash?: string } | null;
};

export function DemoDashboard({ theme, locale, user }: Props) {
  return (
    <TwistMessenger
      source="parent-dashboard"
      theme={theme}
      locale={locale}
      user={user}
      metadata={{ appVersion: "demo" }}
    />
  );
}
