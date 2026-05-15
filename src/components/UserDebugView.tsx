import type { UserDebugInfo } from "@/sectors/d-personalization/admin/user-debug";

export function UserDebugView({ info }: { info: UserDebugInfo }) {
  return (
    <section className="space-y-4">
      <Card title="Identidad">
        <dl className="grid grid-cols-2 gap-1 text-sm">
          <dt>ID:</dt>
          <dd className="font-mono text-xs">{info.user.id}</dd>
          <dt>Email:</dt>
          <dd>{info.user.email}</dd>
          <dt>Auth0 sub:</dt>
          <dd className="font-mono text-xs">{info.user.auth0_sub ?? "—"}</dd>
          <dt>Creado:</dt>
          <dd>{String(info.user.created_at)}</dd>
          <dt>Anon IDs:</dt>
          <dd className="font-mono text-xs">
            {info.anonymous_ids_merged.join(", ") || "—"}
          </dd>
        </dl>
      </Card>

      <Card title="Perfil">
        <ul className="text-sm">
          <li>Eventos totales: {info.profile.n_events_total}</li>
          <li>
            Último recompute:{" "}
            {info.profile.last_recompute_at
              ? String(info.profile.last_recompute_at)
              : "—"}
          </li>
        </ul>
      </Card>

      <Card title="Sesión activa">
        {info.active_session ? (
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt>Session ID:</dt>
            <dd className="font-mono text-xs">
              {info.active_session.session_id}
            </dd>
            <dt>Receptor actual:</dt>
            <dd>{info.active_session.current_recipient_id ?? "—"}</dd>
            <dt>Cohorte:</dt>
            <dd>{info.active_session.current_cohort_id ?? "—"}</dd>
            <dt>Signal window:</dt>
            <dd>{info.active_session.signal_window_size}</dd>
          </dl>
        ) : (
          <em>Sin sesión activa</em>
        )}
      </Card>

      <Card title={`Modos (${info.modes.length})`}>
        {info.modes.map((m) => (
          <div key={m.id} className="border-t pt-2 mt-2 text-sm">
            <div>
              <strong>{m.cohort_id}</strong>
              {m.recipient_name && ` — para ${m.recipient_name}`}
            </div>
            <div className="text-xs text-gray-600">
              n_events {m.n_events_in_mode} · weight_sum{" "}
              {m.weight_sum.toFixed(2)} · {String(m.last_assigned_at)}
            </div>
            <ol className="mt-1 ml-4 list-decimal">
              {m.top_5_products.map((p) => (
                <li key={p.id}>
                  {p.title}{" "}
                  <span className="text-gray-500">
                    ({p.similarity.toFixed(3)})
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
        {info.modes.length === 0 && <em>Sin modos creados aún</em>}
      </Card>

      <Card title={`Eventos recientes (${info.recent_events.length})`}>
        <ol className="text-xs space-y-0.5 max-h-64 overflow-auto">
          {info.recent_events.map((e, i) => (
            <li key={i}>
              <strong>{e.event_type}</strong> {String(e.occurred_at)}
            </li>
          ))}
        </ol>
      </Card>

      <Card title={`Exclusiones activas (${info.exclusions_active.length})`}>
        <ul className="text-sm">
          {info.exclusions_active.map((x) => (
            <li key={x.product_id}>
              {x.product_title} — TTL {String(x.ttl_until)}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`Feed ahora (top-${info.feed_now.length})`}>
        <ol className="text-sm space-y-0.5">
          {info.feed_now.map((p, i) => (
            <li key={p.product_id}>
              {i + 1}. {p.title}{" "}
              <span className="text-gray-500">
                ({p.similarity.toFixed(3)})
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Raw JSON">
        <details>
          <summary className="cursor-pointer text-sm">Mostrar</summary>
          <pre className="text-xs overflow-auto max-h-96">
            {JSON.stringify(info, null, 2)}
          </pre>
        </details>
      </Card>
    </section>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border rounded p-4">
      <h2 className="font-semibold mb-2">{title}</h2>
      {children}
    </div>
  );
}
