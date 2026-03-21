"use client";

import gsap from "gsap";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EffectsErrorBoundary } from "@/components/app/EffectsErrorBoundary";
import { InteractiveButton } from "@/components/effects/InteractiveButton";
import { OglLiquidRibbon } from "@/components/effects/OglLiquidRibbon";
import { RapierFloatField } from "@/components/effects/RapierFloatField";
import { downloadFile } from "@/lib/download";
import type { LibraryItem } from "@/types/app";

type FilterKind = "all" | "video" | "image";

const ITEMS_PER_PAGE = 10;

/**
 * Memoized video player that NEVER re-renders when the parent list updates.
 * This prevents video playback from being interrupted by background refreshes.
 */
const StableVideo = memo(function StableVideo({
  src,
  onPlay,
}: {
  src: string;
  onPlay: (el: HTMLVideoElement) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  return (
    <video
      ref={ref}
      src={src}
      controls
      playsInline
      preload="none"
      className="h-56 w-full object-cover"
      onPlay={() => {
        if (ref.current) onPlay(ref.current);
      }}
    />
  );
},
// Only re-render if the src actually changes (same item, same URL = skip)
(prev, next) => prev.src === next.src,
);

export function LibraryView() {
  const router = useRouter();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const isVideoPlayingRef = useRef(false);

  // Smart merge: only update items that actually changed, preserving references
  // for items that haven't changed (so React skips re-rendering their children).
  const mergeItems = useCallback((incoming: LibraryItem[]) => {
    setItems((current) => {
      if (!current.length) return incoming;

      const currentMap = new Map(current.map((item) => [item.id, item]));
      const incomingIds = new Set(incoming.map((item) => item.id));

      // Check if anything actually changed
      if (
        current.length === incoming.length &&
        incoming.every((item) => currentMap.has(item.id))
      ) {
        // Same set of items — update only metadata that changed, preserve playUrl
        // references to avoid re-mounting video elements
        let anyChanged = false;
        const merged = current.map((existing) => {
          const fresh = incoming.find((i) => i.id === existing.id);
          if (!fresh) return existing;
          // Keep the existing object reference if nothing meaningful changed
          if (
            existing.prompt === fresh.prompt &&
            existing.model === fresh.model &&
            existing.kind === fresh.kind
          ) {
            return existing;
          }
          anyChanged = true;
          return { ...fresh, playUrl: existing.playUrl, downloadUrl: existing.downloadUrl };
        });
        return anyChanged ? merged : current;
      }

      // Items added or removed — rebuild but preserve existing references where possible
      return incoming.map((item) => currentMap.get(item.id) || item);
    });
  }, []);

  const fetchLibrary = useCallback(async () => {
    try {
      const response = await fetch("/api/library", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Failed to load library");
      mergeItems(data.items || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, [mergeItems]);

  // Initial load
  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  // Auto-refresh: poll for new items, but SKIP if a video is playing
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!isVideoPlayingRef.current) {
        void fetchLibrary();
      }
    }, 12000);

    return () => window.clearInterval(interval);
  }, [fetchLibrary]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.kind === filter);
  }, [items, filter]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const clampedPage = Math.min(page, totalPages);
  const paginatedItems = useMemo(
    () => filteredItems.slice((clampedPage - 1) * ITEMS_PER_PAGE, clampedPage * ITEMS_PER_PAGE),
    [filteredItems, clampedPage],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleVideoPlay = useCallback((el: HTMLVideoElement) => {
    if (activeVideoRef.current && activeVideoRef.current !== el) {
      activeVideoRef.current.pause();
    }
    activeVideoRef.current = el;
    isVideoPlayingRef.current = true;

    // Track when video stops playing so auto-refresh can resume
    const onPause = () => {
      isVideoPlayingRef.current = false;
    };
    const onEnded = () => {
      isVideoPlayingRef.current = false;
    };
    el.addEventListener("pause", onPause, { once: true });
    el.addEventListener("ended", onEnded, { once: true });
  }, []);

  useEffect(() => {
    if (activeVideoRef.current) {
      activeVideoRef.current.pause();
      activeVideoRef.current = null;
      isVideoPlayingRef.current = false;
    }
  }, [clampedPage]);

  const shareItem = async (item: LibraryItem) => {
    setNotice("");
    try {
      if (navigator.share) {
        await navigator.share({
          title: "RunPod Media Studio",
          text: item.prompt,
          url: item.downloadUrl,
        });
        setNotice("Share sheet opened.");
        return;
      }

      await navigator.clipboard.writeText(item.downloadUrl);
      setNotice("Share URL copied to clipboard.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Share failed.");
    }
  };

  const retryFromItem = async (item: LibraryItem) => {
    if (!item.jobId) {
      setNotice("Missing source job id for retry.");
      return;
    }

    setBusyId(item.id);
    setNotice("");

    try {
      const response = await fetch(`/api/jobs/${item.jobId}/retry`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Retry failed.");
      }

      setNotice(`Retry submitted: ${data.job.id}`);
      router.push("/queue");
      router.refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Retry failed.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteItem = async (item: LibraryItem) => {
    const confirmed = window.confirm("Delete this media item from your library?");
    if (!confirmed) return;

    setBusyId(item.id);
    setNotice("");

    try {
      const response = await fetch(`/api/library/${item.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Delete failed.");
      }

      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setNotice("Media deleted.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    const scope = gridRef.current;
    if (!scope) return;

    const cards = Array.from(scope.querySelectorAll<HTMLElement>("[data-library-card]"));
    const cleanups: Array<() => void> = [];

    cards.forEach((card) => {
      const onMove = (event: MouseEvent) => {
        const bounds = card.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const y = (event.clientY - bounds.top) / bounds.height - 0.5;
        gsap.to(card, {
          rotationY: x * 10,
          rotationX: -y * 10,
          z: 26,
          transformPerspective: 1000,
          duration: 0.42,
          ease: "power3.out",
        });
      };
      const onLeave = () => {
        gsap.to(card, {
          rotationY: 0,
          rotationX: 0,
          z: 0,
          duration: 0.6,
          ease: "power3.out",
        });
      };

      card.addEventListener("mousemove", onMove);
      card.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        card.removeEventListener("mousemove", onMove);
        card.removeEventListener("mouseleave", onLeave);
      });
    });

    return () => {
      cleanups.forEach((dispose) => dispose());
    };
  }, [paginatedItems]);

  const goToPage = (p: number) => {
    setPage(Math.max(1, Math.min(p, totalPages)));
    gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="space-y-6">
      <article className="relative isolate overflow-hidden rounded-[2.1rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-7">
        <EffectsErrorBoundary>
          <OglLiquidRibbon className="pointer-events-none absolute inset-0 opacity-75" />
        </EffectsErrorBoundary>
        <EffectsErrorBoundary>
          <RapierFloatField className="pointer-events-none absolute inset-0 opacity-35" count={10} />
        </EffectsErrorBoundary>
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold md:text-4xl">
              Media Vault and Playback Gallery
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-cyan-100/80">
              Completed media is re-hosted in your Supabase storage, streamed in-app, and downloadable on demand.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "video", "image"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.14em] transition-all duration-200 active:scale-[0.92] active:brightness-110 ${
                  filter === value
                    ? "border-cyan-100/75 bg-cyan-200/85 text-slate-900 shadow-[0_0_12px_rgba(34,211,238,0.3)]"
                    : "border-cyan-100/35 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/20 hover:shadow-[0_0_10px_rgba(34,211,238,0.15)]"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </article>

      <article className="rounded-[2.1rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-7">
        {loading ? <p className="text-sm text-cyan-100/75">Loading library...</p> : null}
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        {notice ? <p className="text-sm text-cyan-200">{notice}</p> : null}
        {!loading && !filteredItems.length ? <p className="text-sm text-cyan-100/75">No media items found.</p> : null}

        <div ref={gridRef} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {paginatedItems.map((item) => (
            <article
              key={item.id}
              data-library-card
              className="curtain-plane rounded-3xl border border-cyan-100/25 bg-slate-900/65 p-3 shadow-[0_25px_65px_rgba(8,47,73,0.4)]"
            >
              <div className="mb-3 overflow-hidden rounded-2xl border border-cyan-100/20">
                {item.kind === "video" ? (
                  <StableVideo src={item.playUrl} onPlay={handleVideoPlay} />
                ) : (
                  <Image
                    src={item.playUrl}
                    alt={item.prompt}
                    width={720}
                    height={480}
                    unoptimized
                    className="h-56 w-full object-cover"
                  />
                )}
              </div>
              <p className="line-clamp-2 text-sm text-slate-100">{item.prompt}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.13em] text-cyan-100/80">{item.model}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded-full border border-cyan-100/30 bg-cyan-300/10 px-2 py-1 text-[11px] uppercase tracking-[0.1em] text-cyan-100/80">
                  {item.kind}
                </span>
                <div className="flex items-center gap-2">
                  <InteractiveButton
                    onClick={() => downloadFile(item.downloadUrl)}
                  >
                    Download
                  </InteractiveButton>
                  <InteractiveButton onClick={() => shareItem(item)}>
                    Share
                  </InteractiveButton>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-end gap-2">
                <InteractiveButton
                  disabled={busyId === item.id}
                  onClick={() => retryFromItem(item)}
                  variant="ghost"
                  className="bg-slate-900/65 hover:bg-slate-800/70"
                >
                  Retry
                </InteractiveButton>
                <InteractiveButton
                  disabled={busyId === item.id}
                  onClick={() => deleteItem(item)}
                  variant="danger"
                >
                  Delete
                </InteractiveButton>
              </div>
            </article>
          ))}
        </div>

        {totalPages > 1 ? (
          <nav className="mt-6 flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={clampedPage <= 1}
              onClick={() => goToPage(clampedPage - 1)}
              className="rounded-xl border border-cyan-100/35 bg-slate-900/55 px-3 py-2 text-xs uppercase tracking-[0.12em] text-cyan-100 transition-all duration-200 hover:bg-slate-800/65 hover:shadow-[0_0_10px_rgba(34,211,238,0.15)] active:scale-[0.92] active:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="inline-block">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="ml-1 hidden sm:inline">Prev</span>
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
              if (totalPages > 7 && Math.abs(p - clampedPage) > 2 && p !== 1 && p !== totalPages) {
                if (p === clampedPage - 3 || p === clampedPage + 3) {
                  return (
                    <span key={p} className="px-1 text-xs text-cyan-100/50">
                      ...
                    </span>
                  );
                }
                return null;
              }

              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => goToPage(p)}
                  className={`min-w-[2.2rem] rounded-xl border px-2 py-2 text-xs uppercase tracking-[0.1em] transition-all duration-200 active:scale-[0.9] active:brightness-110 ${
                    p === clampedPage
                      ? "border-cyan-100/70 bg-cyan-200/80 text-slate-900 shadow-[0_0_14px_rgba(34,211,238,0.35)]"
                      : "border-cyan-100/30 bg-slate-900/55 text-cyan-100 hover:bg-slate-800/60 hover:shadow-[0_0_10px_rgba(34,211,238,0.12)]"
                  }`}
                >
                  {p}
                </button>
              );
            })}

            <button
              type="button"
              disabled={clampedPage >= totalPages}
              onClick={() => goToPage(clampedPage + 1)}
              className="rounded-xl border border-cyan-100/35 bg-slate-900/55 px-3 py-2 text-xs uppercase tracking-[0.12em] text-cyan-100 transition-all duration-200 hover:bg-slate-800/65 hover:shadow-[0_0_10px_rgba(34,211,238,0.15)] active:scale-[0.92] active:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <span className="mr-1 hidden sm:inline">Next</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="inline-block">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </nav>
        ) : null}

        {filteredItems.length > 0 ? (
          <p className="mt-3 text-center text-[11px] uppercase tracking-[0.15em] text-cyan-100/55">
            Showing {(clampedPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(clampedPage * ITEMS_PER_PAGE, filteredItems.length)} of {filteredItems.length} items
          </p>
        ) : null}
      </article>
    </section>
  );
}
