// src/app/(tuki)/page.tsx — home Tuki (server): SSR del feed real (hero_grid).
import { cookies } from "next/headers";
import { getHomePage } from "@/storefront/pages/home";
import { getDailyOffers } from "@/storefront/pages/offers";
import { getRebuy } from "@/storefront/pages/rebuy";
import { resolveIdentity } from "@/storefront/identity";
import { HomeFeed } from "@/components/tuki/HomeFeed";
import { profileForAnonId } from "@/components/tuki/profiles";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Bento v2: el HERO va PRIMERO y solo (visto en vivo: correr ofertas/rebuy
  // en paralelo compite por el pool y el hero muere por budget de 1500ms en
  // frío → home sin feed). Ofertas+identidad después, en paralelo entre sí.
  const page = await getHomePage();
  const [offers, identity] = await Promise.all([getDailyOffers(), resolveIdentity()]);
  const rebuy = await getRebuy(identity.user_id, identity.anonymous_id, 3);
  const hero = page.sections.find((s) => s.section_type === "hero_grid");
  // Slots 20-90 (placements del agente/config): antes se computaban y se
  // TIRABAN — ahora se pintan al hacer scroll (zona personalizable, visión
  // del dueño). El hero (slot 10) sigue intocable.
  const extras = page.sections.filter((s) => s.section_type !== "hero_grid");
  // Greeting por perfil (T11): la page ya está en el servidor — leer la cookie
  // aquí evita el flash de useEffect que tendría un componente client-only.
  const ck = await cookies();
  const profile = profileForAnonId(ck.get("anonymous_id")?.value ?? null);
  return (
    <HomeFeed
      initialCards={hero?.items ?? []}
      nextCursor={hero?.next_cursor ?? null}
      slateId={hero?.slate_id ?? null}
      extraSections={extras}
      offers={offers}
      rebuy={rebuy}
      greet={profile.greet}
      gsub={profile.gsub}
    />
  );
}
