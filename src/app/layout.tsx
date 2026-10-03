import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dip",
  description: "Watch prices. Privately.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
