import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Create Thyself",
  description: "A living field where your thoughts organize themselves",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
