"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { UpdateRecord } from "@/server/db";
import { AdminTopbar } from "../AdminTopbar";
import styles from "../admin.module.css";

type Loc = { en: string; de: string };
type Editing = { id?: string; publishedAt: string; title: Loc; body: Loc; imageUrl: string; published: boolean };

// <input type="datetime-local"> wants local time without a zone.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AdminUpdates() {
  const router = useRouter();
  const [updates, setUpdates] = useState<{ items: UpdateRecord[]; loadedAt: number } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [version, setVersion] = useState(0);

  const api = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(url, init);
      if (res.status === 401) {
        router.replace("/admin/login");
        throw new Error("Your session ended. Sign in again.");
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      return json as T;
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    api<{ updates: UpdateRecord[] }>("/api/admin/updates")
      .then(({ updates: u }) => !cancelled && setUpdates({ items: u, loadedAt: Date.now() }))
      .catch((err: Error) => !cancelled && setMessage({ kind: "error", text: err.message }));
    return () => {
      cancelled = true;
    };
  }, [api, version]);

  function edit(next: Editing) {
    setEditing(next);
    setConfirmDelete(false);
    setMessage(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      const { id } = await api<{ id: string }>("/api/admin/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editing, publishedAt: new Date(editing.publishedAt).toISOString() }),
      });
      setEditing({ ...editing, id });
      setMessage({ kind: "ok", text: "Saved. Parents see a dot on the Updates tab until they open it." });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editing?.id) return;
    try {
      await api(`/api/admin/updates/${editing.id}`, { method: "DELETE" });
      setEditing(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }

  const setLoc = (field: "title" | "body", lang: "en" | "de", value: string) =>
    setEditing((cur) => cur && { ...cur, [field]: { ...cur[field], [lang]: value } });

  const upcoming = (iso: string) => !!updates && new Date(iso).getTime() > updates.loadedAt;

  return (
    <div className={styles.shell}>
      <AdminTopbar />
      <div className={styles.toolbar}>
        <p className={styles.muted}>Posts in the messenger&apos;s Updates tab, newest first.</p>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() =>
            edit({
              publishedAt: toLocalInput(new Date().toISOString()),
              title: { en: "", de: "" },
              body: { en: "", de: "" },
              imageUrl: "",
              published: true,
            })
          }
        >
          New update
        </button>
      </div>

      <div className={styles.body}>
        <section className={styles.list} aria-label="Updates">
          {!updates && <p className={styles.muted} style={{ padding: 16 }}>Loading…</p>}
          {updates?.items.length === 0 && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No updates yet</p>
              <p>Announce what&apos;s new in Twist. Parents see it in the messenger.</p>
            </div>
          )}
          {updates?.items.map((u) => (
            <button
              key={u.id}
              type="button"
              className={styles.row}
              aria-current={editing?.id === u.id}
              onClick={() =>
                edit({
                  id: u.id,
                  publishedAt: toLocalInput(u.publishedAt),
                  title: u.title,
                  body: u.body,
                  imageUrl: u.imageUrl ?? "",
                  published: u.published,
                })
              }
            >
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{u.title.en}</span>
                <span className={styles.rowSnippet}>{u.body.en}</span>
                <span className={styles.rowMeta}>
                  {new Date(u.publishedAt).toLocaleString()}
                  {!u.title.de && " · German missing"}
                </span>
              </span>
              <span className={styles.pill} data-status={!u.published ? "wont_do" : upcoming(u.publishedAt) ? "in_progress" : "done"}>
                {!u.published ? "Draft" : upcoming(u.publishedAt) ? "Scheduled" : "Published"}
              </span>
            </button>
          ))}
        </section>

        {editing && (
          <aside className={styles.detail} aria-label="Editor">
            <form className={styles.editor} onSubmit={save}>
              <h2 className={styles.detailTitle} style={{ marginTop: 0 }}>
                {editing.id ? "Edit update" : "New update"}
              </h2>
              <label className={styles.field}>
                <span>Title (English)</span>
                <input id="update-title-en" required value={editing.title.en} onChange={(e) => setLoc("title", "en", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Title (German)</span>
                <input id="update-title-de" value={editing.title.de} onChange={(e) => setLoc("title", "de", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Text (English)</span>
                <textarea id="update-body-en" rows={7} value={editing.body.en} onChange={(e) => setLoc("body", "en", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Text (German)</span>
                <textarea id="update-body-de" rows={7} value={editing.body.de} onChange={(e) => setLoc("body", "de", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Publish at</span>
                <input
                  id="update-date"
                  type="datetime-local"
                  required
                  value={editing.publishedAt}
                  onChange={(e) => setEditing({ ...editing, publishedAt: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span>Image link (optional)</span>
                <input
                  id="update-image"
                  type="url"
                  placeholder="https://…"
                  value={editing.imageUrl}
                  onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value })}
                />
              </label>
              <p className={styles.hint}>A later date schedules the post. Without an image, a purple banner is shown.</p>
              <label className={styles.checkbox}>
                <input
                  id="update-published"
                  type="checkbox"
                  checked={editing.published}
                  onChange={(e) => setEditing({ ...editing, published: e.target.checked })}
                />
                Published
              </label>

              {message && <p className={message.kind === "ok" ? styles.okText : styles.errorText}>{message.text}</p>}

              <div className={styles.editorActions}>
                <button type="submit" className={styles.primaryButton} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" className={styles.ghostButton} onClick={() => setEditing(null)}>
                  Close
                </button>
              </div>

              {editing.id && (
                <div className={styles.dangerZone}>
                  {confirmDelete ? (
                    <>
                      <span>Delete this update?</span>
                      <button type="button" className={styles.dangerButton} onClick={remove}>
                        Yes, delete
                      </button>
                      <button type="button" className={styles.ghostButton} onClick={() => setConfirmDelete(false)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className={styles.ghostButton} onClick={() => setConfirmDelete(true)}>
                      Delete
                    </button>
                  )}
                </div>
              )}
            </form>
          </aside>
        )}
      </div>
    </div>
  );
}
