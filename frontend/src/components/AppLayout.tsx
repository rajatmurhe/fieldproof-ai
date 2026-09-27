"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  {
    name: "Dashboard",
    href: "/",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    name: "Jobs",
    href: "/jobs",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    name: "Reviews",
    href: "/reviews",
    hasBadge: true,
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    name: "Checklists",
    href: "/checklists",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    name: "Analytics",
    href: "/analytics",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
];

export default function AppLayout({
  children,
  title,
  subtitle,
  action,
}: AppLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [reviewCount, setReviewCount] = useState<number | null>(null);

  // Fetch pending review count for the sidebar badge
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
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent" />
          <p className="text-sm font-medium text-slate-500">Loading FieldProof AI...</p>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col border-r border-slate-200 bg-white shadow-sm shrink-0">
        {/* Brand */}
        <div className="border-b border-slate-200 px-6 py-5">
          <Link href="/" className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-teal-700 flex items-center justify-center text-white font-bold text-lg shadow-sm">
              FP
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-slate-900">
                FieldProof <span className="text-teal-700 font-extrabold">AI</span>
              </span>
              <p className="text-xs text-slate-500 font-medium">Video QA Platform</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1.5 p-4">
          {NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? "bg-teal-50 text-teal-800 font-semibold shadow-xs"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={isActive ? "text-teal-700" : "text-slate-400"}>
                    {item.icon}
                  </span>
                  <span>{item.name}</span>
                </div>

                {item.hasBadge && reviewCount !== null && reviewCount > 0 && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                    {reviewCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Quick action in sidebar */}
        <div className="p-4 border-t border-slate-100">
          <button
            onClick={() => router.push("/jobs/new")}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 active:scale-[0.98]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            New Job
          </button>
        </div>

        {/* System info badge */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/50">
          <div className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-xs font-semibold text-slate-700">Gemini 2.0 Agentic QA</p>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Async queue worker active
            </p>
          </div>
        </div>

        {/* Clerk Auth Profile */}
        <div className="border-t border-slate-200 p-4">
          <ClerkControls />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="border-b border-slate-200 bg-white px-6 py-4 sticky top-0 z-20 shadow-xs">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button
                type="button"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                aria-label="Toggle navigation"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>

              <div>
                {title ? (
                  <>
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                      {title}
                    </h1>
                    {subtitle && (
                      <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{subtitle}</p>
                    )}
                  </>
                ) : (
                  <span className="lg:hidden font-bold text-slate-900 text-lg">
                    FieldProof <span className="text-teal-700">AI</span>
                  </span>
                )}
              </div>
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center gap-3">
              {action}
              <div className="lg:hidden">
                <ClerkControls />
              </div>
            </div>
          </div>

          {/* Mobile dropdown menu */}
          {mobileMenuOpen && (
            <div className="lg:hidden mt-4 pt-4 border-t border-slate-100 space-y-1">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium ${
                      isActive
                        ? "bg-teal-50 text-teal-800 font-semibold"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span>{item.icon}</span>
                      <span>{item.name}</span>
                    </div>
                    {item.hasBadge && reviewCount !== null && reviewCount > 0 && (
                      <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                        {reviewCount}
                      </span>
                    )}
                  </Link>
                );
              })}
              <div className="pt-2">
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    router.push("/jobs/new");
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
                >
                  + New Job
                </button>
              </div>
            </div>
          )}
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
