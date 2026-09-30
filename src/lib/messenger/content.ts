import type { Locale } from "@/lib/feedback/config";

// Messenger text, plus the starter help centre and updates. The help centre and
// updates live in the database and are edited in /admin; the collections and
// updates below are only loaded into an empty database the first time it runs.

type Localized = Record<Locale, string>;

export type HelpArticle = { id: string; title: Localized; body: Localized };
export type HelpCollection = { id: string; title: Localized; description: Localized; articles: HelpArticle[] };
export type Update = { id: string; date: string; title: Localized; body: Localized; imageUrl?: string };

export const HELP_COLLECTIONS: HelpCollection[] = [
  {
    id: "getting-started",
    title: { en: "Getting started", de: "Erste Schritte" },
    description: {
      en: "The basics of Twist for parents and testers.",
      de: "Die Grundlagen von Twist für Eltern und Testende.",
    },
    articles: [
      {
        id: "what-is-twist",
        title: { en: "What is Twist?", de: "Was ist Twist?" },
        body: {
          en: "Twist is a learning app for children in grades 1 to 4. Your child learns in the app, and you follow their progress in the parent dashboard.",
          de: "Twist ist eine Lern-App für Kinder der Klassen 1 bis 4. Dein Kind lernt in der App, und du verfolgst den Fortschritt im Eltern-Dashboard.",
        },
      },
      {
        id: "testing-twist",
        title: { en: "Testing Twist with your child", de: "Twist mit deinem Kind testen" },
        body: {
          en: "Thanks for helping us test. Let your child use Twist as they normally would, then tell us what happened through Leave us feedback. Short, honest notes are the most useful.",
          de: "Danke, dass du uns beim Testen hilfst. Lass dein Kind Twist ganz normal nutzen und erzähl uns dann über „Feedback geben“, was passiert ist. Kurze, ehrliche Notizen helfen am meisten.",
        },
      },
    ],
  },
  {
    id: "feedback",
    title: { en: "Feedback & bugs", de: "Feedback & Fehler" },
    description: {
      en: "How to report a problem or suggest an idea.",
      de: "So meldest du ein Problem oder schlägst eine Idee vor.",
    },
    articles: [
      {
        id: "report-a-bug",
        title: { en: "How to report a bug", de: "So meldest du einen Fehler" },
        body: {
          en: "Open the messenger, choose Submit ticket, and describe what happened and what you expected. Tap Take screenshot to attach a picture of the screen. It helps us find the problem faster.",
          de: "Öffne den Messenger, wähle „Ticket senden“ und beschreibe, was passiert ist und was du erwartet hast. Mit „Screenshot aufnehmen“ hängst du ein Bild des Bildschirms an. So finden wir das Problem schneller.",
        },
      },
      {
        id: "what-happens-next",
        title: { en: "What happens after I send feedback?", de: "Was passiert nach dem Senden?" },
        body: {
          en: "The Twist team reads every message and marks it as planned, in progress or done. If you left your email address or sent a message, we can reply to you directly.",
          de: "Das Twist-Team liest jede Nachricht und markiert sie als geplant, in Arbeit oder erledigt. Wenn du deine E-Mail-Adresse angegeben oder eine Nachricht geschickt hast, können wir dir direkt antworten.",
        },
      },
    ],
  },
  {
    id: "privacy",
    title: { en: "Account & privacy", de: "Konto & Datenschutz" },
    description: {
      en: "What we collect and how to reach us.",
      de: "Was wir erfassen und wie du uns erreichst.",
    },
    articles: [
      {
        id: "what-we-collect",
        title: { en: "What does feedback include?", de: "Was enthält mein Feedback?" },
        body: {
          en: "Feedback includes what you write, the page you were on, your device type and, if you choose, a screenshot. We never ask for your child's name.",
          de: "Feedback enthält, was du schreibst, die Seite, auf der du warst, deinen Gerätetyp und, wenn du möchtest, einen Screenshot. Wir fragen nie nach dem Namen deines Kindes.",
        },
      },
    ],
  },
];

export const UPDATES: Update[] = [
  {
    id: "messenger",
    date: "2026-09-29",
    title: { en: "Help and feedback, right inside Twist", de: "Hilfe und Feedback direkt in Twist" },
    body: {
      en: "You can now message the Twist team, report bugs with a screenshot and find help articles without leaving the dashboard.",
      de: "Du kannst dem Twist-Team jetzt Nachrichten schreiben, Fehler mit Screenshot melden und Hilfeartikel finden, ohne das Dashboard zu verlassen.",
    },
  },
];

export const QUICK_REPLIES: Localized[] = [
  { en: "I found a problem", de: "Ich habe ein Problem gefunden" },
  { en: "A question about lessons", de: "Eine Frage zu den Lektionen" },
  { en: "Something else", de: "Etwas anderes" },
];

export const MESSENGER_STRINGS = {
  en: {
    open: "Open messenger",
    close: "Close messenger",
    greeting: "Hey there! 👋",
    greetingNamed: "Hi {name}! 👋",
    howCanWeHelp: "How can we help?",
    sendMessage: "Send us a message",
    submitTicket: "Submit ticket",
    bugReport: "Bug Report",
    leaveFeedback: "Leave us feedback",
    searchHelp: "Search for help",
    searchPlaceholder: "Search for help…",
    latestUpdates: "Latest updates",
    home: "Home",
    messages: "Messages",
    help: "Help",
    updates: "Updates",
    noMessages: "No messages yet",
    teamName: "Twist team",
    replyTime: "We usually reply within a day",
    welcome1: "Hi there, welcome to Twist 👋",
    welcome2: "What would you like help with?",
    writeMessage: "Write a message…",
    send: "Send",
    back: "Back",
    you: "You",
    articles: "{n} articles",
    article: "1 article",
    noResults: "No articles match that search.",
    sendFailed: "Your message didn't send. Check your connection and try again.",
    loadFailed: "Couldn't load your messages. Try again in a moment.",
    justNow: "Just now",
    assistantName: "Twist Assistant",
    assistantSub: "AI · The team can also help",
    aiBadge: "AI",
    talkToPerson: "Talk to a person",
    handedOff: "I've passed this to the team. A person will reply here, usually within a day.",
    sourcesLabel: "From the help centre",
    feedbackLogged: "Sent to the team",
    writing: "Writing…",
    noUpdates: "No updates yet",
    noHelp: "No help articles yet.",
    loading: "Loading…",
  },
  de: {
    open: "Messenger öffnen",
    close: "Messenger schließen",
    greeting: "Hallo! 👋",
    greetingNamed: "Hallo {name}! 👋",
    howCanWeHelp: "Wie können wir helfen?",
    sendMessage: "Schreib uns eine Nachricht",
    submitTicket: "Ticket senden",
    bugReport: "Fehlerbericht",
    leaveFeedback: "Feedback geben",
    searchHelp: "Hilfe durchsuchen",
    searchPlaceholder: "Hilfe durchsuchen…",
    latestUpdates: "Neuigkeiten",
    home: "Start",
    messages: "Nachrichten",
    help: "Hilfe",
    updates: "Neuigkeiten",
    noMessages: "Noch keine Nachrichten",
    teamName: "Twist-Team",
    replyTime: "Wir antworten meist innerhalb eines Tages",
    welcome1: "Hallo, willkommen bei Twist 👋",
    welcome2: "Wobei können wir dir helfen?",
    writeMessage: "Nachricht schreiben…",
    send: "Senden",
    back: "Zurück",
    you: "Du",
    articles: "{n} Artikel",
    article: "1 Artikel",
    noResults: "Keine Artikel passen zu dieser Suche.",
    sendFailed: "Deine Nachricht wurde nicht gesendet. Prüfe deine Verbindung und versuche es erneut.",
    loadFailed: "Deine Nachrichten konnten nicht geladen werden. Versuche es gleich noch einmal.",
    justNow: "Gerade eben",
    assistantName: "Twist-Assistent",
    assistantSub: "KI · Das Team hilft auch",
    aiBadge: "KI",
    talkToPerson: "Mit einem Menschen sprechen",
    handedOff: "Ich habe das an das Team weitergegeben. Ein Mensch antwortet hier, meist innerhalb eines Tages.",
    sourcesLabel: "Aus der Hilfe",
    feedbackLogged: "An das Team geschickt",
    writing: "Schreibt…",
    noUpdates: "Noch keine Neuigkeiten",
    noHelp: "Noch keine Hilfeartikel.",
    loading: "Wird geladen…",
  },
} satisfies Record<Locale, Record<string, string>>;

export type MessengerStrings = (typeof MESSENGER_STRINGS)["en"];

/** Extra detail attached to a message, mostly by the assistant. */
export type MessageMeta = {
  /** Help articles the answer is based on. */
  sources?: { id: string; title: string }[];
  /** Feedback the assistant logged on the parent's behalf. */
  feedback?: { id: string; title: string; category: string };
  /** This message handed the conversation to the team. */
  handoff?: boolean;
};

export type Author = "visitor" | "team" | "ai";

export type ConversationSummary = {
  id: string;
  createdAt: string;
  lastMessageAt: string;
  lastMessage: string;
  lastAuthor: Author;
  status: "open" | "closed";
  /** "ai": the assistant answers; "human": handed to the team. */
  mode: "ai" | "human";
  aiBusy: boolean;
};

export type ChatMessage = {
  id: string;
  createdAt: string;
  author: Author;
  authorName: string | null;
  body: string;
  meta: MessageMeta;
};

/** What GET /api/messenger/content returns, already in the visitor's language. */
export type MessengerContent = {
  collections: {
    id: string;
    title: string;
    description: string;
    articles: { id: string; title: string; body: string; updatedAt: string }[];
  }[];
  updates: { id: string; publishedAt: string; title: string; body: string; imageUrl: string | null }[];
  ai: { enabled: boolean };
};

/** Events streamed back while a message is sent (one JSON object per line). */
export type SendEvent =
  | { type: "conversation"; conversation: ConversationSummary }
  | { type: "message"; message: ChatMessage }
  | { type: "ai_start" }
  | { type: "ai_delta"; text: string }
  | { type: "ai_message"; message: ChatMessage }
  | { type: "mode"; mode: "ai" | "human" }
  | { type: "error"; error: string };

export const MESSAGE_MAX = 4000;
