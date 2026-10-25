export function Logo({ className = "", hideTextOnMobile = false }: { className?: string; hideTextOnMobile?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6 text-up" fill="currentColor" aria-hidden>
        <path d="M3 17l5-6 4 4 7-9 2 1.5-9 11.5-4-4-3.5 4.2z" />
      </svg>
      <span className={hideTextOnMobile ? "hidden sm:inline" : ""}>Mock Trader</span>
    </span>
  );
}
