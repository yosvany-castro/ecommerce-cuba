// src/app/(tuki)/page.tsx — home Tuki (server): SSR del feed real (hero_grid).
import { getHomePage } from "@/storefront/pages/home";
import { HomeFeed } from "@/components/tuki/HomeFeed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const page = await getHomePage();
  const hero = page.sections.find((s) => s.section_type === "hero_grid");
  return (
    <HomeFeed
      initialCards={hero?.items ?? []}
      nextCursor={hero?.next_cursor ?? null}
      slateId={hero?.slate_id ?? null}
    />
  );
}
