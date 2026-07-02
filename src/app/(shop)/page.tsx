import { after } from "next/server";
import { getHomePage } from "@/storefront/pages/home";
import { SlateRenderer } from "@/components/slate/SlateRenderer";
import { RequestTiming } from "@/lib/timing";

export const dynamic = "force-dynamic";

/** F5: sampled structured-log persistence (Server Components can't set headers). */
const TIMING_SAMPLE_RATE = 0.2;

function logTimingSampled(timing: RequestTiming): void {
  if (Math.random() < TIMING_SAMPLE_RATE) console.log(timing.toLogLine("home"));
}

export default async function HomePage() {
  const timing = new RequestTiming();
  // Todo el wiring (identidad+compose+resolve+log) vive en el DAL; aquí queda
  // una sola fase de timing (el desglose auth/feed_page se recupera con un
  // param opcional de timing en el DAL si F5 lo pide).
  const page = await timing.time("storefront_home", () => getHomePage());
  after(() => logTimingSampled(timing));

  const hasContent = page.sections.some((s) => s.outcome === "served" && s.items.length > 0);
  if (!hasContent) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-bold mb-4">Catálogo</h1>
        <p className="text-gray-600">
          No hay productos todavía. En desarrollo, ejecuta:
          <code className="bg-gray-100 ml-2 px-2 py-1 rounded">
            pnpm cron:catalog-fill --pages 1
          </code>{" "}
          y luego{" "}
          <code className="bg-gray-100 ml-2 px-2 py-1 rounded">
            pnpm cron:cohort-centroids
          </code>
        </p>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">Catálogo</h1>
      <SlateRenderer sections={page.sections} />
    </main>
  );
}
