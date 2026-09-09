import type { Metadata, Viewport } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: "TMD Map — Ordnance Survey mapping for traffic management",
  description:
    "Search any UK address or postcode and get straight to an Ordnance Survey basemap ready to capture into AutoCAD.",
};

export const viewport: Viewport = {
  themeColor: "#0d1210",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
