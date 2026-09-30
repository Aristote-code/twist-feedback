"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  HelpIcon,
  HomeIcon,
  MessagesIcon,
  SearchIcon,
  SendIcon,
  UpdatesIcon,
} from "@/components/icons";
import { Bloub } from "@/components/bloub";
import { FeedbackWidget, openFeedbackWidget } from "@/components/feedback-widget";
import { findCategory, type Locale } from "@/lib/feedback/config";
import {
  MESSAGE_MAX,
  MESSENGER_STRINGS,
  QUICK_REPLIES,
  type ChatMessage,
  type ConversationSummary,
  type MessengerContent,
  type SendEvent,
} from "@/lib/messenger/content";
import { plainText, RichText } from "./RichText";
import styles from "./TwistMessenger.module.css";

export type TwistMessengerProps = {
  /** Where the feedback service runs. Leave empty when it's the same app. */
  apiUrl?: string;
  /** Which surface this is, e.g. "parent-dashboard" or "website". */
  source: string;
  theme?: "dark" | "light";
  locale?: Locale;
  /** The signed-in parent. `hash` comes from your server (see README). */
  user?: { id: string; name?: string; email?: string; hash?: string } | null;
  metadata?: Record<string, string>;
  accentColor?: string;
  position?: "right" | "left";
};

type Tab = "home" | "messages" | "help" | "updates";
type Screen =
  | { kind: "tab" }
  | { kind: "chat"; id: string | null }
  | { kind: "collection"; id: string }
  | { kind: "article"; id: string; from: Screen };

type Article = MessengerContent["collections"][number]["articles"][number];
type ChatMode = ConversationSummary["mode"];

const TOKEN_KEY = "twist-messenger-visitor";
const SEEN_KEY = "twist-messenger-seen";
const UPDATES_SEEN_KEY = "twist-messenger-updates-seen";
const POLL_MS = 8000;
const POLL_FAST_MS = 2500; // while the assistant is writing elsewhere
const LIST_POLL_MS = 30000; // new replies for the launcher badge

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode: fall back to memory for this visit */
  }
}

// A shared clock for "5 min ago" labels, ticking every 30 seconds.
let clock = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  if (!clockTimer) {
    clock = Date.now();
    clockTimer = setInterval(() => {
      clock = Date.now();
      clockListeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function useNow(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => clock,
    () => 0,
  );
}

export function TwistMessenger({
  apiUrl = "",
  source,
  theme = "dark",
  locale = "en",
  user = null,
  metadata,
  accentColor,
  position = "right",
}: TwistMessengerProps) {
  const t = MESSENGER_STRINGS[locale];
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [screen, setScreen] = useState<Screen>({ kind: "tab" });
  const [content, setContent] = useState<MessengerContent | null>(null);
  const [updatesUnread, setUpdatesUnread] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [unread, setUnread] = useState<string[]>([]);
  const [chat, setChat] = useState<{ id: string; messages: ChatMessage[]; mode: ChatMode; aiBusy: boolean } | null>(null);
  // The assistant's reply while it's being written: null when idle.
  const [live, setLive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedUpdate, setExpandedUpdate] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const tokenRef = useRef<string | null>(null);
  const seenRef = useRef<Record<string, string> | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const firstName = user?.name?.split(/\s+/)[0];
  const now = useNow();
  const aiOn = content?.ai.enabled ?? false;

  // --- identity ------------------------------------------------------------

  const token = useCallback((): string => {
    if (!tokenRef.current) {
      let value = readStorage(TOKEN_KEY);
      if (!value) {
        value = crypto.randomUUID().replace(/-/g, "");
        writeStorage(TOKEN_KEY, value);
      }
      tokenRef.current = value;
    }
    return tokenRef.current;
  }, []);

  const seen = useCallback((): Record<string, string> => {
    if (!seenRef.current) {
      try {
        seenRef.current = JSON.parse(readStorage(SEEN_KEY) || "{}");
      } catch {
        seenRef.current = {};
      }
    }
    return seenRef.current!;
  }, []);

  const markSeen = useCallback(
    (id: string, at: string) => {
      const map = seen();
      map[id] = at;
      writeStorage(SEEN_KEY, JSON.stringify(map));
      setUnread((u) => u.filter((x) => x !== id));
    },
    [seen],
  );

  const userId = user?.id;
  const userHash = user?.hash;
  const authHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { "X-Twist-Visitor": token() };
    if (userId) headers["X-Twist-User-Id"] = encodeURIComponent(userId);
    if (userHash) headers["X-Twist-User-Hash"] = encodeURIComponent(userHash);
    return headers;
  }, [token, userId, userHash]);

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
      const headers: Record<string, string> = authHeaders();
      if (init.body) headers["Content-Type"] = "application/json";
      const res = await fetch(`${apiUrl}/api/messenger${path}`, { ...init, headers: { ...headers, ...init.headers } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      return json as T;
    },
    [apiUrl, authHeaders],
  );

  // --- data ----------------------------------------------------------------

  // Help centre, updates and whether the assistant is on. Loaded once, and
  // again each time the messenger opens so edits in the admin show up.
  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/messenger/content?locale=${locale}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: MessengerContent) => {
        if (cancelled) return;
        setContent(data);
        const latest = data.updates[0]?.publishedAt;
        const seenAt = readStorage(UPDATES_SEEN_KEY);
        setUpdatesUnread(!!latest && (!seenAt || seenAt < latest));
      })
      .catch(() => {
        if (!cancelled) setContent((c) => c ?? { collections: [], updates: [], ai: { enabled: false } });
      });
    return () => {
      cancelled = true;
    };
  }, [apiUrl, locale, open]);

  // Conversation list: on first load (only for returning visitors, for the
  // unread dot) and whenever the Messages tab is shown.
  useEffect(() => {
    const returning = !!readStorage(TOKEN_KEY) || !!userHash;
    if (!returning && !(open && tab === "messages")) return;
    let cancelled = false;
    request<{ conversations: ConversationSummary[] }>("/conversations")
      .then(({ conversations: list }) => {
        if (cancelled) return;
        setConversations(list);
        const map = seen();
        setUnread(list.filter((c) => c.lastAuthor !== "visitor" && (!map[c.id] || map[c.id] < c.lastMessageAt)).map((c) => c.id));
      })
      .catch(() => {
        if (!cancelled) setConversations((c) => c ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, listVersion, request, seen, userHash]);

  // Returning visitors: look for new replies now and then, so the launcher
  // badge shows up without a reload. Skipped while the page is hidden.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!readStorage(TOKEN_KEY) && !userHash) return;
      setListVersion((v) => v + 1);
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [userHash]);

  // The open conversation: load, then poll for replies while it's on screen.
  const chatId = screen.kind === "chat" ? screen.id : null;
  const remoteBusy = !!(chat && chat.id === chatId && chat.aiBusy && live === null);
  useEffect(() => {
    if (!open || !chatId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      request<{ conversation: ConversationSummary; messages: ChatMessage[] }>(`/conversations/${chatId}`)
        .then(({ conversation, messages }) => {
          if (cancelled) return;
          setChat({ id: chatId, messages, mode: conversation.mode, aiBusy: conversation.aiBusy });
          const last = messages[messages.length - 1];
          if (last) markSeen(chatId, last.createdAt);
          timer = setTimeout(load, conversation.aiBusy ? POLL_FAST_MS : POLL_MS);
        })
        .catch(() => {
          if (cancelled) return;
          setError(t.loadFailed);
          timer = setTimeout(load, POLL_MS);
        });
    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, chatId, request, markSeen, t.loadFailed]);

  const current = chat && chat.id === chatId ? chat : null;
  const messages = current?.messages ?? [];
  // Who answers: the assistant for new conversations when it's on.
  const mode: ChatMode = current?.mode ?? (aiOn ? "ai" : "human");

  // Keep the newest message in view.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, live, remoteBusy, sending, screen.kind]);

  // Escape closes the messenger, unless the feedback popup is on top of it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector("[data-twist-feedback-root] [role='dialog']")) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // --- actions -------------------------------------------------------------

  function goTab(next: Tab) {
    setTab(next);
    setScreen({ kind: "tab" });
    setError(null);
    if (next === "updates" && content?.updates[0]) {
      writeStorage(UPDATES_SEEN_KEY, content.updates[0].publishedAt);
      setUpdatesUnread(false);
    }
  }

  function startChat(id: string | null) {
    setError(null);
    setDraft("");
    setLive(null);
    setScreen({ kind: "chat", id });
  }

  const appendMessage = (id: string, message: ChatMessage) =>
    setChat((c) => {
      if (!c || c.id !== id) return { id, messages: [message], mode: aiOn ? "ai" : "human", aiBusy: false };
      if (c.messages.some((m) => m.id === message.id)) return c;
      return { ...c, messages: [...c.messages, message] };
    });

  async function send(text: string) {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const profile = { name: user?.name, email: user?.email };
    let id = chatId;
    try {
      const res = await fetch(`${apiUrl}/api/messenger${id ? `/conversations/${id}/messages` : "/conversations"}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(
          id ? { ...profile, message: body } : { ...profile, message: body, source, locale, pageUrl: window.location.href, metadata },
        ),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setDraft("");
      if (composerRef.current) composerRef.current.style.height = "";

      // One JSON event per line: the saved message, then the reply as it's written.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (event: SendEvent) => {
        switch (event.type) {
          case "conversation":
            id = event.conversation.id;
            setChat({ id, messages: [], mode: event.conversation.mode, aiBusy: false });
            setScreen({ kind: "chat", id });
            break;
          case "message":
            if (id) appendMessage(id, event.message);
            break;
          case "ai_start":
            setLive("");
            break;
          case "ai_delta":
            setLive((l) => (l ?? "") + event.text);
            break;
          case "ai_message":
            if (id) appendMessage(id, event.message);
            setLive(null);
            break;
          case "mode":
            setChat((c) => (c && c.id === id ? { ...c, mode: event.mode } : c));
            break;
          case "error":
            setLive(null);
            setError(t.sendFailed);
            break;
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) handle(JSON.parse(line) as SendEvent);
        }
      }
      setListVersion((v) => v + 1);
    } catch {
      setError(t.sendFailed);
    } finally {
      setLive(null);
      setSending(false);
    }
  }

  async function askForPerson() {
    if (!chatId) return;
    try {
      const { conversation, message } = await request<{ conversation: ConversationSummary; message: ChatMessage | null }>(
        `/conversations/${chatId}/handoff`,
        { method: "POST" },
      );
      if (message) appendMessage(chatId, message);
      setChat((c) => (c && c.id === chatId ? { ...c, mode: conversation.mode } : c));
    } catch {
      setError(t.sendFailed);
    }
  }

  function onComposerKey(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  }

  const allArticles = content?.collections.flatMap((c) => c.articles) ?? [];
  const findArticle = (id: string) => allArticles.find((a) => a.id === id);

  function openArticle(article: Pick<Article, "id">) {
    setScreen({ kind: "article", id: article.id, from: screen });
  }

  // --- helpers for render --------------------------------------------------

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  function ago(iso: string): string {
    const s = (new Date(iso).getTime() - now) / 1000;
    for (const [unit, size] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const) {
      if (Math.abs(s) >= size) return rtf.format(Math.round(s / size), unit);
    }
    return t.justNow;
  }

  const q = query.trim().toLowerCase();
  const searchResults = q ? allArticles.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(q)) : [];

  const rootStyle = accentColor ? ({ "--m-accent": accentColor } as CSSProperties) : undefined;
  // The bloub is the team's avatar. White with accent eyes on dark surfaces;
  // accent with white eyes on light ones, where white would disappear.
  const accent = accentColor ?? "#4f46e5";
  const avatar = (size: number, animated = false) =>
    theme === "light" ? (
      <Bloub size={size} color={accent} eyes="#ffffff" animated={animated} />
    ) : (
      <Bloub size={size} color="#ffffff" eyes={accent} animated={animated} />
    );

  const authorLabel = (author: ChatMessage["author"], name: string | null) =>
    author === "ai" ? t.assistantName : author === "team" ? name || t.teamName : t.you;

  const navItems: { id: Tab; label: string; Icon: typeof HomeIcon; dot: boolean }[] = [
    { id: "home", label: t.home, Icon: HomeIcon, dot: false },
    { id: "messages", label: t.messages, Icon: MessagesIcon, dot: unread.length > 0 },
    { id: "help", label: t.help, Icon: HelpIcon, dot: false },
    { id: "updates", label: t.updates, Icon: UpdatesIcon, dot: updatesUnread },
  ];

  const closeButton = (
    <button type="button" className={styles.mobileClose} aria-label={t.close} onClick={() => setOpen(false)}>
      <CloseIcon size={18} aria-hidden />
    </button>
  );

  // --- screens -------------------------------------------------------------

  function renderHome() {
    const topArticles = allArticles.slice(0, 3);
    return (
      <div className={styles.scroll}>
        <div className={styles.hero} aria-hidden />
        <div className={styles.homeContent}>
          <div className={styles.homeTop}>
            <Bloub size={72} color="#ffffff" eyes={accent} animated label={aiOn ? t.assistantName : t.teamName} />
          </div>

          <h1 className={styles.greeting}>{firstName ? t.greetingNamed.replace("{name}", firstName) : t.greeting}</h1>
          <h2 className={styles.greetingSub}>{t.howCanWeHelp}</h2>

          <div className={styles.cards}>
            <button type="button" className={styles.card} onClick={() => startChat(null)}>
              <span className={styles.cardTitle}>{t.sendMessage}</span>
              <SendIcon size={16} className={styles.cardIcon} aria-hidden />
            </button>

            <div className={`${styles.card} ${styles.ticketCard}`}>
              <p className={styles.ticketTitle}>{t.submitTicket}</p>
              <button type="button" className={styles.ticketRow} onClick={() => openFeedbackWidget("bug")}>
                <span>{t.bugReport}</span>
                <span className={styles.ticketEmoji} aria-hidden>
                  🐛
                </span>
              </button>
            </div>

            <button type="button" className={styles.card} onClick={() => openFeedbackWidget()}>
              <span className={styles.cardTitle}>{t.leaveFeedback}</span>
              <ChevronRightIcon size={16} className={styles.cardIcon} aria-hidden />
            </button>

            <div className={`${styles.card} ${styles.searchCard}`}>
              <button
                type="button"
                className={styles.searchRow}
                onClick={() => {
                  goTab("help");
                  requestAnimationFrame(() => searchRef.current?.focus());
                }}
              >
                <span>{t.searchHelp}</span>
                <SearchIcon size={16} className={styles.cardIcon} aria-hidden />
              </button>
              {topArticles.map((a) => (
                <button key={a.id} type="button" className={styles.articleRow} onClick={() => openArticle(a)}>
                  {a.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderMessagesTab() {
    return (
      <>
        <header className={styles.barHeader}>
          <p className={styles.barTitle}>{t.messages}</p>
          {closeButton}
        </header>
        {conversations && conversations.length > 0 ? (
          <div className={styles.scroll}>
            <ul className={styles.convList}>
              {conversations.map((c) => (
                <li key={c.id}>
                  <button type="button" className={styles.convRow} onClick={() => startChat(c.id)}>
                    <span className={styles.convAvatar}>{avatar(44)}</span>
                    <span className={styles.convMain}>
                      <span className={styles.convTop}>
                        <span className={styles.convName}>{authorLabel(c.lastAuthor, null)}</span>
                        <span className={styles.convTime}>{ago(c.lastMessageAt)}</span>
                      </span>
                      <span className={`${styles.convPreview} ${unread.includes(c.id) ? styles.unreadText : ""}`}>
                        {plainText(c.lastMessage)}
                      </span>
                    </span>
                    {unread.includes(c.id) && <span className={styles.unreadDot} aria-label="Unread" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.listFooter}>
              <button type="button" className={styles.pillButton} onClick={() => startChat(null)}>
                {t.sendMessage} <SendIcon size={15} aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.empty}>
            <div className={styles.emptyCenter}>
              <MessagesIcon size={28} className={styles.emptyIcon} aria-hidden />
              <p>{conversations ? t.noMessages : t.loading}</p>
            </div>
            <button type="button" className={styles.pillButton} onClick={() => startChat(null)}>
              {t.sendMessage} <SendIcon size={15} aria-hidden />
            </button>
          </div>
        )}
      </>
    );
  }

  function renderChat() {
    const fresh = messages.length === 0 && live === null;
    const last = messages[messages.length - 1];
    const offerPerson = mode === "ai" && !sending && live === null && last?.author === "ai" && !last.meta.handoff;
    const assistant = mode === "ai";
    return (
      <div className={styles.chat}>
        <header className={styles.chatHeader}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t.back}
            onClick={() => goTab(tab === "home" ? "home" : "messages")}
          >
            <ChevronLeftIcon size={20} aria-hidden />
          </button>
          <span className={styles.chatAvatar}>{avatar(40, true)}</span>
          <span className={styles.chatWho}>
            <span className={styles.chatName}>{assistant ? t.assistantName : t.teamName}</span>
            <span className={styles.chatSub}>{assistant ? t.assistantSub : t.replyTime}</span>
          </span>
          {closeButton}
        </header>

        <div className={styles.thread} ref={threadRef} aria-live="polite">
          <div className={styles.botGroup}>
            <div className={`${styles.bubble} ${styles.bubbleTeam}`}>
              <p>{t.welcome1}</p>
              <p>{t.welcome2}</p>
            </div>
            <span className={styles.bubbleMeta}>
              {assistant ? t.assistantName : t.teamName}
              {assistant && <span className={styles.aiBadge}>{t.aiBadge}</span>}
            </span>
          </div>

          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const mine = m.author === "visitor";
            const showMeta = !mine && (next?.author !== m.author || m.meta.sources?.length);
            return (
              <div
                key={m.id}
                className={`${styles.msgRow} ${mine ? styles.msgMine : ""} ${prev?.author === m.author ? styles.msgTight : ""}`}
              >
                <div className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleTeam}`}>
                  {m.author === "visitor" ? m.body : <RichText text={m.body} className={styles.bubbleText} />}
                </div>
                {!!m.meta.sources?.length && (
                  <div className={styles.sources}>
                    <span className={styles.sourcesLabel}>{t.sourcesLabel}</span>
                    {m.meta.sources.map((s) => (
                      <button key={s.id} type="button" className={styles.sourceCard} onClick={() => openArticle(s)}>
                        <HelpIcon size={16} aria-hidden />
                        <span>{findArticle(s.id)?.title ?? s.title}</span>
                        <ChevronRightIcon size={14} aria-hidden />
                      </button>
                    ))}
                  </div>
                )}
                {m.meta.feedback && (
                  <span className={styles.feedbackChip}>
                    <CheckIcon size={14} aria-hidden />
                    {t.feedbackLogged}
                    {findCategory(m.meta.feedback.category) && ` · ${findCategory(m.meta.feedback.category)!.label[locale]}`}
                  </span>
                )}
                {showMeta && (
                  <span className={styles.bubbleMeta}>
                    {authorLabel(m.author, m.authorName)}
                    {m.author === "ai" && <span className={styles.aiBadge}>{t.aiBadge}</span>} · {ago(m.createdAt)}
                  </span>
                )}
              </div>
            );
          })}

          {(live !== null || remoteBusy) && (
            <div className={styles.msgRow}>
              <div className={`${styles.bubble} ${styles.bubbleTeam}`}>
                {live ? (
                  <RichText text={live} className={`${styles.bubbleText} ${styles.liveText}`} />
                ) : (
                  <span className={styles.typing} aria-label={t.writing}>
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
              <span className={styles.bubbleMeta}>
                {t.assistantName}
                <span className={styles.aiBadge}>{t.aiBadge}</span>
              </span>
            </div>
          )}

          {offerPerson && (
            <div className={styles.personRow}>
              <button type="button" className={styles.quickReply} onClick={askForPerson}>
                {t.talkToPerson}
              </button>
            </div>
          )}

          {fresh && <QuickReplies options={QUICK_REPLIES.map((r) => r[locale])} disabled={sending} onPick={send} />}
        </div>

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <textarea
            ref={composerRef}
            id="twist-messenger-composer"
            rows={1}
            value={draft}
            maxLength={MESSAGE_MAX}
            placeholder={t.writeMessage}
            aria-label={t.writeMessage}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={onComposerKey}
            className={styles.composerInput}
          />
          <button type="submit" className={styles.sendButton} aria-label={t.send} disabled={!draft.trim() || sending}>
            <SendIcon size={18} aria-hidden />
          </button>
        </form>
      </div>
    );
  }

  function renderHelp() {
    const collections = content?.collections ?? [];
    return (
      <>
        <header className={`${styles.barHeader} ${styles.barHeaderTall}`}>
          <p className={styles.barTitle}>{t.help}</p>
          {closeButton}
          <input
            ref={searchRef}
            id="twist-messenger-search"
            type="search"
            className={styles.helpSearch}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </header>
        <div className={styles.scroll}>
          {!content ? (
            <p className={styles.noResults}>{t.loading}</p>
          ) : q ? (
            searchResults.length ? (
              <ul className={styles.helpList}>
                {searchResults.map((a) => (
                  <li key={a.id}>
                    <button type="button" className={styles.helpRow} onClick={() => openArticle(a)}>
                      <span className={styles.helpText}>
                        <span className={styles.helpTitle}>{a.title}</span>
                        <span className={styles.helpDesc}>{plainText(a.body)}</span>
                      </span>
                      <ChevronRightIcon size={16} className={styles.chevron} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.noResults}>{t.noResults}</p>
            )
          ) : collections.length ? (
            <ul className={styles.helpList}>
              {collections.map((c) => (
                <li key={c.id}>
                  <button type="button" className={styles.helpRow} onClick={() => setScreen({ kind: "collection", id: c.id })}>
                    <span className={styles.helpText}>
                      <span className={styles.helpTitle}>{c.title}</span>
                      {c.description && <span className={styles.helpDesc}>{c.description}</span>}
                      <span className={styles.helpCount}>
                        {c.articles.length === 1 ? t.article : t.articles.replace("{n}", String(c.articles.length))}
                      </span>
                    </span>
                    <ChevronRightIcon size={16} className={styles.chevron} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.noResults}>{t.noHelp}</p>
          )}
        </div>
      </>
    );
  }

  function renderCollection(id: string) {
    const c = content?.collections.find((x) => x.id === id);
    if (!c) return renderHelp();
    return (
      <>
        <header className={styles.plainHeader}>
          <button type="button" className={styles.iconButton} aria-label={t.back} onClick={() => goTab("help")}>
            <ChevronLeftIcon size={20} aria-hidden />
          </button>
          <p className={styles.barTitle}>{c.title}</p>
          {closeButton}
        </header>
        <div className={styles.scroll}>
          <ul className={styles.helpList}>
            {c.articles.map((a) => (
              <li key={a.id}>
                <button type="button" className={styles.helpRow} onClick={() => openArticle(a)}>
                  <span className={styles.helpText}>
                    <span className={styles.helpTitle}>{a.title}</span>
                  </span>
                  <ChevronRightIcon size={16} className={styles.chevron} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </>
    );
  }

  function renderArticle(id: string, from: Screen) {
    const a = findArticle(id);
    return (
      <>
        <header className={styles.plainHeader}>
          <button type="button" className={styles.iconButton} aria-label={t.back} onClick={() => setScreen(from)}>
            <ChevronLeftIcon size={20} aria-hidden />
          </button>
          {closeButton}
        </header>
        <div className={styles.scroll}>
          {a ? (
            <article className={styles.article}>
              <h3>{a.title}</h3>
              <RichText text={a.body} className={styles.articleBody} />
              <div className={styles.articleFooter}>
                <p>{t.howCanWeHelp}</p>
                <button type="button" className={styles.pillButton} onClick={() => startChat(null)}>
                  {t.sendMessage} <SendIcon size={15} aria-hidden />
                </button>
              </div>
            </article>
          ) : (
            <p className={styles.noResults}>{content ? t.noResults : t.loading}</p>
          )}
        </div>
      </>
    );
  }

  function renderUpdates() {
    const updates = content?.updates ?? [];
    return (
      <>
        <header className={styles.plainHeader}>
          <p className={styles.barTitle}>{t.latestUpdates}</p>
          {closeButton}
        </header>
        <div className={styles.scroll}>
          {!updates.length ? (
            <p className={styles.noResults}>{content ? t.noUpdates : t.loading}</p>
          ) : (
            <div className={styles.updateList}>
              {updates.map((u) => {
                const expanded = expandedUpdate === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`${styles.card} ${styles.updateCard}`}
                    aria-expanded={expanded}
                    onClick={() => setExpandedUpdate(expanded ? null : u.id)}
                  >
                    <UpdateArt imageUrl={u.imageUrl} />
                    <span className={styles.updateText}>
                      <span className={styles.updateDate}>
                        {new Date(u.publishedAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                      <span className={styles.updateTitle}>{u.title}</span>
                      {expanded ? (
                        <RichText text={u.body} className={`${styles.updateBody} ${styles.updateBodyFull}`} />
                      ) : (
                        <span className={styles.updateBody}>{plainText(u.body)}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </>
    );
  }

  let body;
  if (screen.kind === "chat") body = renderChat();
  else if (screen.kind === "collection") body = renderCollection(screen.id);
  else if (screen.kind === "article") body = renderArticle(screen.id, screen.from);
  else if (tab === "messages") body = renderMessagesTab();
  else if (tab === "help") body = renderHelp();
  else if (tab === "updates") body = renderUpdates();
  else body = renderHome();

  const showNav = screen.kind !== "chat";
  const badge = unread.length;

  return (
    <div
      data-twist-messenger-root=""
      className={`${styles.root} ${theme === "light" ? styles.light : ""} ${position === "left" ? styles.left : ""}`}
      style={rootStyle}
    >
      {open && (
        <section className={styles.panel} role="dialog" aria-label="Twist">
          <div className={styles.body}>
            {screen.kind === "tab" && tab === "home" && <div className={styles.homeClose}>{closeButton}</div>}
            {body}
          </div>
          {showNav && (
            <nav className={styles.nav} aria-label="Messenger">
              {navItems.map(({ id, label, Icon, dot }) => (
                <button
                  key={id}
                  type="button"
                  className={styles.navItem}
                  aria-current={tab === id && screen.kind === "tab" ? "page" : undefined}
                  onClick={() => goTab(id)}
                >
                  <span className={styles.navIcon}>
                    <Icon size={22} aria-hidden />
                    {dot && <span className={styles.navDot} />}
                  </span>
                  <span className={styles.navLabel}>{label}</span>
                </button>
              ))}
            </nav>
          )}
        </section>
      )}

      <button
        type="button"
        className={styles.launcher}
        aria-label={open ? t.close : t.open}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDownIcon size={26} strokeWidth={2} aria-hidden /> : <ChatIcon size={26} strokeWidth={1.8} aria-hidden />}
        {!open && badge > 0 && <span className={styles.launcherBadge}>{badge}</span>}
      </button>

      {/* The feedback popup the Home cards open. Its own floating tab stays hidden. */}
      <FeedbackWidget
        apiUrl={apiUrl}
        source={source}
        theme={theme}
        locale={locale}
        user={user}
        metadata={metadata}
        accentColor={accentColor}
        placement={null}
      />
    </div>
  );
}

function QuickReplies({ options, disabled, onPick }: { options: string[]; disabled: boolean; onPick: (text: string) => void }) {
  return (
    <div className={styles.quickReplies}>
      {options.map((text) => (
        <button key={text} type="button" className={styles.quickReply} disabled={disabled} onClick={() => onPick(text)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function UpdateArt({ imageUrl }: { imageUrl: string | null }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- images are URLs entered in the admin
    return <img src={imageUrl} alt="" className={styles.updateImage} />;
  }
  return <span className={`${styles.updateImage} ${styles.updateArt}`} aria-hidden />;
}
