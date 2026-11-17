import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="container-wide flex flex-col items-center justify-between gap-4 py-12 text-base text-muted md:flex-row">
        <Logo size={34} />
        <p>© 2026 Rehber. Your customers&apos; guide.</p>
      </div>
    </footer>
  );
}
