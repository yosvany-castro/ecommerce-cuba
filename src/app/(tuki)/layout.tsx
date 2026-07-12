import { ToastProvider } from "@/components/tuki/Toast";
import { TukiCartProvider } from "@/components/tuki/cart";
import { Shell } from "@/components/tuki/Shell";
import { NavProgress } from "@/components/tuki/NavProgress";

export default function TukiLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#FAFAF8", color: "#1C1D20", fontFamily: "var(--font-sans)" }}>
      <NavProgress />
      <ToastProvider>
        <TukiCartProvider>
          <Shell>{children}</Shell>
        </TukiCartProvider>
      </ToastProvider>
    </div>
  );
}
