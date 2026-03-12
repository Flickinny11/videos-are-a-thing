import type { Metadata } from "next";
import { Orbitron, Outfit } from "next/font/google";

import "./globals.css";

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  weight: ["500", "700"],
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "RunPod Media Studio",
  description: "Generate AI images and videos with RunPod pipelines.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${orbitron.variable} ${outfit.variable}`}>
      <body>{children}</body>
    </html>
  );
}
