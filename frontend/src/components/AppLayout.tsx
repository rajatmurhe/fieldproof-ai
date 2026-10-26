"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import ClerkControls from "@/components/ClerkControls";
import { apiFetch } from "@/lib/api";

type AppLayoutProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
};

const NAV_ITEMS = [
  { name: "Dashboard", href: "/" },
  { name: "Jobs", href: "/jobs" },
  { name: "Reviews", href: "/reviews", hasBadge: true },
  { name: "Checklists", href: "/checklists" },
  { name: "Analytics", href: "/analytics" },
];

// Keep the current section in view in the scrollable phone nav strip.
function scrollIntoNav(el: HTMLAnchorElement | null) {
  el?.scrollIntoView({ block: "nearest", inline: "center" });
}

function isActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="FieldProof AI home">
      <span className="grid h-7 w-7 place-items-center border-2 border-ink font-mono text-[11px] font-semibold leading-none">
        FP
      </span>
      <span className="display text-[17px] uppercase leading-none tracking-wide">
        FieldProof
        <span className="ml-1.5 font-mono text-[10px] font-medium tracking-[0.12em] text-signal-deep max-sm:hidden">
          QA DESK
        </span>
      </span>
    </Link>
  );
}

export default function AppLayout({
  children,
  title,
  subtitle,
  action,
}: AppLayoutProps) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  // Fetch pending review count for the nav badge
  useEffect(() => {
    let isMounted = true;
    async function fetchReviewStats() {
      if (!isLoaded || !isSignedIn) return;
      try {
        const token = await getToken();
        if (!token) return;
        const res = await apiFetch("/jobs/stats", token);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setReviewCount(data.review ?? 0);
          }
        }
      } catch {
        // Silently ignore background stats fetch errors
      }
    }
    fetchReviewStats();
    return () => {
      isMounted = false;
    };
  }, [isLoaded, isSignedIn, getToken, pathname]);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper">
        <Wordmark />
        <span className="loader" aria-hidden />
        <p className="kicker">Opening the docket…</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return null;
  }

  const sectionIndex = NAV_ITEMS.findIndex((item) => isActive(item.href, pathname));
  const section = sectionIndex >= 0 ? NAV_ITEMS[sectionIndex] : null;

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col">
      <header className="sticky top-0 z-20 border-b-2 border-ink bg-paper">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6 lg:px-8">
          <Wordmark />

          <nav className="hidden lg:flex h-full items-stretch" aria-label="Main">
            {NAV_ITEMS.map((item, i) => (
              <NavLink
                key={item.href}
                item={item}
                index={i}
                active={isActive(item.href, pathname)}
                reviewCount={reviewCount}
              />
            ))}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <Link href="/jobs/new" className="btn btn-primary btn-sm" aria-label="New job">
              <span aria-hidden>+</span> New<span className="max-sm:hidden"> job</span>
            </Link>
            <ClerkControls />
          </div>
        </div>

        {/* Below lg the sections become a scrollable strip under the wordmark. */}
        <nav
          className="lg:hidden flex h-10 items-stretch overflow-x-auto border-t border-rule px-2 sm:px-4"
          aria-label="Main"
        >
          {NAV_ITEMS.map((item, i) => (
            <NavLink
              key={item.href}
              item={item}
              index={i}
              active={isActive(item.href, pathname)}
              reviewCount={reviewCount}
            />
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 sm:px-6 lg:px-8">
        {title && (
          <div className="flex flex-col gap-4 border-b border-rule py-6 sm:flex-row sm:items-end sm:justify-between sm:py-8">
            <div className="min-w-0">
              <p className="kicker">
                {section ? `§ ${String(sectionIndex + 1).padStart(2, "0")} — ${section.name}` : "FieldProof"}
              </p>
              <h1 className="display mt-1.5 truncate text-3xl leading-none sm:text-[2.6rem]">{title}</h1>
              {subtitle && <p className="mt-2 max-w-2xl text-sm text-ink-2">{subtitle}</p>}
            </div>
            {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
          </div>
        )}

        <div className="pt-6 sm:pt-8">{children}</div>
      </main>
    </div>
  );
}

function NavLink({
  item,
  index,
  active,
  reviewCount,
}: {
  item: (typeof NAV_ITEMS)[number];
  index: number;
  active: boolean;
  reviewCount: number | null;
}) {
  return (
    <Link
      ref={active ? scrollIntoNav : undefined}
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`group relative flex shrink-0 items-center gap-1.5 px-3 text-sm transition-colors ${
        active ? "text-ink font-semibold" : "text-ink-2 hover:text-ink"
      }`}
    >
      <span className={`font-mono text-[10px] ${active ? "text-signal-deep" : "text-ink-3"}`}>
        {String(index + 1).padStart(2, "0")}
      </span>
      {item.name}
      {item.hasBadge && reviewCount !== null && reviewCount > 0 && (
        <span className="ml-0.5 bg-signal px-1.5 font-mono text-[10px] font-semibold leading-[1.6] text-white">
          {reviewCount}
        </span>
      )}
      <span
        className={`absolute inset-x-3 -bottom-0.5 h-[3px] ${
          active ? "bg-signal" : "bg-transparent group-hover:bg-rule"
        }`}
      />
    </Link>
  );
}
