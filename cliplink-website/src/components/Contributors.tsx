"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, GitPullRequest } from "lucide-react";
import SectionHeader from "./SectionHeader";
import Accent from "./Accent";
import AnimatedList from "./reactbits/AnimatedList";
import { SITE } from "@/lib/site";

interface Contributor {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
}

// Only the maintainer is hard-coded; everyone else comes from the live API so
// the page never invents people who don't exist.
const SEED: Contributor[] = [
  {
    id: 1,
    login: "ichigo-k",
    avatar_url: "https://github.com/ichigo-k.png?size=96",
    html_url: "https://github.com/ichigo-k",
    contributions: 0,
  },
];

export default function Contributors() {
  const [people, setPeople] = useState<Contributor[]>(SEED);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("https://api.github.com/repos/ichigo-k/cliplink/contributors?per_page=24")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && Array.isArray(data) && data.length) setPeople(data);
      })
      .catch(() => {
        /* offline or rate-limited — the seed list stands in */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const top = people[0]?.contributions || 1;

  return (
    <section
      id="contributors"
      className="paper scroll-mt-20 border-y hairline py-16 sm:py-24 lg:py-32"
    >
      <div className="shell">
        <SectionHeader
          index="04"
          label="Who builds it"
          title={
            <>
              Built in the open,
              <br className="hidden sm:block" /> by people you can{" "}
              <Accent>name</Accent>.
            </>
          }
          blurb="Pulled live from the repo. Ship a fix and you're on this list."
          aside={
            <a
              href={SITE.contribution}
              className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-signal-400 hover:text-signal-300"
            >
              Contributing guide
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          }
        />

        <div className="mt-10 border-t hairline sm:mt-14">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-5 border-b hairline py-5">
                <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-ink-900" />
                <span className="h-3 w-36 animate-pulse rounded bg-ink-900" />
                <span className="ml-auto h-3 w-16 animate-pulse rounded bg-ink-900" />
              </div>
            ))
            : <AnimatedList
              // A page-level list, not a scroller: no inner height cap, no edge
              // fades, and rows stay put once they have arrived.
              items={people}
              getKey={(p) => p.id ?? p.login}
              once
              amount={0.3}
              stagger={0.07}
              duration={0.55}
              scroll={false}
              maxHeight="none"
              padding="0"
              itemGap="0"
              showGradients={false}
              displayScrollbar={false}
              enableArrowNavigation={false}
              renderItem={(p, i) => (
              <a
                href={p.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-4 border-b hairline py-5 transition-colors hover:bg-ink-900/50 sm:gap-6"
              >
                <span className="eyebrow w-6 shrink-0 text-ink-600">
                  {String(i + 1).padStart(2, "0")}
                </span>

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.avatar_url}
                  alt=""
                  loading="lazy"
                  className="h-10 w-10 shrink-0 rounded-full border hairline grayscale transition-all duration-300 group-hover:grayscale-0 group-hover:border-signal-500/50"
                />

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[16px] font-medium tracking-[-0.02em] text-ink-100 transition-colors group-hover:text-signal-300">
                    {p.login}
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-ink-500">
                    {p.contributions} commit{p.contributions === 1 ? "" : "s"}
                  </span>
                </span>

                {/* contribution bar */}
                <span className="hidden h-1 w-40 overflow-hidden rounded-full bg-ink-900 sm:block">
                  <span
                    className="block h-full rounded-full bg-signal-500/70"
                    style={{ width: `${Math.max(6, (p.contributions / top) * 100)}%` }}
                  />
                </span>

                <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-600 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-signal-400" />
              </a>
              )}
            />}

          <a
            href={SITE.issues}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-4 border-b hairline py-6 sm:gap-6"
          >
            <span className="eyebrow w-6 shrink-0 text-signal-500">+</span>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-signal-500/30 bg-signal-950/40">
              <GitPullRequest className="h-4 w-4 text-signal-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[16px] font-medium tracking-[-0.02em] text-ink-100 group-hover:text-signal-300">
                Your handle here
              </span>
              <span className="mt-1 block font-mono text-[11px] text-ink-500">
                open an issue or send a pull request
              </span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-600 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-signal-400" />
          </a>
        </div>
      </div>
    </section>
  );
}
