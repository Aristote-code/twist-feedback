"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { HelpArticleRecord, HelpCollectionRecord } from "@/server/db";
import { AdminTopbar } from "../AdminTopbar";
import styles from "../admin.module.css";

type Loc = { en: string; de: string };
type Editing =
  | { kind: "collection"; id?: string; title: Loc; description: Loc }
  | { kind: "article"; id?: string; collectionId: string; title: Loc; body: Loc; published: boolean };

const EMPTY: Loc = { en: "", de: "" };

export function AdminHelp() {
  const router = useRouter();
  const [collections, setCollections] = useState<HelpCollectionRecord[] | null>(null);
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
    api<{ collections: HelpCollectionRecord[] }>("/api/admin/help")
      .then(({ collections: c }) => !cancelled && setCollections(c))
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

  const editCollection = (c: HelpCollectionRecord) => edit({ kind: "collection", id: c.id, title: c.title, description: c.description });
  const editArticle = (a: HelpArticleRecord) =>
    edit({ kind: "article", id: a.id, collectionId: a.collectionId, title: a.title, body: a.body, published: a.published });

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setMessage(null);
    try {
      const { id } = await api<{ id: string }>("/api/admin/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      setEditing({ ...editing, id });
      setMessage({ kind: "ok", text: "Saved. The messenger shows it the next time it's opened." });
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
      await api(`/api/admin/help/${editing.kind}/${editing.id}`, { method: "DELETE" });
      setEditing(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }

  const setLoc = (field: "title" | "description" | "body", lang: "en" | "de", value: string) =>
    setEditing((cur) => {
      if (!cur) return cur;
      const prev = (cur as Record<string, unknown>)[field] as Loc;
      return { ...cur, [field]: { ...prev, [lang]: value } } as Editing;
    });

  return (
    <div className={styles.shell}>
      <AdminTopbar />
      <div className={styles.toolbar}>
        <p className={styles.muted}>Articles the messenger&apos;s Help tab shows and the AI assistant answers from.</p>
        <div className={styles.filters}>
          <button type="button" className={styles.ghostButton} onClick={() => edit({ kind: "collection", title: EMPTY, description: EMPTY })}>
            New collection
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!collections?.length}
            onClick={() =>
              edit({ kind: "article", collectionId: collections?.[0]?.id ?? "", title: EMPTY, body: EMPTY, published: true })
            }
          >
            New article
          </button>
        </div>
      </div>

      <div className={styles.body}>
        <section className={styles.list} aria-label="Help centre">
          {!collections && <p className={styles.muted} style={{ padding: 16 }}>Loading…</p>}
          {collections?.length === 0 && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No collections yet</p>
              <p>Create a collection first, then add articles to it.</p>
            </div>
          )}
          {collections?.map((c) => (
            <div key={c.id} className={styles.group}>
              <button
                type="button"
                className={`${styles.row} ${styles.groupHead}`}
                aria-current={editing?.kind === "collection" && editing.id === c.id}
                onClick={() => editCollection(c)}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{c.title.en}</span>
                  <span className={styles.rowMeta}>
                    {c.articles.length} article{c.articles.length === 1 ? "" : "s"}
                    {!c.title.de && " · German title missing"}
                  </span>
                </span>
              </button>
              {c.articles.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`${styles.row} ${styles.childRow}`}
                  aria-current={editing?.kind === "article" && editing.id === a.id}
                  onClick={() => editArticle(a)}
                >
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>{a.title.en}</span>
                    <span className={styles.rowSnippet}>{a.body.en}</span>
                    <span className={styles.rowMeta}>
                      Updated {new Date(a.updatedAt).toLocaleDateString()}
                      {!a.title.de && " · German missing"}
                    </span>
                  </span>
                  <span className={styles.pill} data-status={a.published ? "done" : "wont_do"}>
                    {a.published ? "Published" : "Draft"}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </section>

        {editing && (
          <aside className={styles.detail} aria-label="Editor">
            <form className={styles.editor} onSubmit={save}>
              <h2 className={styles.detailTitle} style={{ marginTop: 0 }}>
                {editing.id ? "Edit" : "New"} {editing.kind === "collection" ? "collection" : "article"}
              </h2>

              {editing.kind === "article" && (
                <label className={styles.field}>
                  <span>Collection</span>
                  <select
                    id="help-collection"
                    className={styles.select}
                    value={editing.collectionId}
                    onChange={(e) => setEditing({ ...editing, collectionId: e.target.value })}
                  >
                    {collections?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title.en}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className={styles.field}>
                <span>Title (English)</span>
                <input id="help-title-en" required value={editing.title.en} onChange={(e) => setLoc("title", "en", e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Title (German)</span>
                <input id="help-title-de" value={editing.title.de} onChange={(e) => setLoc("title", "de", e.target.value)} />
              </label>

              {editing.kind === "collection" ? (
                <>
                  <label className={styles.field}>
                    <span>Description (English)</span>
                    <input id="help-desc-en" value={editing.description.en} onChange={(e) => setLoc("description", "en", e.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>Description (German)</span>
                    <input id="help-desc-de" value={editing.description.de} onChange={(e) => setLoc("description", "de", e.target.value)} />
                  </label>
                </>
              ) : (
                <>
                  <label className={styles.field}>
                    <span>Article (English)</span>
                    <textarea id="help-body-en" rows={9} value={editing.body.en} onChange={(e) => setLoc("body", "en", e.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>Article (German)</span>
                    <textarea id="help-body-de" rows={9} value={editing.body.de} onChange={(e) => setLoc("body", "de", e.target.value)} />
                  </label>
                  <p className={styles.hint}>
                    A blank line starts a new paragraph, lines starting with “- ” become a list, **text** is bold, and links are
                    clickable. Where the German is empty, German readers see the English.
                  </p>
                  <label className={styles.checkbox}>
                    <input
                      id="help-published"
                      type="checkbox"
                      checked={editing.published}
                      onChange={(e) => setEditing({ ...editing, published: e.target.checked })}
                    />
                    Published (shown in the messenger and used by the AI)
                  </label>
                </>
              )}

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
                      <span>
                        {editing.kind === "collection" ? "Delete this collection and every article in it?" : "Delete this article?"}
                      </span>
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
