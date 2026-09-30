// Shared by the widget (browser) and the API (server). Keep it free of
// browser- or Node-only imports.

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

export const STATUSES = ["new", "planned", "in_progress", "done", "wont_do"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  new: "New",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  wont_do: "Won't do",
};

export type CategoryIcon = "bug" | "idea" | "content" | "usability" | "other";

type Localized = Record<Locale, string>;

export type Category = {
  id: string;
  icon: CategoryIcon;
  label: Localized;
  /** Placeholder for the description box, tailored to the category. */
  prompt: Localized;
  /** Heading above the post-type chips. */
  postTypeLabel: Localized;
  postTypes: { id: string; emoji: string; label: Localized }[];
};

export const CATEGORIES: Category[] = [
  {
    id: "bug",
    icon: "bug",
    label: { en: "Bug", de: "Fehler" },
    prompt: {
      en: "What happened, and what did you expect instead? Steps to reproduce help us fix it faster.",
      de: "Was ist passiert, und was hast du stattdessen erwartet? Schritte zum Nachstellen helfen uns, es schneller zu beheben.",
    },
    postTypeLabel: { en: "How serious is it?", de: "Wie schwerwiegend ist es?" },
    postTypes: [
      { id: "blocker", emoji: "🛑", label: { en: "Blocks us completely", de: "Blockiert uns komplett" } },
      { id: "major", emoji: "⚠️", label: { en: "Major, with a workaround", de: "Schwer, mit Umweg" } },
      { id: "minor", emoji: "🪶", label: { en: "Minor or cosmetic", de: "Klein oder optisch" } },
    ],
  },
  {
    id: "idea",
    icon: "idea",
    label: { en: "Feature request", de: "Funktionswunsch" },
    prompt: {
      en: "What would you like Twist to do? Tell us what problem it would solve for you or your child.",
      de: "Was soll Twist können? Erzähl uns, welches Problem es für dich oder dein Kind lösen würde.",
    },
    postTypeLabel: { en: "Post type", de: "Art" },
    postTypes: [
      { id: "new_feature", emoji: "💡", label: { en: "New feature", de: "Neue Funktion" } },
      { id: "improvement", emoji: "✨", label: { en: "Improvement", de: "Verbesserung" } },
    ],
  },
  {
    id: "content",
    icon: "content",
    label: { en: "Lessons & content", de: "Lektionen & Inhalte" },
    prompt: {
      en: "Which lesson or grade is it about, and what felt off?",
      de: "Um welche Lektion oder Klassenstufe geht es, und was hat nicht gepasst?",
    },
    postTypeLabel: { en: "What's the issue?", de: "Worum geht es?" },
    postTypes: [
      { id: "too_easy", emoji: "🐣", label: { en: "Too easy", de: "Zu leicht" } },
      { id: "too_hard", emoji: "🧗", label: { en: "Too hard", de: "Zu schwer" } },
      { id: "mistake", emoji: "✏️", label: { en: "Mistake in content", de: "Fehler im Inhalt" } },
      { id: "translation", emoji: "🌍", label: { en: "Translation", de: "Übersetzung" } },
    ],
  },
  {
    id: "usability",
    icon: "usability",
    label: { en: "Hard to use", de: "Schwer zu bedienen" },
    prompt: {
      en: "What were you trying to do, and where did you get stuck?",
      de: "Was wolltest du tun, und wo bist du nicht weitergekommen?",
    },
    postTypeLabel: { en: "What's the problem?", de: "Was ist das Problem?" },
    postTypes: [
      { id: "confusing", emoji: "🤔", label: { en: "Confusing", de: "Verwirrend" } },
      { id: "slow", emoji: "🐢", label: { en: "Slow", de: "Langsam" } },
      { id: "hard_to_find", emoji: "🔍", label: { en: "Hard to find", de: "Schwer zu finden" } },
    ],
  },
  {
    id: "other",
    icon: "other",
    label: { en: "Other", de: "Sonstiges" },
    prompt: {
      en: "Praise, questions, anything else on your mind.",
      de: "Lob, Fragen oder alles andere, was dir einfällt.",
    },
    postTypeLabel: { en: "Post type", de: "Art" },
    postTypes: [
      { id: "praise", emoji: "🎉", label: { en: "Praise", de: "Lob" } },
      { id: "question", emoji: "❓", label: { en: "Question", de: "Frage" } },
      { id: "other", emoji: "💬", label: { en: "Other", de: "Sonstiges" } },
    ],
  },
];

export function findCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export const LIMITS = {
  titleMin: 3,
  titleMax: 200,
  descriptionMax: 5000,
  /** Size of the base64 data URL, not the decoded image. */
  screenshotMaxChars: 3_000_000,
  metadataKeys: 20,
  metadataValueMax: 300,
};

/** What the widget sends to POST /api/feedback. */
export type FeedbackSubmission = {
  category: string;
  postType?: string | null;
  title: string;
  description?: string;
  email?: string | null;
  locale?: Locale;
  source: string;
  pageUrl?: string;
  metadata?: Record<string, string>;
  screenshot?: string | null;
  user?: { id: string; name?: string; email?: string; hash?: string } | null;
  /** Honeypot: real users never fill this in. */
  website?: string;
};

export type FeedbackRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  category: string;
  postType: string | null;
  title: string;
  description: string;
  status: Status;
  source: string;
  locale: string | null;
  pageUrl: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userVerified: boolean;
  metadata: Record<string, string>;
  hasScreenshot: boolean;
  screenshot?: string | null;
  internalNote: string;
};
