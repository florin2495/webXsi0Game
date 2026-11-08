import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "X și 0",
  applicationName: "X și 0",
  other: { "apple-mobile-web-app-capable": "yes" },
  appleWebApp: { capable: true, title: "X și 0", statusBarStyle: "default" },
  description: "X și 0 clasic, jucat cu un prieten. Alții pot intra ca spectatori.",
  // metadata.icons URLs are not prefixed with basePath. Setting icons drops the automatic
  // app/favicon.ico link, so it is listed here too.
  icons: {
    icon: [{ url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/favicon.ico`, sizes: "48x48", type: "image/x-icon" }],
    apple: [{ url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/pwa-icon/apple`, sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ro" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
