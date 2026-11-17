import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-muted md:flex-row">
        <Logo size={22} />
        <p>© 2026 Rehber. Your customers&apos; guide.</p>
      </div>
    </footer>
  );
}
