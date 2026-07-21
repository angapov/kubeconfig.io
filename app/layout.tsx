import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manifest Studio — Visual Kubernetes YAML Builder",
  description:
    "Build Kubernetes Pod, Deployment, and Service manifests from familiar fields and export clean YAML instantly.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
