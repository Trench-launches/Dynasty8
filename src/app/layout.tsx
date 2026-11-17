import type { Metadata, Viewport } from "next";
import { Anton, Manrope } from "next/font/google";
import { brand } from "@/config/brand";
import { SiteHeader } from "@/components/layout/site-header";
import { TokenTape } from "@/components/layout/token-tape";
import { SiteFooter } from "@/components/layout/site-footer";
import "./globals.css";

const anton = Anton({ subsets: ["latin"], weight: "400", variable: "--font-anton", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${brand.name} · ${brand.subtitle}`, template: `%s · ${brand.name}` },
  description: brand.description,
};

export const viewport: Viewport = {
  themeColor: "#FF6B9D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${manrope.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader />
        <TokenTape />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
