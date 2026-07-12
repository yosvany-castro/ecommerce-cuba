import type { Metadata } from "next";
import { Auth0Provider } from "@auth0/nextjs-auth0";
import { IdentityMergeOnLogin } from "@/components/IdentityMergeOnLogin";
import { Bricolage_Grotesque, Instrument_Sans, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// 3G: cada peso es un woff2 que compite con fotos y JS. Solo los pesos USADOS
// (grep fontWeight por familia, 2026-07-12): brico solo 700/800, serif solo
// itálica, mono solo 400. Si un componente nuevo usa otro peso, añadirlo aquí.
const brico = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-brico" });
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic"], variable: "--font-serif" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "E-commerce Cuba",
  description: "MVP de e-commerce reseller con personalización adaptativa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${brico.variable} ${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <Auth0Provider>
          <IdentityMergeOnLogin />
          {children}
        </Auth0Provider>
      </body>
    </html>
  );
}
