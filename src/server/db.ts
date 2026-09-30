import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { FeedbackRecord, Status } from "@/lib/feedback/config";
import { HELP_COLLECTIONS, UPDATES, type MessageMeta } from "@/lib/messenger/content";
import { aiEnabled } from "./ai-config";

// All storage goes through this file. To move to Postgres (or Twist's main
// database), reimplement these functions with the same signatures.

type Row = {
  id: string;
  created_at: string;
  updated_at: string;
  category: string;
  post_type: string | null;
  title: string;
  description: string;
  status: Status;
  source: string;
  locale: string | null;
  page_url: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  user_verified: number;
  metadata: string;
  has_screenshot: number;
  screenshot?: string | null;
  internal_note: string;
};

const globalForDb = globalThis as unknown as { twistFeedbackDb?: DatabaseSync };

function db(): DatabaseSync {
  if (globalForDb.twistFeedbackDb) return globalForDb.twistFeedbackDb;

  const file = process.env.FEEDBACK_DB_PATH || path.join(process.cwd(), "data", "feedback.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS feedback (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      category      TEXT NOT NULL,
      post_type     TEXT,
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'new',
      source        TEXT NOT NULL,
      locale        TEXT,
      page_url      TEXT,
      user_id       TEXT,
      user_name     TEXT,
      user_email    TEXT,
      user_verified INTEGER NOT NULL DEFAULT 0,
      metadata      TEXT NOT NULL DEFAULT '{}',
      screenshot    TEXT,
      internal_note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS feedback_created_at ON feedback (created_at DESC);

    CREATE TABLE IF NOT EXISTS conversations (
      id              TEXT PRIMARY KEY,
      owner_key       TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'open',
      source          TEXT NOT NULL,
      locale          TEXT,
      page_url        TEXT,
      user_id         TEXT,
      user_name       TEXT,
      user_email      TEXT,
      user_verified   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS conversations_owner ON conversations (owner_key, last_message_at DESC);
    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      created_at      TEXT NOT NULL,
      author          TEXT NOT NULL,
      author_name     TEXT,
      body            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages (conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS help_collections (
      id             TEXT PRIMARY KEY,
      position       INTEGER NOT NULL DEFAULT 0,
      title_en       TEXT NOT NULL,
      title_de       TEXT NOT NULL DEFAULT '',
      description_en TEXT NOT NULL DEFAULT '',
      description_de TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS help_articles (
      id            TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES help_collections(id) ON DELETE CASCADE,
      position      INTEGER NOT NULL DEFAULT 0,
      title_en      TEXT NOT NULL,
      title_de      TEXT NOT NULL DEFAULT '',
      body_en       TEXT NOT NULL DEFAULT '',
      body_de       TEXT NOT NULL DEFAULT '',
      published     INTEGER NOT NULL DEFAULT 1,
      updated_at    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS updates (
      id           TEXT PRIMARY KEY,
      published_at TEXT NOT NULL,
      title_en     TEXT NOT NULL,
      title_de     TEXT NOT NULL DEFAULT '',
      body_en      TEXT NOT NULL DEFAULT '',
      body_de      TEXT NOT NULL DEFAULT '',
      image_url    TEXT,
      published    INTEGER NOT NULL DEFAULT 1
    );
  `);

  // Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS.
  // Conversations from before the assistant existed were all answered by people.
  addColumn(conn, "conversations", "mode", "mode TEXT NOT NULL DEFAULT 'human'");
  addColumn(conn, "conversations", "topic", "topic TEXT");
  addColumn(conn, "conversations", "handoff_reason", "handoff_reason TEXT");
  addColumn(conn, "conversations", "ai_busy_since", "ai_busy_since TEXT");
  addColumn(conn, "messages", "meta", "meta TEXT NOT NULL DEFAULT '{}'");

  seedContent(conn);
  globalForDb.twistFeedbackDb = conn;
  return conn;
}

function addColumn(conn: DatabaseSync, table: string, column: string, ddl: string) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** First run only: load the starter help centre and updates from lib/messenger/content.ts. */
function seedContent(conn: DatabaseSync) {
  const now = new Date().toISOString();
  const hasHelp = conn.prepare("SELECT 1 FROM help_collections LIMIT 1").get();
  if (!hasHelp) {
    HELP_COLLECTIONS.forEach((c, ci) => {
      conn
        .prepare(
          "INSERT INTO help_collections (id, position, title_en, title_de, description_en, description_de) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(c.id, ci, c.title.en, c.title.de, c.description.en, c.description.de);
      c.articles.forEach((a, ai) => {
        conn
          .prepare(
            `INSERT INTO help_articles (id, collection_id, position, title_en, title_de, body_en, body_de, published, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          )
          .run(a.id, c.id, ai, a.title.en, a.title.de, a.body.en, a.body.de, now);
      });
    });
  }
  const hasUpdates = conn.prepare("SELECT 1 FROM updates LIMIT 1").get();
  if (!hasUpdates) {
    for (const u of UPDATES) {
      conn
        .prepare(
          "INSERT INTO updates (id, published_at, title_en, title_de, body_en, body_de, image_url, published) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
        )
        .run(u.id, new Date(u.date).toISOString(), u.title.en, u.title.de, u.body.en, u.body.de, u.imageUrl ?? null);
    }
  }
}

function toRecord(row: Row): FeedbackRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    category: row.category,
    postType: row.post_type,
    title: row.title,
    description: row.description,
    status: row.status,
    source: row.source,
    locale: row.locale,
    pageUrl: row.page_url,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    userVerified: row.user_verified === 1,
    metadata: JSON.parse(row.metadata || "{}"),
    hasScreenshot: row.has_screenshot === 1,
    ...(row.screenshot !== undefined ? { screenshot: row.screenshot } : {}),
    internalNote: row.internal_note,
  };
}

const LIST_COLUMNS = `id, created_at, updated_at, category, post_type, title, description,
  status, source, locale, page_url, user_id, user_name, user_email, user_verified,
  metadata, (screenshot IS NOT NULL) AS has_screenshot, internal_note`;

export type NewFeedback = {
  category: string;
  postType: string | null;
  title: string;
  description: string;
  source: string;
  locale: string | null;
  pageUrl: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userVerified: boolean;
  metadata: Record<string, string>;
  screenshot: string | null;
};

export function createFeedback(input: NewFeedback): FeedbackRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO feedback (id, created_at, updated_at, category, post_type, title, description,
        source, locale, page_url, user_id, user_name, user_email, user_verified, metadata, screenshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, now, now, input.category, input.postType, input.title, input.description,
      input.source, input.locale, input.pageUrl, input.userId, input.userName, input.userEmail,
      input.userVerified ? 1 : 0, JSON.stringify(input.metadata), input.screenshot,
    );
  return getFeedback(id, { withScreenshot: false })!;
}

export function listFeedback(filter: { status?: Status; category?: string; q?: string } = {}): FeedbackRecord[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }
  if (filter.category) {
    where.push("category = ?");
    params.push(filter.category);
  }
  if (filter.q) {
    where.push("(title LIKE ? OR description LIKE ? OR user_name LIKE ? OR user_email LIKE ?)");
    const like = `%${filter.q}%`;
    params.push(like, like, like, like);
  }
  const sql = `SELECT ${LIST_COLUMNS} FROM feedback ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC LIMIT 1000`;
  return (db().prepare(sql).all(...params) as Row[]).map(toRecord);
}

export function countByStatus(): Record<string, number> {
  const rows = db().prepare("SELECT status, COUNT(*) AS n FROM feedback GROUP BY status").all() as {
    status: string;
    n: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export function getFeedback(id: string, opts: { withScreenshot: boolean }): FeedbackRecord | null {
  const cols = opts.withScreenshot ? `${LIST_COLUMNS}, screenshot` : LIST_COLUMNS;
  const row = db().prepare(`SELECT ${cols} FROM feedback WHERE id = ?`).get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function updateFeedback(id: string, patch: { status?: Status; internalNote?: string }): FeedbackRecord | null {
  const sets: string[] = [];
  const params: string[] = [];
  if (patch.status) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.internalNote !== undefined) {
    sets.push("internal_note = ?");
    params.push(patch.internalNote);
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    params.push(new Date().toISOString());
    db().prepare(`UPDATE feedback SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  }
  return getFeedback(id, { withScreenshot: false });
}

export function deleteFeedback(id: string): boolean {
  return db().prepare("DELETE FROM feedback WHERE id = ?").run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// Messenger conversations. `ownerKey` identifies the visitor: "user:<id>" for
// a verified parent, "anon:<token>" for everyone else (see server/visitor.ts).
//
// `mode` says who answers: "ai" (the assistant replies, the team can step in)
// or "human" (handed over; only the team replies).

export type ConversationOwner = {
  ownerKey: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userVerified: boolean;
};

export type Author = "visitor" | "team" | "ai";
export type ConversationMode = "ai" | "human";

type ConversationRow = {
  id: string;
  owner_key: string;
  created_at: string;
  last_message_at: string;
  status: "open" | "closed";
  mode: ConversationMode;
  topic: string | null;
  handoff_reason: string | null;
  ai_busy_since: string | null;
  source: string;
  locale: string | null;
  page_url: string | null;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  user_verified: number;
  last_message: string | null;
  last_author: Author | null;
};

type MessageRow = {
  id: string;
  created_at: string;
  author: Author;
  author_name: string | null;
  body: string;
  meta: string;
};

export type ConversationRecord = {
  id: string;
  createdAt: string;
  lastMessageAt: string;
  status: "open" | "closed";
  mode: ConversationMode;
  topic: string | null;
  handoffReason: string | null;
  /** The assistant is writing a reply right now. */
  aiBusy: boolean;
  source: string;
  locale: string | null;
  pageUrl: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userVerified: boolean;
  lastMessage: string;
  lastAuthor: Author;
  /** With the team, and the parent (or the assistant handing over) wrote last: a person owes a reply. */
  awaitingReply: boolean;
};

export type MessageRecord = {
  id: string;
  createdAt: string;
  author: Author;
  authorName: string | null;
  body: string;
  meta: MessageMeta;
};

const CONVERSATION_SELECT = `
  SELECT c.*,
    (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_message,
    (SELECT author FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_author
  FROM conversations c`;

// A reply that has been "in progress" this long has crashed; stop showing it.
const AI_BUSY_STALE_MS = 2 * 60 * 1000;

function toConversation(row: ConversationRow): ConversationRecord {
  const lastAuthor = row.last_author ?? "visitor";
  // With the assistant off (no API key), every conversation waits for the team.
  const mode: ConversationMode = row.mode === "human" || !aiEnabled() ? "human" : "ai";
  return {
    id: row.id,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    status: row.status,
    mode,
    topic: row.topic,
    handoffReason: row.handoff_reason,
    aiBusy: !!row.ai_busy_since && Date.now() - new Date(row.ai_busy_since).getTime() < AI_BUSY_STALE_MS,
    source: row.source,
    locale: row.locale,
    pageUrl: row.page_url,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    userVerified: row.user_verified === 1,
    lastMessage: row.last_message ?? "",
    lastAuthor,
    // The team owes a reply when the parent wrote last, or when the assistant
    // wrote last to say it's handing over.
    awaitingReply:
      row.status === "open" &&
      mode === "human" &&
      (lastAuthor === "visitor" || (lastAuthor === "ai" && !!row.handoff_reason)),
  };
}

function toMessage(row: MessageRow): MessageRecord {
  let meta: MessageMeta = {};
  try {
    meta = JSON.parse(row.meta || "{}");
  } catch {
    /* keep empty */
  }
  return { id: row.id, createdAt: row.created_at, author: row.author, authorName: row.author_name, body: row.body, meta };
}

export function createConversation(
  owner: ConversationOwner,
  meta: { source: string; locale: string | null; pageUrl: string | null; mode: ConversationMode },
  firstMessage: string,
): { conversation: ConversationRecord; message: MessageRecord } {
  const id = randomUUID();
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO conversations (id, owner_key, created_at, last_message_at, mode, source, locale, page_url,
        user_id, user_name, user_email, user_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, owner.ownerKey, now, now, meta.mode, meta.source, meta.locale, meta.pageUrl,
      owner.userId, owner.userName, owner.userEmail, owner.userVerified ? 1 : 0,
    );
  const message = addMessage(id, "visitor", owner.userName, firstMessage);
  return { conversation: getConversation(id)!, message };
}

export function addMessage(
  conversationId: string,
  author: Author,
  authorName: string | null,
  body: string,
  meta: MessageMeta = {},
): MessageRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  const conn = db();
  conn
    .prepare("INSERT INTO messages (id, conversation_id, created_at, author, author_name, body, meta) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, conversationId, now, author, authorName, body, JSON.stringify(meta));
  // A new visitor message reopens a closed conversation. A team reply means
  // a person has taken over, so the assistant steps back.
  const extra = author === "visitor" ? ", status = 'open'" : author === "team" ? ", mode = 'human'" : "";
  conn.prepare(`UPDATE conversations SET last_message_at = ?${extra} WHERE id = ?`).run(now, conversationId);
  return { id, createdAt: now, author, authorName, body, meta };
}

export function getConversation(id: string): ConversationRecord | null {
  const row = db().prepare(`${CONVERSATION_SELECT} WHERE c.id = ?`).get(id) as ConversationRow | undefined;
  return row ? toConversation(row) : null;
}

/** The conversation, only if it belongs to this owner. */
export function getOwnedConversation(id: string, ownerKey: string): ConversationRecord | null {
  const row = db().prepare(`${CONVERSATION_SELECT} WHERE c.id = ? AND c.owner_key = ?`).get(id, ownerKey) as
    | ConversationRow
    | undefined;
  return row ? toConversation(row) : null;
}

export function listConversationsForOwner(ownerKey: string): ConversationRecord[] {
  return (
    db().prepare(`${CONVERSATION_SELECT} WHERE c.owner_key = ? ORDER BY c.last_message_at DESC LIMIT 50`).all(ownerKey) as ConversationRow[]
  ).map(toConversation);
}

export function listAllConversations(filter: { status?: "open" | "closed" } = {}): ConversationRecord[] {
  const where = filter.status ? "WHERE c.status = ?" : "";
  const params = filter.status ? [filter.status] : [];
  return (
    db().prepare(`${CONVERSATION_SELECT} ${where} ORDER BY c.last_message_at DESC LIMIT 500`).all(...params) as ConversationRow[]
  ).map(toConversation);
}

export function listMessages(conversationId: string): MessageRecord[] {
  return (
    db()
      .prepare(
        "SELECT id, created_at, author, author_name, body, meta FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid",
      )
      .all(conversationId) as MessageRow[]
  ).map(toMessage);
}

export function countMessages(conversationId: string, author: Author): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND author = ?")
    .get(conversationId, author) as { n: number };
  return row.n;
}

export function setConversationStatus(id: string, status: "open" | "closed"): ConversationRecord | null {
  db().prepare("UPDATE conversations SET status = ? WHERE id = ?").run(status, id);
  return getConversation(id);
}

export function setConversationMode(id: string, mode: ConversationMode, handoffReason: string | null = null): ConversationRecord | null {
  db()
    .prepare("UPDATE conversations SET mode = ?, handoff_reason = ? WHERE id = ?")
    .run(mode, mode === "human" ? handoffReason : null, id);
  return getConversation(id);
}

export function setConversationTopic(id: string, topic: string) {
  db().prepare("UPDATE conversations SET topic = ? WHERE id = ?").run(topic.slice(0, 40), id);
}

/**
 * Marks the assistant as writing. Returns false if another reply is already
 * in progress, so two messages sent quickly don't produce two answers.
 */
export function claimAiTurn(id: string): boolean {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - AI_BUSY_STALE_MS).toISOString();
  const res = db()
    .prepare("UPDATE conversations SET ai_busy_since = ? WHERE id = ? AND (ai_busy_since IS NULL OR ai_busy_since < ?)")
    .run(now.toISOString(), id, staleBefore);
  return res.changes > 0;
}

export function releaseAiTurn(id: string) {
  db().prepare("UPDATE conversations SET ai_busy_since = NULL WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Help centre: collections of articles, in English and German.

type Loc = "en" | "de";

export type HelpArticleRecord = {
  id: string;
  collectionId: string;
  position: number;
  title: Record<Loc, string>;
  body: Record<Loc, string>;
  published: boolean;
  updatedAt: string;
};

export type HelpCollectionRecord = {
  id: string;
  position: number;
  title: Record<Loc, string>;
  description: Record<Loc, string>;
  articles: HelpArticleRecord[];
};

type CollectionRow = {
  id: string;
  position: number;
  title_en: string;
  title_de: string;
  description_en: string;
  description_de: string;
};

type ArticleRow = {
  id: string;
  collection_id: string;
  position: number;
  title_en: string;
  title_de: string;
  body_en: string;
  body_de: string;
  published: number;
  updated_at: string;
};

function toArticle(r: ArticleRow): HelpArticleRecord {
  return {
    id: r.id,
    collectionId: r.collection_id,
    position: r.position,
    title: { en: r.title_en, de: r.title_de },
    body: { en: r.body_en, de: r.body_de },
    published: r.published === 1,
    updatedAt: r.updated_at,
  };
}

export function listHelp(opts: { publishedOnly: boolean }): HelpCollectionRecord[] {
  const conn = db();
  const cols = conn.prepare("SELECT * FROM help_collections ORDER BY position, rowid").all() as CollectionRow[];
  const arts = conn
    .prepare(`SELECT * FROM help_articles ${opts.publishedOnly ? "WHERE published = 1" : ""} ORDER BY position, rowid`)
    .all() as ArticleRow[];
  return cols.map((c) => ({
    id: c.id,
    position: c.position,
    title: { en: c.title_en, de: c.title_de },
    description: { en: c.description_en, de: c.description_de },
    articles: arts.filter((a) => a.collection_id === c.id).map(toArticle),
  }));
}

export function getArticle(id: string): HelpArticleRecord | null {
  const row = db().prepare("SELECT * FROM help_articles WHERE id = ?").get(id) as ArticleRow | undefined;
  return row ? toArticle(row) : null;
}

/** Simple keyword search over published articles, best title matches first. */
export function searchArticles(query: string, limit = 5): HelpArticleRecord[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
    .slice(0, 8);
  const all = (db().prepare("SELECT * FROM help_articles WHERE published = 1").all() as ArticleRow[]).map(toArticle);
  if (!words.length) return all.slice(0, limit);
  return all
    .map((a) => {
      const title = `${a.title.en} ${a.title.de}`.toLowerCase();
      const body = `${a.body.en} ${a.body.de}`.toLowerCase();
      const score = words.reduce((s, w) => s + (title.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0);
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.a);
}

function slug(text: string): string {
  const base = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 50);
  return `${base || "item"}-${randomUUID().slice(0, 6)}`;
}

export function saveCollection(input: {
  id?: string;
  position?: number;
  title: Record<Loc, string>;
  description: Record<Loc, string>;
}): string {
  const conn = db();
  const id = input.id || slug(input.title.en);
  const position =
    input.position ?? (conn.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM help_collections").get() as { p: number }).p;
  conn
    .prepare(
      `INSERT INTO help_collections (id, position, title_en, title_de, description_en, description_de) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET position = excluded.position, title_en = excluded.title_en, title_de = excluded.title_de,
         description_en = excluded.description_en, description_de = excluded.description_de`,
    )
    .run(id, position, input.title.en, input.title.de, input.description.en, input.description.de);
  return id;
}

export function deleteCollection(id: string): boolean {
  return db().prepare("DELETE FROM help_collections WHERE id = ?").run(id).changes > 0;
}

export function saveArticle(input: {
  id?: string;
  collectionId: string;
  position?: number;
  title: Record<Loc, string>;
  body: Record<Loc, string>;
  published: boolean;
}): string {
  const conn = db();
  const id = input.id || slug(input.title.en);
  const position =
    input.position ??
    (
      conn.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM help_articles WHERE collection_id = ?").get(input.collectionId) as {
        p: number;
      }
    ).p;
  conn
    .prepare(
      `INSERT INTO help_articles (id, collection_id, position, title_en, title_de, body_en, body_de, published, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET collection_id = excluded.collection_id, position = excluded.position,
         title_en = excluded.title_en, title_de = excluded.title_de, body_en = excluded.body_en, body_de = excluded.body_de,
         published = excluded.published, updated_at = excluded.updated_at`,
    )
    .run(
      id, input.collectionId, position, input.title.en, input.title.de, input.body.en, input.body.de,
      input.published ? 1 : 0, new Date().toISOString(),
    );
  return id;
}

export function deleteArticle(id: string): boolean {
  return db().prepare("DELETE FROM help_articles WHERE id = ?").run(id).changes > 0;
}

// ---------------------------------------------------------------------------
// Updates (changelog posts shown in the messenger's Updates tab).

export type UpdateRecord = {
  id: string;
  publishedAt: string;
  title: Record<Loc, string>;
  body: Record<Loc, string>;
  imageUrl: string | null;
  published: boolean;
};

type UpdateRow = {
  id: string;
  published_at: string;
  title_en: string;
  title_de: string;
  body_en: string;
  body_de: string;
  image_url: string | null;
  published: number;
};

function toUpdate(r: UpdateRow): UpdateRecord {
  return {
    id: r.id,
    publishedAt: r.published_at,
    title: { en: r.title_en, de: r.title_de },
    body: { en: r.body_en, de: r.body_de },
    imageUrl: r.image_url,
    published: r.published === 1,
  };
}

export function listUpdates(opts: { publishedOnly: boolean }): UpdateRecord[] {
  const where = opts.publishedOnly ? "WHERE published = 1 AND published_at <= ?" : "";
  const params = opts.publishedOnly ? [new Date().toISOString()] : [];
  return (db().prepare(`SELECT * FROM updates ${where} ORDER BY published_at DESC LIMIT 100`).all(...params) as UpdateRow[]).map(
    toUpdate,
  );
}

export function saveUpdate(input: {
  id?: string;
  publishedAt: string;
  title: Record<Loc, string>;
  body: Record<Loc, string>;
  imageUrl: string | null;
  published: boolean;
}): string {
  const id = input.id || slug(input.title.en);
  db()
    .prepare(
      `INSERT INTO updates (id, published_at, title_en, title_de, body_en, body_de, image_url, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET published_at = excluded.published_at, title_en = excluded.title_en, title_de = excluded.title_de,
         body_en = excluded.body_en, body_de = excluded.body_de, image_url = excluded.image_url, published = excluded.published`,
    )
    .run(id, input.publishedAt, input.title.en, input.title.de, input.body.en, input.body.de, input.imageUrl, input.published ? 1 : 0);
  return id;
}

export function deleteUpdate(id: string): boolean {
  return db().prepare("DELETE FROM updates WHERE id = ?").run(id).changes > 0;
}
