import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XIAOCHUANG Admin",
  description: "AI Short Drama Platform - Admin Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
