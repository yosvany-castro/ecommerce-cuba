import type { SearchTrace } from "@/sectors/c-search/debug/trace";
import type { SearchMethod } from "@/sectors/c-search/persist/searches";

export function SearchTraceView({
  trace,
  method,
}: {
  trace: SearchTrace;
  method: SearchMethod;
}) {
  return (
    <section className="space-y-6">
      <Summary trace={trace} method={method} />
      <Cache trace={trace} />
      <NormalizedSection trace={trace} />
      <FiltersSection trace={trace} />
      <FreshnessSection trace={trace} />
      <RetrievalSection trace={trace} />
      <DecisionSection trace={trace} />
      <MockFallbackSection trace={trace} />
      <FinalSection trace={trace} />
      <TimingsSection trace={trace} />
      <RawJson trace={trace} />
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Summary({ trace, method }: { trace: SearchTrace; method: SearchMethod }) {
  return (
    <Card title="Resumen">
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt>Query:</dt>
        <dd className="font-mono">{trace.raw_query}</dd>
        <dt>Hash:</dt>
        <dd className="font-mono text-xs">{trace.hash.slice(0, 16)}…</dd>
        <dt>Method:</dt>
        <dd>{method}</dd>
        <dt>Products:</dt>
        <dd>{trace.final.products_count}</dd>
        <dt>Total ms:</dt>
        <dd>{trace.timings_ms.total.toFixed(0)}</dd>
      </dl>
    </Card>
  );
}

function Cache({ trace }: { trace: SearchTrace }) {
  return (
    <Card title="Caché">
      <ul className="text-sm">
        <li>
          Exact hit: <strong>{String(trace.cache.exact_hit)}</strong>
        </li>
        <li>
          Semantic hit: <strong>{String(trace.cache.semantic_hit)}</strong>
          {trace.cache.semantic_similarity !== undefined &&
            ` (sim ${trace.cache.semantic_similarity.toFixed(3)})`}
        </li>
      </ul>
    </Card>
  );
}

function NormalizedSection({ trace }: { trace: SearchTrace }) {
  if (!trace.normalized) {
    return (
      <Card title="Lo que entendió el LLM">
        <em>(no disponible)</em>
      </Card>
    );
  }
  const n = trace.normalized;
  return (
    <Card title="Lo que entendió el LLM">
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt>Intent:</dt>
        <dd>{n.intent}</dd>
        <dt>Receptor género:</dt>
        <dd>{n.recipient_gender ?? "—"}</dd>
        <dt>Receptor edad:</dt>
        <dd>
          {n.recipient_age_min ?? "?"} – {n.recipient_age_max ?? "?"}
        </dd>
        <dt>Categories:</dt>
        <dd>{n.categories.join(", ") || "—"}</dd>
        <dt>Style:</dt>
        <dd>{n.style.join(", ") || "—"}</dd>
        <dt>Price range:</dt>
        <dd>{n.price_range ?? "—"}</dd>
        <dt>Search terms:</dt>
        <dd className="font-mono">{n.search_terms}</dd>
        <dt>Confidence:</dt>
        <dd>{n.confidence.toFixed(2)}</dd>
      </dl>
    </Card>
  );
}

function FiltersSection({ trace }: { trace: SearchTrace }) {
  return (
    <Card title="Filtros aplicados al SQL">
      <pre className="text-xs">{JSON.stringify(trace.filters_applied, null, 2)}</pre>
    </Card>
  );
}

function FreshnessSection({ trace }: { trace: SearchTrace }) {
  const f = trace.freshness;
  return (
    <Card title="Freshness check">
      <ul className="text-sm">
        <li>
          Categoría: <strong>{f.category_checked ?? "(none)"}</strong>
        </li>
        <li>Last refresh: {f.last_refreshed_at ?? "—"}</li>
        <li>Hours old: {f.hours_old !== null ? f.hours_old.toFixed(1) : "—"}</li>
      </ul>
    </Card>
  );
}

function RetrievalSection({ trace }: { trace: SearchTrace }) {
  return (
    <Card title="Retrieval (top 10)">
      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <h3 className="font-semibold mb-1">BM25</h3>
          <ol className="space-y-0.5">
            {trace.retrieval.bm25.map((r) => (
              <li key={r.id}>
                {r.rank}. {r.title} <span className="text-gray-500">({r.score.toFixed(3)})</span>
              </li>
            ))}
            {trace.retrieval.bm25.length === 0 && (
              <li>
                <em>(empty)</em>
              </li>
            )}
          </ol>
        </div>
        <div>
          <h3 className="font-semibold mb-1">Cosine</h3>
          <ol className="space-y-0.5">
            {trace.retrieval.cosine.map((r) => (
              <li key={r.id}>
                {r.rank}. {r.title} <span className="text-gray-500">({r.score.toFixed(3)})</span>
              </li>
            ))}
            {trace.retrieval.cosine.length === 0 && (
              <li>
                <em>(empty)</em>
              </li>
            )}
          </ol>
        </div>
        <div>
          <h3 className="font-semibold mb-1">RRF Fused</h3>
          <ol className="space-y-0.5">
            {trace.retrieval.fused.map((f, i) => (
              <li key={f.id}>
                {i + 1}. {f.title}{" "}
                <span className="text-gray-500">({f.rrf_score.toFixed(4)})</span>
              </li>
            ))}
            {trace.retrieval.fused.length === 0 && (
              <li>
                <em>(empty)</em>
              </li>
            )}
          </ol>
        </div>
      </div>
    </Card>
  );
}

function DecisionSection({ trace }: { trace: SearchTrace }) {
  return (
    <Card title="Decisión mock fallback">
      <ul className="text-sm">
        <li>
          Should call mock: <strong>{String(trace.decision.should_call_mock)}</strong>
        </li>
        <li>
          Razón: <code>{trace.decision.reason}</code>
        </li>
      </ul>
    </Card>
  );
}

function MockFallbackSection({ trace }: { trace: SearchTrace }) {
  const m = trace.mock_fallback;
  return (
    <Card title="Mock fallback">
      <ul className="text-sm">
        <li>
          Invocado: <strong>{String(m.invoked)}</strong>
        </li>
        {m.invoked && (
          <>
            <li>Productos recibidos: {m.products_fetched ?? 0}</li>
            <li>Procesados (enriquecidos): {m.products_processed ?? 0}</li>
            <li>Fallidos: {m.products_failed ?? 0}</li>
          </>
        )}
      </ul>
    </Card>
  );
}

function FinalSection({ trace }: { trace: SearchTrace }) {
  return (
    <Card title="Resultado final (top 10)">
      <ol className="text-sm space-y-0.5">
        {trace.final.top_10.map((p, i) => (
          <li key={p.id}>
            {i + 1}. {p.title} — ${(p.price_cents / 100).toFixed(2)}
          </li>
        ))}
        {trace.final.top_10.length === 0 && (
          <li>
            <em>(empty)</em>
          </li>
        )}
      </ol>
    </Card>
  );
}

function TimingsSection({ trace }: { trace: SearchTrace }) {
  const entries = Object.entries(trace.timings_ms)
    .filter(([, v]) => typeof v === "number")
    .sort(([, a], [, b]) => (b as number) - (a as number));
  const max = (entries[0]?.[1] as number) ?? 1;
  return (
    <Card title="Timings (ms)">
      <ul className="text-xs space-y-0.5">
        {entries.map(([k, v]) => (
          <li key={k} className="flex items-center gap-2">
            <span className="w-32 font-mono">{k}</span>
            <span className="w-12 text-right">{(v as number).toFixed(0)}</span>
            <span className="flex-1 bg-gray-200 h-2 rounded">
              <span
                className="block bg-black h-2 rounded"
                style={{ width: `${((v as number) / max) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RawJson({ trace }: { trace: SearchTrace }) {
  return (
    <Card title="Raw trace (JSON)">
      <details>
        <summary className="cursor-pointer text-sm">Mostrar JSON completo</summary>
        <pre className="text-xs overflow-auto max-h-96">{JSON.stringify(trace, null, 2)}</pre>
      </details>
    </Card>
  );
}
