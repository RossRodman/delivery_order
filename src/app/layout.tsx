import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "Order Desk",
  description: "Order screen for advisers and owners",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
