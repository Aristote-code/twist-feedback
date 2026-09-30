"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import styles from "./admin.module.css";

export function AdminTopbar() {
  const router = useRouter();
  const pathname = usePathname();

  async function signOut() {
    await fetch("/api/admin/login", { method: "DELETE" });
    router.replace("/admin/login");
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.topbarLeft}>
        <p className={styles.brand}>Twist Feedback</p>
        <nav className={styles.sections} aria-label="Admin sections">
          <Link href="/admin" aria-current={pathname === "/admin" ? "page" : undefined}>
            Feedback
          </Link>
          <Link href="/admin/messages" aria-current={pathname === "/admin/messages" ? "page" : undefined}>
            Messages
          </Link>
          <Link href="/admin/help" aria-current={pathname === "/admin/help" ? "page" : undefined}>
            Help centre
          </Link>
          <Link href="/admin/updates" aria-current={pathname === "/admin/updates" ? "page" : undefined}>
            Updates
          </Link>
        </nav>
      </div>
      <div className={styles.topbarActions}>
        <Link href="/" className={styles.ghostButton}>
          Open demo page
        </Link>
        <button type="button" className={styles.ghostButton} onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
