/** Chat bubble with a phone handset, drawn in the same stroke style as the lucide icons. */
export function WhatsAppIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3.5 20.5 4.8 16.4A8.8 8.8 0 1 1 8 19.3Z" />
      <path d="M9 8.6c0 3.4 3 6.4 6.4 6.4l1.1-1.6-1.9-1-1 .9a5 5 0 0 1-2.9-2.9l.9-1-1-1.9Z" strokeWidth={1.6} />
    </svg>
  );
}
