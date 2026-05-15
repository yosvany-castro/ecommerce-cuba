import type { Metadata } from "next";
import { Auth0Provider } from "@auth0/nextjs-auth0";
import { IdentityMergeOnLogin } from "@/components/IdentityMergeOnLogin";
import "./globals.css";

export const metadata: Metadata = {
  title: "E-commerce Cuba",
  description: "MVP de e-commerce reseller con personalización adaptativa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Auth0Provider>
          <IdentityMergeOnLogin />
          {children}
        </Auth0Provider>
      </body>
    </html>
  );
}
