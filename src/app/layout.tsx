import type { Metadata, Viewport } from "next";
import { Arimo, Barlow_Condensed, Geist_Mono } from "next/font/google";
import { ClickSound } from "@/components/layout/click-sound";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// The UI font is Arimo (an Arial-style sans, see globals.css).
// Barlow Condensed is only loaded for the map's region labels.
const arimo = Arimo({ variable: "--font-arimo", subsets: ["latin"] });
const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "DYNASTY",
    template: "%s · DYNASTY",
  },
  description:
    "Browse Leonida's most notorious properties on an interactive map and discover their Solana property tokens.",
};

export const viewport: Viewport = {
  themeColor: "#34213f", // --color-vc-page
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${arimo.variable} ${barlow.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
        <ClickSound />
      </body>
    </html>
  );
}
