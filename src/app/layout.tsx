import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// The UI uses the system font stack (Dynasty 8 / Bootstrap style, see globals.css).
// Barlow Condensed is only loaded for the map's region labels.
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
  themeColor: "#18713c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
