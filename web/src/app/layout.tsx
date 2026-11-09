import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: { default: "VietDub — Lồng tiếng Việt cho video Trung Quốc", template: "%s · VietDub" },
  description:
    "Kéo thả video Douyin, Bilibili… VietDub tự chép lời, dịch sang tiếng Việt, đọc giọng và ghép lại vào video.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#131211" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body className="flex min-h-dvh flex-col">
        <Header />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-8 sm:px-6">{children}</main>
        <footer className="border-t border-line py-6 text-center text-sm text-muted">
          VietDub · Video và kết quả được tự động xoá khỏi máy chủ sau một thời gian ngắn.
        </footer>
      </body>
    </html>
  );
}
