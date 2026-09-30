"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { CheckIcon, ChevronLeftIcon, CloseIcon, MailIcon, ScreenshotIcon, SendIcon } from "@/components/icons";
import { CATEGORIES, findCategory, LIMITS, type Category, type FeedbackSubmission, type Locale } from "@/lib/feedback/config";
import { CATEGORY_ICONS as ICONS } from "@/lib/feedback/icons";
import { STRINGS } from "./strings";
import styles from "./FeedbackWidget.module.css";

const OPEN_EVENT = "twist-feedback:open";

/** Open the widget from anywhere, optionally straight into a category ("bug", "idea", …). */
export function openFeedbackWidget(category?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { category } }));
}

export type FeedbackWidgetProps = {
  /** Where the feedback service runs. Leave empty when it's the same app. */
  apiUrl?: string;
  /** Which surface the feedback came from, e.g. "parent-dashboard" or "website". */
  source: string;
  theme?: "light" | "dark";
  locale?: Locale;
  /** Shows a floating "Feedback" tab on that side of the screen. `null` hides it. */
  placement?: "right" | "left" | null;
  /** The signed-in parent. `hash` comes from your server (see README). */
  user?: { id: string; name?: string; email?: string; hash?: string } | null;
  /** Extra context attached to every post, such as the app version. */
  metadata?: Record<string, string>;
  accentColor?: string;
  onSubmitted?: (id: string) => void;
};

type View = "main" | "form" | "done";
type Draft = { title: string; description: string; postType: string | null; email: string };
const EMPTY_DRAFT: Draft = { title: "", description: "", postType: null, email: "" };

const FOCUSABLE = 'button:not([disabled]), input:not([tabindex="-1"]), textarea, [href], [tabindex="0"]';

export function FeedbackWidget({
  apiUrl = "",
  source,
  theme = "light",
  locale = "en",
  placement = "right",
  user = null,
  metadata,
  accentColor,
  onSubmitted,
}: FeedbackWidgetProps) {
  const t = STRINGS[locale];
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [category, setCategory] = useState<Category | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const headingId = useId();

  const pick = useCallback(
    (next: Category) => {
      if (category?.id !== next.id) setDraft((d) => ({ ...d, postType: null }));
      setCategory(next);
      setView("form");
      setError(null);
    },
    [category],
  );

  const show = useCallback(
    (categoryId?: string) => {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      const requested = categoryId ? findCategory(categoryId) : undefined;
      if (requested) pick(requested);
      else setView((v) => (v === "done" ? "main" : v));
      setOpen(true);
    },
    [pick],
  );

  const close = useCallback(() => {
    setOpen(false);
    returnFocusRef.current?.focus?.();
  }, []);

  // Open from openFeedbackWidget() or any element with data-twist-feedback.
  useEffect(() => {
    const onOpen = (e: Event) => show((e as CustomEvent<{ category?: string }>).detail?.category);
    const onClick = (e: MouseEvent) => {
      const trigger = (e.target as Element | null)?.closest?.("[data-twist-feedback]");
      if (!trigger || trigger.closest("[data-twist-feedback-root]")) return;
      e.preventDefault();
      show(trigger.getAttribute("data-twist-feedback") || undefined);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      document.removeEventListener("click", onClick);
    };
  }, [show]);

  // Escape closes, Tab stays inside the dialog, 1–9 pick a category.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      } else if (view === "main" && /^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const next = CATEGORIES[Number(e.key) - 1];
        if (next) {
          e.preventDefault();
          pick(next);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, view, close, pick]);

  // Move focus into each view as it appears.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel)?.focus();
  }, [open, view]);

  async function captureScreen() {
    setCapturing(true);
    setError(null);
    try {
      const { domToJpeg } = await import("modern-screenshot");
      const shot = await domToJpeg(document.documentElement, {
        width: window.innerWidth,
        height: window.innerHeight,
        scale: Math.min(1, 1440 / window.innerWidth),
        quality: 0.75,
        style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
        // Leave the widget itself out of the picture.
        filter: (node) => !(node instanceof Element && node.hasAttribute("data-twist-feedback-root")),
      });
      if (shot.length > LIMITS.screenshotMaxChars) throw new Error("Screenshot too large");
      setScreenshot(shot);
    } catch (err) {
      console.warn("[twist-feedback] screenshot failed", err);
      setError(t.screenshotFailed);
    } finally {
      setCapturing(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!category || sending) return;
    if (draft.title.trim().length < LIMITS.titleMin) {
      setError(t.titleRequired);
      titleInputRef.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    const payload: FeedbackSubmission = {
      category: category.id,
      postType: draft.postType,
      title: draft.title,
      description: draft.description,
      email: user?.email ? null : draft.email || null,
      locale,
      source,
      pageUrl: window.location.href,
      metadata: { ...metadata, viewport: `${window.innerWidth}x${window.innerHeight}` },
      screenshot,
      user,
      website: honeypot,
    };
    try {
      const res = await fetch(`${apiUrl}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDraft(EMPTY_DRAFT);
      setScreenshot(null);
      setCategory(null);
      setView("done");
      if (json.id) onSubmitted?.(json.id);
    } catch (err) {
      console.warn("[twist-feedback] submit failed", err);
      setError(t.sendFailed);
    } finally {
      setSending(false);
    }
  }

  const rootStyle = accentColor ? ({ "--tf-accent": accentColor } as CSSProperties) : undefined;
  const CategoryIconEl = category ? ICONS[category.icon] : null;

  return (
    <div data-twist-feedback-root="" className={`${styles.root} ${theme === "dark" ? styles.dark : ""}`} style={rootStyle}>
      {placement && !open && (
        <button
          type="button"
          className={`${styles.launcher} ${placement === "left" ? styles.launcherLeft : styles.launcherRight}`}
          onClick={() => show()}
        >
          {t.launcher}
        </button>
      )}

      {open && (
        <div
          className={styles.overlay}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            tabIndex={-1}
            className={styles.panel}
          >
            <button type="button" className={styles.close} aria-label={t.close} onClick={close}>
              <CloseIcon size={16} aria-hidden />
            </button>

            {view === "main" && (
              <>
                <div className={styles.header}>
                  <p id={headingId} className={styles.title}>
                    {t.title}
                  </p>
                  <p className={styles.subtitle}>{t.subtitle}</p>
                </div>
                <ul className={styles.list}>
                  {CATEGORIES.map((c, i) => {
                    const Icon = ICONS[c.icon];
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className={styles.option}
                          onClick={() => pick(c)}
                          data-autofocus={i === 0 ? "" : undefined}
                        >
                          <span className={styles.iconTile}>
                            <Icon size={16} aria-hidden />
                          </span>
                          <span className={styles.optionLabel}>{c.label[locale]}</span>
                          <kbd className={styles.shortcut}>{i + 1}</kbd>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {view === "form" && category && CategoryIconEl && (
              <form onSubmit={submit} noValidate>
                <div className={styles.formHeader}>
                  <span className={styles.iconTile}>
                    <CategoryIconEl size={16} aria-hidden />
                  </span>
                  <p id={headingId} className={styles.title}>
                    {category.label[locale]}
                  </p>
                </div>

                <div className={styles.fields}>
                  <input
                    ref={titleInputRef}
                    data-autofocus=""
                    className={styles.input}
                    placeholder={t.titlePlaceholder}
                    aria-label={t.titlePlaceholder}
                    value={draft.title}
                    maxLength={LIMITS.titleMax}
                    onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  />
                  <textarea
                    className={`${styles.input} ${styles.textarea}`}
                    placeholder={category.prompt[locale]}
                    aria-label={category.prompt[locale]}
                    value={draft.description}
                    maxLength={LIMITS.descriptionMax}
                    rows={5}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  />

                  {category.postTypes.length > 0 && (
                    <div className={styles.box} role="group" aria-labelledby={`${headingId}-types`}>
                      <p id={`${headingId}-types`} className={styles.boxLabel}>
                        {category.postTypeLabel[locale]}
                      </p>
                      <div className={styles.chips}>
                        {category.postTypes.map((p) => {
                          const selected = draft.postType === p.id;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              aria-pressed={selected}
                              className={styles.chip}
                              onClick={() => setDraft((d) => ({ ...d, postType: selected ? null : p.id }))}
                            >
                              <span aria-hidden>{p.emoji}</span> {p.label[locale]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {!user?.email && (
                    <label className={styles.emailField}>
                      <MailIcon size={16} className={styles.emailIcon} aria-hidden />
                      <input
                        type="email"
                        autoComplete="email"
                        className={`${styles.input} ${styles.emailInput}`}
                        placeholder={t.emailPlaceholder}
                        value={draft.email}
                        onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                      />
                    </label>
                  )}

                  {screenshot && (
                    <div className={styles.attachment}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                      <img src={screenshot} alt="" className={styles.thumb} />
                      <span className={styles.attachmentLabel}>{t.screenshotAdded}</span>
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t.removeScreenshot}
                        onClick={() => setScreenshot(null)}
                      >
                        <CloseIcon size={14} aria-hidden />
                      </button>
                    </div>
                  )}

                  {error && (
                    <p role="alert" className={styles.error}>
                      {error}
                    </p>
                  )}

                  <input
                    className={styles.honeypot}
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden
                    name="website"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>

                <div className={styles.footer}>
                  <button type="button" className={styles.iconButton} aria-label={t.back} onClick={() => setView("main")}>
                    <ChevronLeftIcon size={18} aria-hidden />
                  </button>
                  <div className={styles.footerActions}>
                    <button type="button" className={styles.secondary} onClick={captureScreen} disabled={capturing}>
                      <ScreenshotIcon size={15} aria-hidden />
                      {capturing ? t.capturing : screenshot ? t.retakeScreenshot : t.takeScreenshot}
                    </button>
                    <button type="submit" className={styles.primary} disabled={sending}>
                      <SendIcon size={15} aria-hidden />
                      {sending ? t.sending : t.send}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {view === "done" && (
              <div className={styles.done}>
                <span className={styles.doneIcon}>
                  <CheckIcon size={22} strokeWidth={2.5} aria-hidden />
                </span>
                <p id={headingId} className={styles.title}>
                  {t.thanksTitle}
                </p>
                <p className={styles.doneBody}>{t.thanksBody}</p>
                <div className={styles.doneActions}>
                  <button type="button" className={styles.secondary} onClick={() => setView("main")}>
                    {t.sendMore}
                  </button>
                  <button type="button" data-autofocus="" className={styles.primary} onClick={close}>
                    {t.done}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
