"use client";

import { useState, type FormEvent } from "react";
import styles from "../admin.module.css";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (res?.ok) {
      window.location.assign(next);
      return;
    }
    const json = (await res?.json().catch(() => null)) as { error?: string } | null;
    setError(json?.error ?? "Couldn't reach the server. Check that it's running and try again.");
    setBusy(false);
  }

  return (
    <main className={styles.loginPage}>
      <form className={styles.loginCard} onSubmit={submit}>
        <p className={styles.brand}>Twist Feedback</p>
        <h1 className={styles.loginTitle}>Sign in to the inbox</h1>
        <label className={styles.field}>
          <span>Admin password</span>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p role="alert" className={styles.errorText}>
            {error}
          </p>
        )}
        <button type="submit" className={styles.primaryButton} disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
