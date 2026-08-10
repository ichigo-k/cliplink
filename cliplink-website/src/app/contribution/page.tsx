import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { SITE } from "@/lib/site";

const sections = [
    {
        title: "Before You Start",
        body: [
            "Please open an issue first if you want to work on something new. That gives us a chance to discuss the idea, confirm the scope, and avoid duplicated work.",
            "If an existing issue already matches the work you want to do, feel free to pick it up and comment there before you start.",
        ],
    },
    {
        title: "Workflow",
        body: [
            "Raise an issue describing the problem, feature, or improvement.",
            "Discuss the plan with us in the issue thread so we can make sure we are aiming at the same thing.",
            "Once the direction is clear, go ahead and build it.",
            "Make the changes, review the code carefully, and test what you can.",
            "Open a pull request that links back to the issue.",
        ],
    },
    {
        title: "AI-Assisted Contributions",
        body: [
            "We know some contributors use AI tools to help write or review code. That is fine, and it is helpful if you mention it in the issue or pull request.",
            "If you are using AI assistance, please do your best to review the generated code carefully, verify the behavior, and make sure the final change really matches the issue.",
        ],
    },
];

export default function ContributionPage() {
    return (
        <>
            <Header />
            <main className="flex-1">
                <section className="paper border-b hairline pt-28 pb-16 sm:pt-32 sm:pb-24 lg:pt-36 lg:pb-28">
                    <div className="shell max-w-4xl">
                        <p className="eyebrow text-signal-400">Contribution guide</p>
                        <h1 className="mt-5 font-display text-[clamp(2.2rem,7vw,4.5rem)] font-semibold leading-[0.95] tracking-tighter text-ink-50">
                            Start with an issue.
                            <br />
                            Then build together.
                        </h1>
                        <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-ink-400 sm:text-[16px]">
                            Thanks for taking the time to contribute to ClipLink. We like contributions that
                            start with a conversation, stay collaborative, and are easy to review.
                        </p>

                        <div className="mt-8 flex flex-wrap gap-3">
                            <a
                                href={SITE.issues}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center rounded-md bg-signal-500 px-5 py-3 text-[14px] font-semibold text-canvas transition-colors hover:bg-signal-400"
                            >
                                Open an issue
                            </a>
                            <a
                                href="/"
                                className="inline-flex items-center justify-center rounded-md border hairline px-5 py-3 text-[14px] font-medium text-ink-200 transition-colors hover:border-signal-500/50 hover:text-ink-50"
                            >
                                Back to site
                            </a>
                        </div>
                    </div>
                </section>

                <section className="py-16 sm:py-20 lg:py-24">
                    <div className="shell max-w-4xl space-y-14">
                        {sections.map((section) => (
                            <article key={section.title} className="border-t hairline pt-8">
                                <h2 className="font-display text-[clamp(1.35rem,4vw,2rem)] font-semibold tracking-[-0.03em] text-ink-50">
                                    {section.title}
                                </h2>
                                <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-ink-400 sm:text-[16px]">
                                    {section.body.map((paragraph) => (
                                        <p key={paragraph}>{paragraph}</p>
                                    ))}
                                </div>
                            </article>
                        ))}

                        <article className="border-t hairline pt-8">
                            <h2 className="font-display text-[clamp(1.35rem,4vw,2rem)] font-semibold tracking-[-0.03em] text-ink-50">
                                What We Value
                            </h2>
                            <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-ink-400 sm:text-[16px]">
                                <li>Clear issue descriptions</li>
                                <li>Early discussion before implementation</li>
                                <li>Careful code review</li>
                                <li>Tests or validation where practical</li>
                                <li>Small, focused pull requests</li>
                            </ul>
                        </article>

                        <article className="border-t hairline pt-8">
                            <h2 className="font-display text-[clamp(1.35rem,4vw,2rem)] font-semibold tracking-[-0.03em] text-ink-50">
                                Good Defaults
                            </h2>
                            <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-ink-400 sm:text-[16px]">
                                <li>Keep changes minimal and easy to review.</li>
                                <li>Check for existing issues before starting new work.</li>
                                <li>Mention any assumptions or tradeoffs in the issue or PR.</li>
                                <li>If something is uncertain, ask first rather than guessing.</li>
                            </ul>
                        </article>
                    </div>
                </section>
            </main>
            <Footer />
        </>
    );
}