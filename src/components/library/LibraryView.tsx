"use client";

import gsap from "gsap";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { VFXSpan } from "react-vfx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OglLiquidRibbon } from "@/components/effects/OglLiquidRibbon";
import { RapierFloatField } from "@/components/effects/RapierFloatField";
import type { LibraryItem } from "@/types/app";

type FilterKind = "all" | "video" | "image";

export function LibraryView() {
  const router = useRouter();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const fetchLibrary = useCallback(async () => {
    try {
      const response = await fetch("/api/library", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Failed to load library");
      setItems(data.items || []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchLibrary();
    }, 18000);

    return () => window.clearInterval(interval);
  }, [fetchLibrary]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.kind === filter);
  }, [items, filter]);

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
  }, [filteredItems]);

  return (
    <section className="space-y-6">
      <article className="relative isolate overflow-hidden rounded-[2.1rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-7">
        <OglLiquidRibbon className="pointer-events-none absolute inset-0 opacity-75" />
        <RapierFloatField className="pointer-events-none absolute inset-0 opacity-35" count={10} />
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold md:text-4xl">
              <VFXSpan shader="rgbShift">Media Vault and Playback Gallery</VFXSpan>
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-cyan-100/80">
              Completed media is re-hosted in your Supabase storage, streamed in-app, and downloadable on demand.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "video", "image"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-2xl border px-4 py-2 text-xs uppercase tracking-[0.14em] transition ${
                  filter === value
                    ? "border-cyan-100/75 bg-cyan-200/85 text-slate-900"
                    : "border-cyan-100/35 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/20"
                }`}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void fetchLibrary()}
              className="rounded-2xl border border-cyan-100/40 bg-slate-900/55 px-4 py-2 text-xs uppercase tracking-[0.14em] text-cyan-100 transition hover:bg-slate-800/65"
            >
              Refresh
            </button>
          </div>
        </div>
      </article>

      <article className="rounded-[2.1rem] border border-cyan-100/20 bg-slate-950/55 p-5 backdrop-blur-2xl md:p-7">
        {loading ? <p className="text-sm text-cyan-100/75">Loading library...</p> : null}
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        {notice ? <p className="text-sm text-cyan-200">{notice}</p> : null}
        {!loading && !filteredItems.length ? <p className="text-sm text-cyan-100/75">No media items found.</p> : null}

        <div ref={gridRef} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((item) => (
            <article
              key={item.id}
              data-library-card
              className="curtain-plane rounded-3xl border border-cyan-100/25 bg-slate-900/65 p-3 shadow-[0_25px_65px_rgba(8,47,73,0.4)]"
            >
              <div className="mb-3 overflow-hidden rounded-2xl border border-cyan-100/20">
                {item.kind === "video" ? (
                  <video src={item.playUrl} controls playsInline className="h-56 w-full object-cover" />
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
                  <a
                    href={item.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-cyan-100/45 bg-cyan-100/10 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-100/20"
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={() => void shareItem(item)}
                    className="rounded-xl border border-cyan-100/45 bg-cyan-100/10 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-cyan-50 transition hover:bg-cyan-100/20"
                  >
                    Share
                  </button>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void retryFromItem(item)}
                  className="rounded-xl border border-cyan-100/45 bg-slate-900/65 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-cyan-100 transition hover:bg-slate-800/70 disabled:opacity-60"
                >
                  Retry
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void deleteItem(item)}
                  className="rounded-xl border border-rose-200/45 bg-rose-300/10 px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-rose-200 transition hover:bg-rose-300/20 disabled:opacity-60"
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}
