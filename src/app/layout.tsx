import type { Metadata } from "next";
import { preconnect } from "react-dom";
import { Auth0Provider } from "@auth0/nextjs-auth0";
import { IdentityMergeOnLogin } from "@/components/IdentityMergeOnLogin";
import { Bricolage_Grotesque, Instrument_Sans, Instrument_Serif, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// 3G: cada peso es un woff2 que compite con fotos y JS. Solo los pesos USADOS
// (grep fontWeight por familia, 2026-07-12): brico solo 700/800, serif solo
// itálica, mono solo 400. Si un componente nuevo usa otro peso, añadirlo aquí.
// serif/mono con preload:false: decoran detalles (greeting itálico,
// placeholders mono), no bloquean el above-the-fold — ~26KB fuera del camino
// crítico; el swap usa el fallback ajustado por métricas de next/font.
const brico = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-brico" });
const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic"], variable: "--font-serif", preload: false });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400"], variable: "--font-mono", preload: false });

export const metadata: Metadata = {
  title: "E-commerce Cuba",
  description: "MVP de e-commerce reseller con personalización adaptativa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // 3G: abrir DNS+TCP+TLS hacia los 4 CDNs de fotos EN PARALELO con la
  // descarga de HTML/JS — cada dominio frío cuesta ~3 RTT (1.2s) que antes se
  // pagaban en serie al pedir la primera imagen.
  preconnect("https://m.media-amazon.com");
  preconnect("https://ae-pic-a1.aliexpress-media.com");
  preconnect("https://img.ltwebstatic.com");
  preconnect("https://i5.walmartimages.com");
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
