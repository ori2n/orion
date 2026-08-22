import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppHeader } from '@/components/app-header';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Orion",
  description: "Track your habits and build a second brain.",
  appleWebApp: {
    capable: true,
    title: "Orion",
    statusBarStyle: "black-translucent",
  },
  other: {
    // Explicit iOS standalone signal. Next.js emits `mobile-web-app-capable`
    // for `appleWebApp.capable`, but iOS keys off this classic tag (the
    // manifest `display: "standalone"` also covers modern iOS 11.3+).
    'apple-mobile-web-app-capable': 'yes',
  },
};

// PWA viewport: lock zoom to 1 (pinch-zoom can pop iOS out of the
// standalone shell) and let content draw under the status bar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* body keeps a definite height (h-full) so flex children like the
          time-management dashboard can fill the viewport. Content that is
          taller than the viewport simply overflows the body (overflow is
          visible), so the DOCUMENT scrolls naturally — no nested scroll
          containers, which is what made vertical swiping unreliable on
          phones. */}
      <body className="flex h-full flex-col">
        {/* Sticky compact header. It owns the safe-area top padding, so
            the interactive section dropdown always sits below the iOS
            status bar / notch (taps under the status bar are dead in
            standalone PWA mode). */}
        <AppHeader />
        {/* flex-1 + min-h-0 gives each route a definite available height;
            routes that opt out (fitness) grow past it and scroll the
            document instead. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
