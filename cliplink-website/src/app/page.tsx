import Header from "@/components/Header";
import SectionRail from "@/components/SectionRail";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import Spotlight from "@/components/Spotlight";
import Features from "@/components/Features";
import SyncSimulator from "@/components/SyncSimulator";
import SecurityDeepDive from "@/components/SecurityDeepDive";
import Contributors from "@/components/Contributors";
import Downloads from "@/components/Downloads";
import Footer from "@/components/Footer";
import { fetchLatestRelease } from "@/lib/release";

// Revalidate the page every 5 minutes so a new GitHub release
// appears on the site without a manual redeploy.
export const revalidate = 300;

export default async function Home() {
  const release = await fetchLatestRelease();

  return (
    <>
      <Header version={release.version} />
      <SectionRail />
      <main className="flex-1">
        <Hero version={release.version} />
        <Ticker />
        <Spotlight />
        <Features />
        <SyncSimulator />
        <SecurityDeepDive />
        <Contributors />
        <Downloads release={release} />
      </main>
      <Footer version={release.version} />
    </>
  );
}
