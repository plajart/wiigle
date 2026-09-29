import type { Metadata, Viewport } from "next";
import "./globals.css";
import NavBar from "./components/NavBar";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "포인트 관리",
  description: "매장 포인트 적립·사용을 관리하는 프로그램",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "포인트",
  },
};

export const viewport: Viewport = {
  themeColor: "#1c2541",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <ServiceWorkerRegister />
        <NavBar />
        <main>{children}</main>
      </body>
    </html>
  );
}
