import type { StatusResponse } from '@/api/status';
import { checkedProviders, statusClass, statusLabel } from '@/features/site/site-hooks';

// The provider status pill in the nav (desktop + mobile) and the footer
// indicator. Counts operational providers; titles list every provider state.
export function StatusPill({ status, mobile, label }: { status: StatusResponse | null; mobile?: boolean; label?: string }) {
  const overall = status ? statusClass(status.overall) : 'unknown';
  const count = status && Array.isArray(status.providers)
    ? `${checkedProviders(status.providers).filter((p) => p.status === 'operational').length}/${checkedProviders(status.providers).length}`
    : '–';
  const title = status && Array.isArray(status.providers)
    ? status.providers.map((p) => `${p.name}: ${statusLabel(p.status)}`).join(' · ')
    : 'Provider status';
  return (
    <a
      href="/status"
      className={`status-pill ${overall}`}
      title={title}
      style={mobile ? { width: 'max-content' } : undefined}
    >
      <span className="status-pill-dot"></span>
      {label && <span className="status-pill-label">{label}</span>}
      <span className="status-pill-count">{count}</span>
    </a>
  );
}

export function FooterStatus({ status }: { status: StatusResponse | null }) {
  const overall = status ? statusClass(status.overall) : 'unknown';
  const label = status ? statusLabel(status.overall) : 'Unknown';
  return (
    // data-boot markers: the server fills these in on the prerendered home page
    // (platform/boot-html.ts), so keep the structure fixed.
    <div className={`footer-status ${overall}`} data-boot="footer-status">
      <span className="footer-status-dot"></span> <span data-boot="footer-label">{label}</span>
    </div>
  );
}
