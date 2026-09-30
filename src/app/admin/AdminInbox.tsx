"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CloseIcon, ExternalLinkIcon, ImageIcon, SearchIcon, VerifiedIcon } from "@/components/icons";
import {
  CATEGORIES,
  findCategory,
  STATUS_LABELS,
  STATUSES,
  type FeedbackRecord,
  type Status,
} from "@/lib/feedback/config";
import { CATEGORY_ICONS } from "@/lib/feedback/icons";
import { AdminTopbar } from "./AdminTopbar";
import styles from "./admin.module.css";

type StatusFilter = Status | "all";
type ListData = { key: string; items: FeedbackRecord[]; counts: Record<string, number> };

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

function postTypeLabel(item: FeedbackRecord): string | null {
  const category = findCategory(item.category);
  return category?.postTypes.find((p) => p.id === item.postType)?.label.en ?? null;
}

function sender(item: FeedbackRecord): string {
  return item.userName || item.userEmail || "Guest";
}

export function AdminInbox() {
  const router = useRouter();

  const api = useCallback(
    async function api<T>(url: string, init?: RequestInit): Promise<T> {
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

  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ListData | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FeedbackRecord | null>(null);
  const [note, setNote] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const key = `${status}|${category}|${query}`;

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const ctrl = new AbortController();
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (category) params.set("category", category);
    if (query) params.set("q", query);
    api<Omit<ListData, "key">>(`/api/admin/feedback?${params}`, { signal: ctrl.signal })
      .then((json) => {
        setData({ key: `${status}|${category}|${query}`, ...json });
        setListError(null);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setListError(err.message);
      });
    return () => ctrl.abort();
  }, [api, status, category, query]);

  useEffect(() => {
    if (!selectedId) return;
    const ctrl = new AbortController();
    api<{ item: FeedbackRecord }>(`/api/admin/feedback/${selectedId}`, { signal: ctrl.signal })
      .then(({ item }) => {
        setDetail(item);
        setNote(item.internalNote);
        setConfirmDelete(false);
        setActionError(null);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setActionError(err.message);
      });
    return () => ctrl.abort();
  }, [api, selectedId]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const loading = data?.key !== key;
  const open = detail && detail.id === selectedId ? detail : null;

  function replaceItem(updated: FeedbackRecord) {
    setData((d) => d && { ...d, items: d.items.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)) });
    setDetail((cur) => (cur && cur.id === updated.id ? { ...cur, ...updated } : cur));
  }

  async function changeStatus(id: string, next: Status) {
    setActionError(null);
    try {
      const { item } = await api<{ item: FeedbackRecord }>(`/api/admin/feedback/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const previous = items.find((i) => i.id === id)?.status;
      replaceItem(item);
      if (previous && previous !== next) {
        setData(
          (d) =>
            d && {
              ...d,
              counts: { ...d.counts, [previous]: (d.counts[previous] ?? 1) - 1, [next]: (d.counts[next] ?? 0) + 1 },
            },
        );
      }
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function saveNote() {
    if (!open || note === open.internalNote) return;
    try {
      const { item } = await api<{ item: FeedbackRecord }>(`/api/admin/feedback/${open.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ internalNote: note }),
      });
      replaceItem(item);
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/admin/feedback/${id}`, { method: "DELETE" });
      const gone = items.find((i) => i.id === id);
      setData(
        (d) =>
          d && {
            ...d,
            items: d.items.filter((i) => i.id !== id),
            counts: gone ? { ...d.counts, [gone.status]: (d.counts[gone.status] ?? 1) - 1 } : d.counts,
          },
      );
      setSelectedId(null);
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  return (
    <div className={styles.shell}>
      <AdminTopbar />

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Filter by status">
          {(["all", ...STATUSES] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              className={styles.tab}
              onClick={() => setStatus(s)}
            >
              {s === "all" ? "All" : STATUS_LABELS[s]}
              <span className={styles.count}>{s === "all" ? total : (counts[s] ?? 0)}</span>
            </button>
          ))}
        </div>
        <div className={styles.filters}>
          <select
            id="filter-category"
            aria-label="Filter by category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={styles.select}
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label.en}
              </option>
            ))}
          </select>
          <label className={styles.search}>
            <SearchIcon size={15} aria-hidden />
            <input
              id="filter-search"
              type="search"
              placeholder="Search title, text or sender"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className={styles.body}>
        <section className={styles.list} aria-label="Feedback" aria-busy={loading}>
          {listError && <p className={styles.errorText}>{listError}</p>}
          {!listError && data && items.length === 0 && (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>{total === 0 ? "No feedback yet" : "Nothing matches these filters"}</p>
              <p>
                {total === 0
                  ? "Submissions from the widget land here. Send one from the demo page to see how it looks."
                  : "Try another status, category or search term."}
              </p>
            </div>
          )}
          {items.map((item) => {
            const cat = findCategory(item.category);
            const Icon = cat ? CATEGORY_ICONS[cat.icon] : CATEGORY_ICONS.other;
            const type = postTypeLabel(item);
            return (
              <button
                key={item.id}
                type="button"
                className={styles.row}
                aria-current={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
              >
                <span className={styles.rowIcon}>
                  <Icon size={16} aria-hidden />
                </span>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{item.title}</span>
                  {item.description && <span className={styles.rowSnippet}>{item.description}</span>}
                  <span className={styles.rowMeta}>
                    {cat?.label.en ?? item.category}
                    {type && ` · ${type}`} · {sender(item)} · {timeAgo(item.createdAt)}
                    {item.hasScreenshot && <ImageIcon size={13} aria-label="Has screenshot" />}
                  </span>
                </span>
                <span className={styles.pill} data-status={item.status}>
                  {STATUS_LABELS[item.status]}
                </span>
              </button>
            );
          })}
        </section>

        {selectedId && (
          <aside className={styles.detail} aria-label="Feedback details">
            <button type="button" className={styles.closeDetail} aria-label="Close details" onClick={() => setSelectedId(null)}>
              <CloseIcon size={16} aria-hidden />
            </button>
            {!open ? (
              <p className={styles.muted}>{actionError ?? "Loading…"}</p>
            ) : (
              <>
                <p className={styles.detailEyebrow}>
                  {findCategory(open.category)?.label.en ?? open.category}
                  {postTypeLabel(open) && ` · ${postTypeLabel(open)}`}
                </p>
                <h2 className={styles.detailTitle}>{open.title}</h2>

                <label className={styles.statusField}>
                  <span>Status</span>
                  <select
                    id="detail-status"
                    value={open.status}
                    onChange={(e) => changeStatus(open.id, e.target.value as Status)}
                    className={styles.select}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>

                {open.description ? (
                  <p className={styles.description}>{open.description}</p>
                ) : (
                  <p className={styles.muted}>No description.</p>
                )}

                {open.screenshot && (
                  <button type="button" className={styles.shot} onClick={() => setZoomed(true)} aria-label="View screenshot full size">
                    {/* eslint-disable-next-line @next/next/no-img-element -- stored data URL */}
                    <img src={open.screenshot} alt={`Screenshot attached to “${open.title}”`} />
                  </button>
                )}

                <dl className={styles.meta}>
                  <dt>From</dt>
                  <dd>
                    {sender(open)}
                    {open.userEmail && open.userName && <span className={styles.muted}> · {open.userEmail}</span>}
                    {open.userVerified && (
                      <span className={styles.verified} title="Identity verified by the Twist server">
                        <VerifiedIcon size={14} aria-hidden /> Verified
                      </span>
                    )}
                  </dd>
                  <dt>Submitted</dt>
                  <dd>{new Date(open.createdAt).toLocaleString()}</dd>
                  <dt>Source</dt>
                  <dd>{open.source}</dd>
                  <dt>Language</dt>
                  <dd>{open.locale ?? "—"}</dd>
                  {open.pageUrl && (
                    <>
                      <dt>Page</dt>
                      <dd>
                        <a href={open.pageUrl} target="_blank" rel="noreferrer" className={styles.link}>
                          {open.pageUrl.replace(/^https?:\/\//, "")} <ExternalLinkIcon size={12} aria-hidden />
                        </a>
                      </dd>
                    </>
                  )}
                  {Object.entries(open.metadata).map(([k, v]) => (
                    <FragmentRow key={k} label={k} value={v} />
                  ))}
                </dl>

                <label className={styles.noteField}>
                  <span>Internal note</span>
                  <textarea
                    id="detail-note"
                    rows={3}
                    placeholder="Only the team sees this. Saved when you click away."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={saveNote}
                  />
                </label>

                {actionError && <p className={styles.errorText}>{actionError}</p>}

                <div className={styles.dangerZone}>
                  {confirmDelete ? (
                    <>
                      <span>Delete this feedback for good?</span>
                      <button type="button" className={styles.dangerButton} onClick={() => remove(open.id)}>
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
              </>
            )}
          </aside>
        )}
      </div>

      {zoomed && open?.screenshot && (
        <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label="Screenshot" onClick={() => setZoomed(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- stored data URL */}
          <img src={open.screenshot} alt={`Screenshot attached to “${open.title}”`} />
        </div>
      )}
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={styles.wrap}>{value}</dd>
    </>
  );
}
