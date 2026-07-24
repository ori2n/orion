import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthButton from '@/components/auth-button';

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
      <body className="h-full flex flex-col">
        <nav className="flex items-center gap-6 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <Link
            href="/"
            className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Home
          </Link>
          <Link
            href="/actions"
            className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Time Management
          </Link>
          <Link
            href="/fitness"
            className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Fitness
          </Link>
          <Link
            href="/settings"
            className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Settings
          </Link>

          <div className="ml-auto flex items-center gap-4">
            <AuthButton />
          </div>
        </nav>
        {/* flex-1 + min-h-0 lets each route control its own scroll
            container (e.g. /actions stays fully static, /fitness keeps
            its own overflow-y-auto). The old `overflow-y-auto` here
            forced every page to scroll even when the child could have
            fit without one. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
