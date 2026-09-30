import "server-only";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { FeedbackRecord, Status } from "@/lib/feedback/config";
import { HELP_COLLECTIONS, UPDATES, type MessageMeta } from "@/lib/messenger/content";
import { aiEnabled } from "./ai-config";

// All storage goes through this file. It runs the same SQL on two databases:
// - Postgres when DATABASE_URL is set. Create the tables first with the files
//   in db/migrations/.
// - SQLite in a local file otherwise (./data/feedback.db, or FEEDBACK_DB_PATH),
//   created on first use. Good for development and a single server with a disk.
//   On serverless hosting (Netlify) without DATABASE_URL, the file goes in the
//   temporary folder: fine for a demo, but it resets whenever the host restarts
//   the function, so set DATABASE_URL to keep data.

type Value = string | number | null;

type Driver = {
  dialect: "sqlite" | "postgres";
  all<T>(sql: string, params?: Value[]): Promise<T[]>;
  /** Runs a statement; returns the number of rows it changed. */
  run(sql: string, params?: Value[]): Promise<number>;
};

const globalForDb = globalThis as unknown as { twistFeedbackStore?: Promise<Driver> };

function db(): Promise<Driver> {
  globalForDb.twistFeedbackStore ??= connect().catch((err) => {
    globalForDb.twistFeedbackStore = undefined; // try again on the next request
    throw err;
  });
  return globalForDb.twistFeedbackStore;
}

async function connect(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  const driver = url ? await postgres(url) : await sqlite();
  await seedContent(driver);
  return driver;
}

async function postgres(connectionString: string): Promise<Driver> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString, max: 5 });
  // A dropped idle connection must not crash the function.
  pool.on("error", (err: Error) => console.error("[db] idle connection error", err));
  // Postgres numbers its placeholders; this file writes `?` for both databases.
  const numbered = (sql: string) => {
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
  };
  return {
    dialect: "postgres",
    async all<T>(sql: string, params: Value[] = []) {
      const res = await pool.query(numbered(sql), params);
      return res.rows as T[];
    },
    async run(sql: string, params: Value[] = []) {
      const res = await pool.query(numbered(sql), params);
      return res.rowCount ?? 0;
    },
  };
}

async function sqlite(): Promise<Driver> {
  const { DatabaseSync } = await import("node:sqlite");
  // Serverless functions can only write to the temporary folder.
  const serverless = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  const file =
    process.env.FEEDBACK_DB_PATH ||
    (serverless ? path.join(os.tmpdir(), "twist-feedback.db") : path.join(process.cwd(), "data", "feedback.db"));
  if (serverless && !process.env.FEEDBACK_DB_PATH) {
    console.warn("[db] No DATABASE_URL: using temporary demo storage, which resets when the function restarts.");
  }
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
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS.
  // Conversations from before the assistant existed were all answered by people.
  addColumn(conn, "conversations", "mode", "mode TEXT NOT NULL DEFAULT 'human'");
  addColumn(conn, "conversations", "topic", "topic TEXT");
  addColumn(conn, "conversations", "handoff_reason", "handoff_reason TEXT");
  addColumn(conn, "conversations", "ai_busy_since", "ai_busy_since TEXT");
  addColumn(conn, "messages", "meta", "meta TEXT NOT NULL DEFAULT '{}'");

  return {
    dialect: "sqlite",
    async all<T>(sql: string, params: Value[] = []) {
      return conn.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: Value[] = []) {
      return Number(conn.prepare(sql).run(...params).changes);
    },
  };
}

function addColumn(conn: DatabaseSync, table: string, column: string, ddl: string) {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/** Insertion order, to break ties when rows share a timestamp or position. */
function seq(d: Driver, alias?: string): string {
  const col = d.dialect === "sqlite" ? "rowid" : "seq";
  return alias ? `${alias}.${col}` : col;
}

async function first<T>(sql: string, params: Value[] = []): Promise<T | undefined> {
  return (await (await db()).all<T>(sql, params))[0];
}

/**
 * Loads the starter help centre and updates from lib/messenger/content.ts,
 * once per database. Deleting them later doesn't bring them back.
 */
async function seedContent(d: Driver) {
  const done = await d.all("SELECT 1 FROM settings WHERE key = 'seeded'");
  if (done.length) return;
  // Databases from before this flag already have their content.
  const existing = await d.all("SELECT 1 FROM help_collections LIMIT 1");
  if (!existing.length) {
    const now = new Date().toISOString();
    for (const [ci, c] of HELP_COLLECTIONS.entries()) {
      await d.run(
        `INSERT INTO help_collections (id, position, title_en, title_de, description_en, description_de)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        [c.id, ci, c.title.en, c.title.de, c.description.en, c.description.de],
      );
      for (const [ai, a] of c.articles.entries()) {
        await d.run(
          `INSERT INTO help_articles (id, collection_id, position, title_en, title_de, body_en, body_de, published, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT (id) DO NOTHING`,
          [a.id, c.id, ai, a.title.en, a.title.de, a.body.en, a.body.de, now],
        );
      }
    }
    for (const u of UPDATES) {
      await d.run(
        `INSERT INTO updates (id, published_at, title_en, title_de, body_en, body_de, image_url, published)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT (id) DO NOTHING`,
        [u.id, new Date(u.date).toISOString(), u.title.en, u.title.de, u.body.en, u.body.de, u.imageUrl ?? null],
      );
    }
  }
  await d.run("INSERT INTO settings (key, value) VALUES ('seeded', ?) ON CONFLICT (key) DO NOTHING", [new Date().toISOString()]);
}

// ---------------------------------------------------------------------------
// Feedback

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
    userVerified: Number(row.user_verified) === 1,
    metadata: JSON.parse(row.metadata || "{}"),
    hasScreenshot: Number(row.has_screenshot) === 1,
    ...(row.screenshot !== undefined ? { screenshot: row.screenshot } : {}),
    internalNote: row.internal_note,
  };
}

const LIST_COLUMNS = `id, created_at, updated_at, category, post_type, title, description,
  status, source, locale, page_url, user_id, user_name, user_email, user_verified,
  metadata, CASE WHEN screenshot IS NULL THEN 0 ELSE 1 END AS has_screenshot, internal_note`;

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

export async function createFeedback(input: NewFeedback): Promise<FeedbackRecord> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await (await db()).run(
    `INSERT INTO feedback (id, created_at, updated_at, category, post_type, title, description,
      source, locale, page_url, user_id, user_name, user_email, user_verified, metadata, screenshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, now, now, input.category, input.postType, input.title, input.description,
      input.source, input.locale, input.pageUrl, input.userId, input.userName, input.userEmail,
      input.userVerified ? 1 : 0, JSON.stringify(input.metadata), input.screenshot,
    ],
  );
  return (await getFeedback(id, { withScreenshot: false }))!;
}

export async function listFeedback(filter: { status?: Status; category?: string; q?: string } = {}): Promise<FeedbackRecord[]> {
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
    // LOWER() on both sides: Postgres LIKE is case-sensitive, SQLite's isn't.
    where.push(
      "(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(COALESCE(user_name, '')) LIKE ? OR LOWER(COALESCE(user_email, '')) LIKE ?)",
    );
    const like = `%${filter.q.toLowerCase()}%`;
    params.push(like, like, like, like);
  }
  const sql = `SELECT ${LIST_COLUMNS} FROM feedback ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC LIMIT 1000`;
  return (await (await db()).all<Row>(sql, params)).map(toRecord);
}

export async function countByStatus(): Promise<Record<string, number>> {
  const rows = await (await db()).all<{ status: string; n: number | string }>(
    "SELECT status, COUNT(*) AS n FROM feedback GROUP BY status",
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export async function getFeedback(id: string, opts: { withScreenshot: boolean }): Promise<FeedbackRecord | null> {
  const cols = opts.withScreenshot ? `${LIST_COLUMNS}, screenshot` : LIST_COLUMNS;
  const row = await first<Row>(`SELECT ${cols} FROM feedback WHERE id = ?`, [id]);
  return row ? toRecord(row) : null;
}

export async function updateFeedback(id: string, patch: { status?: Status; internalNote?: string }): Promise<FeedbackRecord | null> {
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
    await (await db()).run(`UPDATE feedback SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  return getFeedback(id, { withScreenshot: false });
}

export async function deleteFeedback(id: string): Promise<boolean> {
  return (await (await db()).run("DELETE FROM feedback WHERE id = ?", [id])) > 0;
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

function conversationSelect(d: Driver): string {
  const latest = `FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, ${seq(d, "m")} DESC LIMIT 1`;
  return `
    SELECT c.id, c.owner_key, c.created_at, c.last_message_at, c.status, c.mode, c.topic, c.handoff_reason,
      c.ai_busy_since, c.source, c.locale, c.page_url, c.user_id, c.user_name, c.user_email, c.user_verified,
      (SELECT m.body ${latest}) AS last_message,
      (SELECT m.author ${latest}) AS last_author
    FROM conversations c`;
}

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
    userVerified: Number(row.user_verified) === 1,
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

export async function createConversation(
  owner: ConversationOwner,
  meta: { source: string; locale: string | null; pageUrl: string | null; mode: ConversationMode },
  firstMessage: string,
): Promise<{ conversation: ConversationRecord; message: MessageRecord }> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await (await db()).run(
    `INSERT INTO conversations (id, owner_key, created_at, last_message_at, mode, source, locale, page_url,
      user_id, user_name, user_email, user_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, owner.ownerKey, now, now, meta.mode, meta.source, meta.locale, meta.pageUrl,
      owner.userId, owner.userName, owner.userEmail, owner.userVerified ? 1 : 0,
    ],
  );
  const message = await addMessage(id, "visitor", owner.userName, firstMessage);
  return { conversation: (await getConversation(id))!, message };
}

export async function addMessage(
  conversationId: string,
  author: Author,
  authorName: string | null,
  body: string,
  meta: MessageMeta = {},
): Promise<MessageRecord> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const d = await db();
  await d.run("INSERT INTO messages (id, conversation_id, created_at, author, author_name, body, meta) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    id, conversationId, now, author, authorName, body, JSON.stringify(meta),
  ]);
  // A new visitor message reopens a closed conversation. A team reply means
  // a person has taken over, so the assistant steps back.
  const extra = author === "visitor" ? ", status = 'open'" : author === "team" ? ", mode = 'human'" : "";
  await d.run(`UPDATE conversations SET last_message_at = ?${extra} WHERE id = ?`, [now, conversationId]);
  return { id, createdAt: now, author, authorName, body, meta };
}

export async function getConversation(id: string): Promise<ConversationRecord | null> {
  const d = await db();
  const row = (await d.all<ConversationRow>(`${conversationSelect(d)} WHERE c.id = ?`, [id]))[0];
  return row ? toConversation(row) : null;
}

/** The conversation, only if it belongs to this owner. */
export async function getOwnedConversation(id: string, ownerKey: string): Promise<ConversationRecord | null> {
  const d = await db();
  const row = (await d.all<ConversationRow>(`${conversationSelect(d)} WHERE c.id = ? AND c.owner_key = ?`, [id, ownerKey]))[0];
  return row ? toConversation(row) : null;
}

export async function listConversationsForOwner(ownerKey: string): Promise<ConversationRecord[]> {
  const d = await db();
  const rows = await d.all<ConversationRow>(
    `${conversationSelect(d)} WHERE c.owner_key = ? ORDER BY c.last_message_at DESC LIMIT 50`,
    [ownerKey],
  );
  return rows.map(toConversation);
}

export async function listAllConversations(filter: { status?: "open" | "closed" } = {}): Promise<ConversationRecord[]> {
  const d = await db();
  const where = filter.status ? "WHERE c.status = ?" : "";
  const params = filter.status ? [filter.status] : [];
  const rows = await d.all<ConversationRow>(`${conversationSelect(d)} ${where} ORDER BY c.last_message_at DESC LIMIT 500`, params);
  return rows.map(toConversation);
}

export async function listMessages(conversationId: string): Promise<MessageRecord[]> {
  const d = await db();
  const rows = await d.all<MessageRow>(
    `SELECT id, created_at, author, author_name, body, meta FROM messages WHERE conversation_id = ? ORDER BY created_at, ${seq(d)}`,
    [conversationId],
  );
  return rows.map(toMessage);
}

export async function countMessages(conversationId: string, author: Author): Promise<number> {
  const row = await first<{ n: number | string }>("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND author = ?", [
    conversationId,
    author,
  ]);
  return Number(row?.n ?? 0);
}

export async function setConversationStatus(id: string, status: "open" | "closed"): Promise<ConversationRecord | null> {
  await (await db()).run("UPDATE conversations SET status = ? WHERE id = ?", [status, id]);
  return getConversation(id);
}

export async function setConversationMode(
  id: string,
  mode: ConversationMode,
  handoffReason: string | null = null,
): Promise<ConversationRecord | null> {
  await (await db()).run("UPDATE conversations SET mode = ?, handoff_reason = ? WHERE id = ?", [
    mode,
    mode === "human" ? handoffReason : null,
    id,
  ]);
  return getConversation(id);
}

export async function setConversationTopic(id: string, topic: string): Promise<void> {
  await (await db()).run("UPDATE conversations SET topic = ? WHERE id = ?", [topic.slice(0, 40), id]);
}

/**
 * Marks the assistant as writing. Returns false if another reply is already
 * in progress, so two messages sent quickly don't produce two answers.
 */
export async function claimAiTurn(id: string): Promise<boolean> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - AI_BUSY_STALE_MS).toISOString();
  const changed = await (await db()).run(
    "UPDATE conversations SET ai_busy_since = ? WHERE id = ? AND (ai_busy_since IS NULL OR ai_busy_since < ?)",
    [now.toISOString(), id, staleBefore],
  );
  return changed > 0;
}

export async function releaseAiTurn(id: string): Promise<void> {
  await (await db()).run("UPDATE conversations SET ai_busy_since = NULL WHERE id = ?", [id]);
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

const COLLECTION_COLUMNS = "id, position, title_en, title_de, description_en, description_de";
const ARTICLE_COLUMNS = "id, collection_id, position, title_en, title_de, body_en, body_de, published, updated_at";

function toArticle(r: ArticleRow): HelpArticleRecord {
  return {
    id: r.id,
    collectionId: r.collection_id,
    position: Number(r.position),
    title: { en: r.title_en, de: r.title_de },
    body: { en: r.body_en, de: r.body_de },
    published: Number(r.published) === 1,
    updatedAt: r.updated_at,
  };
}

export async function listHelp(opts: { publishedOnly: boolean }): Promise<HelpCollectionRecord[]> {
  const d = await db();
  const cols = await d.all<CollectionRow>(`SELECT ${COLLECTION_COLUMNS} FROM help_collections ORDER BY position, ${seq(d)}`);
  const arts = await d.all<ArticleRow>(
    `SELECT ${ARTICLE_COLUMNS} FROM help_articles ${opts.publishedOnly ? "WHERE published = 1" : ""} ORDER BY position, ${seq(d)}`,
  );
  return cols.map((c) => ({
    id: c.id,
    position: Number(c.position),
    title: { en: c.title_en, de: c.title_de },
    description: { en: c.description_en, de: c.description_de },
    articles: arts.filter((a) => a.collection_id === c.id).map(toArticle),
  }));
}

export async function getArticle(id: string): Promise<HelpArticleRecord | null> {
  const row = await first<ArticleRow>(`SELECT ${ARTICLE_COLUMNS} FROM help_articles WHERE id = ?`, [id]);
  return row ? toArticle(row) : null;
}

/** Simple keyword search over published articles, best title matches first. */
export async function searchArticles(query: string, limit = 5): Promise<HelpArticleRecord[]> {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)
    .slice(0, 8);
  const all = (await (await db()).all<ArticleRow>(`SELECT ${ARTICLE_COLUMNS} FROM help_articles WHERE published = 1`)).map(toArticle);
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

export async function saveCollection(input: {
  id?: string;
  position?: number;
  title: Record<Loc, string>;
  description: Record<Loc, string>;
}): Promise<string> {
  const d = await db();
  const id = input.id || slug(input.title.en);
  // Editing keeps the collection where it is; a new one goes last.
  const existing = input.id ? await first<{ position: number }>("SELECT position FROM help_collections WHERE id = ?", [input.id]) : undefined;
  const position =
    input.position ??
    (existing
      ? Number(existing.position)
      : Number((await first<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM help_collections"))?.p ?? 0));
  await d.run(
    `INSERT INTO help_collections (id, position, title_en, title_de, description_en, description_de) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET position = excluded.position, title_en = excluded.title_en, title_de = excluded.title_de,
       description_en = excluded.description_en, description_de = excluded.description_de`,
    [id, position, input.title.en, input.title.de, input.description.en, input.description.de],
  );
  return id;
}

export async function deleteCollection(id: string): Promise<boolean> {
  return (await (await db()).run("DELETE FROM help_collections WHERE id = ?", [id])) > 0;
}

export async function saveArticle(input: {
  id?: string;
  collectionId: string;
  position?: number;
  title: Record<Loc, string>;
  body: Record<Loc, string>;
  published: boolean;
}): Promise<string> {
  const d = await db();
  const id = input.id || slug(input.title.en);
  // Editing keeps the article where it is; a new one, or one moved to another
  // collection, goes last.
  const existing = input.id
    ? await first<{ position: number; collection_id: string }>("SELECT position, collection_id FROM help_articles WHERE id = ?", [input.id])
    : undefined;
  const position =
    input.position ??
    (existing && existing.collection_id === input.collectionId
      ? Number(existing.position)
      : Number(
          (await first<{ p: number }>("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM help_articles WHERE collection_id = ?", [
            input.collectionId,
          ]))?.p ?? 0,
        ));
  await d.run(
    `INSERT INTO help_articles (id, collection_id, position, title_en, title_de, body_en, body_de, published, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET collection_id = excluded.collection_id, position = excluded.position,
       title_en = excluded.title_en, title_de = excluded.title_de, body_en = excluded.body_en, body_de = excluded.body_de,
       published = excluded.published, updated_at = excluded.updated_at`,
    [
      id, input.collectionId, position, input.title.en, input.title.de, input.body.en, input.body.de,
      input.published ? 1 : 0, new Date().toISOString(),
    ],
  );
  return id;
}

export async function deleteArticle(id: string): Promise<boolean> {
  return (await (await db()).run("DELETE FROM help_articles WHERE id = ?", [id])) > 0;
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

const UPDATE_COLUMNS = "id, published_at, title_en, title_de, body_en, body_de, image_url, published";

function toUpdate(r: UpdateRow): UpdateRecord {
  return {
    id: r.id,
    publishedAt: r.published_at,
    title: { en: r.title_en, de: r.title_de },
    body: { en: r.body_en, de: r.body_de },
    imageUrl: r.image_url,
    published: Number(r.published) === 1,
  };
}

export async function listUpdates(opts: { publishedOnly: boolean }): Promise<UpdateRecord[]> {
  const where = opts.publishedOnly ? "WHERE published = 1 AND published_at <= ?" : "";
  const params = opts.publishedOnly ? [new Date().toISOString()] : [];
  const rows = await (await db()).all<UpdateRow>(
    `SELECT ${UPDATE_COLUMNS} FROM updates ${where} ORDER BY published_at DESC LIMIT 100`,
    params,
  );
  return rows.map(toUpdate);
}

export async function saveUpdate(input: {
  id?: string;
  publishedAt: string;
  title: Record<Loc, string>;
  body: Record<Loc, string>;
  imageUrl: string | null;
  published: boolean;
}): Promise<string> {
  const id = input.id || slug(input.title.en);
  await (await db()).run(
    `INSERT INTO updates (id, published_at, title_en, title_de, body_en, body_de, image_url, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET published_at = excluded.published_at, title_en = excluded.title_en, title_de = excluded.title_de,
       body_en = excluded.body_en, body_de = excluded.body_de, image_url = excluded.image_url, published = excluded.published`,
    [id, input.publishedAt, input.title.en, input.title.de, input.body.en, input.body.de, input.imageUrl, input.published ? 1 : 0],
  );
  return id;
}

export async function deleteUpdate(id: string): Promise<boolean> {
  return (await (await db()).run("DELETE FROM updates WHERE id = ?", [id])) > 0;
}
