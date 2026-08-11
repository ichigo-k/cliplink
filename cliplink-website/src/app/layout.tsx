import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "ClipLink: Direct Local Clipboard Sync & P2P File Transfer",
  description: "ClipLink is an offline-first, source-available bridge for synchronizing clipboard content and transferring files securely between Windows PC, macOS, Linux, and Android over your local area network (LAN). No cloud. No accounts.",
  keywords: ["clipboard sync", "P2P transfer", "local network", "offline-first", "source available", "secure sharing", "Tauri", "React Native", "privacy tool"],
  openGraph: {
    title: "ClipLink: Direct Local Clipboard Sync",
    description: "Your clipboard. Your devices. One private bridge. Synchronize copy-paste content locally between Windows, Mac, Linux, and Android with zero-cloud setup.",
    type: "website",
    url: "https://github.com/ichigo-k/cliplink",
  }
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${interTight.variable} ${jetbrains.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink-300 selection:bg-signal-500">
        {children}
      </body>
    </html>
  );
}
