import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agnoia Terminal | Professional Order Book Simulator",
  description:
    "Real-time Order Book simulator with Price-Time Priority Matching Engine, Candlestick Charts, and multiplayer support. Learn how stock exchange order books work.",
  keywords: [
    "order book",
    "matching engine",
    "trading simulator",
    "candlestick chart",
    "stock exchange",
    "price-time priority",
    "bursa saham",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className={inter.variable}>
      <body style={{ margin: 0, padding: 0, overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
