import "./globals.css";
import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { BatchStrip } from "@/components/BatchStrip";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Obsidian — Dark Pool",
  description: "Encrypted batch-auction DEX on Fhenix CoFHE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <Header />
          <BatchStrip />
          <main className="app-main">{children}</main>
          <Toaster theme="dark" position="bottom-right" toastOptions={{
            className: "toast",
            style: {
              background: "linear-gradient(180deg, rgba(38,38,46,0.95), rgba(22,22,28,0.95))",
              border: "1px solid var(--line-strong)",
              borderRadius: "4px",
              color: "var(--silver-edge)",
              fontFamily: "var(--mono)",
              fontSize: "12px",
              letterSpacing: "0.04em",
            },
          }} />
        </Providers>
      </body>
    </html>
  );
}
