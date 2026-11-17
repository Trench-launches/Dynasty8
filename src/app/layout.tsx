import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Figtree, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Open-licence lookalikes for the reference site's type: a bold grotesque for UI/body and
// a condensed uppercase face for display headings. (Rockstar's own fonts are proprietary.)
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"] });
const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "DYNASTY — Leonida Property Market",
    template: "%s · DYNASTY",
  },
  description:
    "Browse Leonida's most notorious properties on an interactive map and discover their Solana property tokens.",
};

export const viewport: Viewport = {
  themeColor: "#141527",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${figtree.variable} ${barlow.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
