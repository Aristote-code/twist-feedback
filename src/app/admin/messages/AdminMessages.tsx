"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CloseIcon, HelpIcon, SendIcon, VerifiedIcon } from "@/components/icons";
import { findCategory } from "@/lib/feedback/config";
import type { ConversationRecord, MessageRecord } from "@/server/db";
import { AdminTopbar } from "../AdminTopbar";
import styles from "../admin.module.css";

type Filter = "needs" | "ai" | "closed" | "all";
const NAME_KEY = "twist-admin-reply-name";

const FILTERS: { id: Filter; label: string; test: (c: ConversationRecord) => boolean }[] = [
  { id: "all", label: "All open", test: (c) => c.status === "open" },
  { id: "needs", label: "Needs a person", test: (c) => c.awaitingReply },
  { id: "ai", label: "With AI", test: (c) => c.status === "open" && c.mode === "ai" },
  { id: "closed", label: "Closed", test: (c) => c.status === "closed" },
];

const TOPIC_LABELS: Record<string, string> = {
  question: "Question",
  bug: "Bug",
  feature_request: "Idea",
  content: "Content",
  account: "Account",
  praise: "Praise",
  other: "Other",
};

function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

function who(c: ConversationRecord): string {
  return c.userName || c.userEmail || "Visitor";
}

function StatusPill({ c }: { c: ConversationRecord }) {
  if (c.status === "closed") return <span className={styles.pill} data-status="wont_do">Closed</span>;
  if (c.awaitingReply) return <span className={styles.pill} data-status="new">Needs reply</span>;
  if (c.mode === "ai") return <span className={styles.pill} data-status="planned">AI</span>;
  return <span className={styles.pill} data-status="done">Replied</span>;
}

export function AdminMessages() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [list, setList] = useState<ConversationRecord[] | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ conversation: ConversationRecord; messages: MessageRecord[] } | null>(null);
  const [reply, setReply] = useState("");
  const [replyName, setReplyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);

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

  // Remember the name the team member replies as, on this computer.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) queueMicrotask(() => setReplyName(saved));
    } catch {
      /* storage blocked */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<{ conversations: ConversationRecord[]; aiEnabled: boolean }>("/api/admin/conversations")
        .then(({ conversations, aiEnabled }) => {
          if (cancelled) return;
          setList(conversations);
          setAiOn(aiEnabled);
        })
        .catch((err: Error) => !cancelled && setError(err.message));
    load();
    const timer = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, version]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const load = () =>
      api<{ conversation: ConversationRecord; messages: MessageRecord[] }>(`/api/admin/conversations/${selectedId}`)
        .then((data) => !cancelled && setThread(data))
        .catch((err: Error) => !cancelled && setError(err.message));
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, selectedId]);

  const open = thread && thread.conversation.id === selectedId ? thread : null;

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open?.messages.length]);

  const all = list ?? [];
  const shown = all.filter(FILTERS.find((f) => f.id === filter)!.test);

  async function sendReply(e?: FormEvent | { preventDefault(): void }) {
    e?.preventDefault();
    if (!open || !reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/conversations/${open.conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply, authorName: replyName }),
      });
      const fresh = await api<{ conversation: ConversationRecord; messages: MessageRecord[] }>(
        `/api/admin/conversations/${open.conversation.id}`,
      );
      setThread(fresh);
      setReply("");
      setVersion((v) => v + 1);
      try {
        localStorage.setItem(NAME_KEY, replyName);
      } catch {
        /* storage blocked */
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(change: { status?: "open" | "closed"; mode?: "ai" | "human" }) {
    if (!open) return;
    try {
      const { conversation } = await api<{ conversation: ConversationRecord }>(`/api/admin/conversations/${open.conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      setThread((t) => t && { ...t, conversation });
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className={styles.shell}>
      <AdminTopbar />

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Filter conversations">
          {FILTERS.filter((f) => aiOn || f.id !== "ai").map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={styles.tab} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className={styles.count}>{all.filter(f.test).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.body}>
        <section className={styles.list} aria-label="Conversations">
          {error && <p className={styles.errorText}>{error}</p>}
          {list && shown.length === 0 && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>{all.length === 0 ? "No conversations yet" : "Nothing here"}</p>
              <p>
                {all.length === 0
                  ? "When a parent writes through the messenger, the conversation shows up here."
                  : "Try another filter."}
              </p>
            </div>
          )}
          {shown.map((c) => (
            <button key={c.id} type="button" className={styles.row} aria-current={c.id === selectedId} onClick={() => setSelectedId(c.id)}>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>
                  {who(c)}
                  {c.userVerified && <VerifiedIcon size={14} className={styles.inlineBadge} aria-label="Verified" />}
                </span>
                <span className={styles.rowSnippet}>
                  {c.lastAuthor === "team" ? "You: " : c.lastAuthor === "ai" ? "AI: " : ""}
                  {c.lastMessage}
                </span>
                <span className={styles.rowMeta}>
                  {c.topic && <span className={styles.topicChip}>{TOPIC_LABELS[c.topic] ?? c.topic}</span>}
                  {c.source} · {timeAgo(c.lastMessageAt)}
                  {c.aiBusy && " · AI is writing…"}
                </span>
              </span>
              <StatusPill c={c} />
            </button>
          ))}
        </section>

        {selectedId && (
          <aside className={`${styles.detail} ${styles.threadPanel}`} aria-label="Conversation">
            <button type="button" className={styles.closeDetail} aria-label="Close conversation" onClick={() => setSelectedId(null)}>
              <CloseIcon size={16} aria-hidden />
            </button>
            {!open ? (
              <p className={styles.muted}>Loading…</p>
            ) : (
              <>
                <div>
                  <h2 className={styles.detailTitle} style={{ marginTop: 0 }}>
                    {who(open.conversation)}
                    {open.conversation.userVerified && (
                      <span className={styles.verified}>
                        <VerifiedIcon size={14} aria-hidden /> Verified
                      </span>
                    )}
                  </h2>
                  <p className={styles.muted}>
                    {[open.conversation.userEmail, open.conversation.source, open.conversation.locale].filter(Boolean).join(" · ")}
                  </p>
                </div>

                <div className={styles.modeBar} data-mode={open.conversation.mode}>
                  {open.conversation.mode === "ai" ? (
                    <>
                      <span>
                        <strong>The AI assistant is answering.</strong> Replying yourself takes over.
                      </span>
                      <button type="button" className={styles.ghostButton} onClick={() => patch({ mode: "human" })}>
                        Take over
                      </button>
                    </>
                  ) : (
                    <>
                      <span>
                        <strong>Handled by the team.</strong>
                        {open.conversation.handoffReason && ` ${open.conversation.handoffReason}`}
                      </span>
                      {aiOn ? (
                        <button type="button" className={styles.ghostButton} onClick={() => patch({ mode: "ai" })}>
                          Let the AI answer
                        </button>
                      ) : (
                        <span className={styles.muted}>AI assistant off: add an Anthropic API key to turn it on.</span>
                      )}
                    </>
                  )}
                </div>

                <div className={styles.threadMessages} ref={threadRef}>
                  {open.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`${styles.adminMsg} ${m.author === "team" ? styles.adminMsgTeam : ""} ${m.author === "ai" ? styles.adminMsgAi : ""}`}
                    >
                      <div className={styles.adminBubble}>{m.body}</div>
                      {!!m.meta.sources?.length && (
                        <span className={styles.adminMetaRow}>
                          <HelpIcon size={13} aria-hidden /> Articles: {m.meta.sources.map((s) => s.title).join(", ")}
                        </span>
                      )}
                      {m.meta.feedback && (
                        <span className={styles.adminMetaRow}>
                          <CheckIcon size={13} aria-hidden /> Logged as {findCategory(m.meta.feedback.category)?.label.en ?? "feedback"}: “
                          {m.meta.feedback.title}” (see Feedback)
                        </span>
                      )}
                      {m.meta.handoff && <span className={styles.adminMetaRow}>Handed to the team</span>}
                      <span className={styles.adminMeta}>
                        {m.author === "team" ? m.authorName || "Twist team" : m.author === "ai" ? "AI assistant" : who(open.conversation)} ·{" "}
                        {timeAgo(m.createdAt)}
                      </span>
                    </div>
                  ))}
                  {open.conversation.aiBusy && <p className={styles.muted}>The AI is writing a reply…</p>}
                </div>

                <form className={styles.replyForm} onSubmit={sendReply}>
                  <textarea
                    id="admin-reply"
                    rows={3}
                    placeholder="Write a reply. The parent sees it in the messenger. Ctrl/⌘ + Enter sends."
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendReply(e);
                    }}
                  />
                  <div className={styles.replyActions}>
                    <label className={styles.replyName}>
                      <span>Reply as</span>
                      <input id="admin-reply-name" value={replyName} placeholder="Twist team" onChange={(e) => setReplyName(e.target.value)} />
                    </label>
                    <button type="submit" className={styles.primaryButton} disabled={busy || !reply.trim()}>
                      <SendIcon size={15} aria-hidden /> Send reply
                    </button>
                  </div>
                </form>

                <div className={styles.dangerZone}>
                  {open.conversation.status === "open" ? (
                    <button type="button" className={styles.ghostButton} onClick={() => patch({ status: "closed" })}>
                      Mark as closed
                    </button>
                  ) : (
                    <button type="button" className={styles.ghostButton} onClick={() => patch({ status: "open" })}>
                      Reopen
                    </button>
                  )}
                  {open.conversation.pageUrl && (
                    <span className={styles.muted}>Started on {open.conversation.pageUrl.replace(/^https?:\/\//, "")}</span>
                  )}
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
