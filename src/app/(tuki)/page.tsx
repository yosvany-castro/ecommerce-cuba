// src/app/(tuki)/page.tsx — home Tuki (server): SSR del feed real (hero_grid).
import { cookies } from "next/headers";
import { getHomePage } from "@/storefront/pages/home";
import { HomeFeed } from "@/components/tuki/HomeFeed";
import { profileForAnonId } from "@/components/tuki/profiles";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const page = await getHomePage();
  const hero = page.sections.find((s) => s.section_type === "hero_grid");
  // Greeting por perfil (T11): la page ya está en el servidor — leer la cookie
  // aquí evita el flash de useEffect que tendría un componente client-only.
  const ck = await cookies();
  const profile = profileForAnonId(ck.get("anonymous_id")?.value ?? null);
  return (
    <HomeFeed
      initialCards={hero?.items ?? []}
      nextCursor={hero?.next_cursor ?? null}
      slateId={hero?.slate_id ?? null}
      greet={profile.greet}
      gsub={profile.gsub}
    />
  );
}
