import Header from "@/components/Header";
import Hero from "@/components/Hero";
import Ticker from "@/components/Ticker";
import Features from "@/components/Features";
import SyncSimulator from "@/components/SyncSimulator";
import SecurityDeepDive from "@/components/SecurityDeepDive";
import Contributors from "@/components/Contributors";
import Downloads from "@/components/Downloads";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <Hero />
        <Ticker />
        <Features />
        <SyncSimulator />
        <SecurityDeepDive />
        <Contributors />
        <Downloads />
      </main>
      <Footer />
    </>
  );
}
