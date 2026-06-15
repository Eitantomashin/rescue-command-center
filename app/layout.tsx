import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ינשו\"פ",
  description: "יצירת ניתוח שוטף ותמיכה פיקודית"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
