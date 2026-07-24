import Link from "next/link";
import type { ReactNode } from "react";

type AdminTone = "accent" | "success" | "warning" | "danger" | "muted";

export function AdminPageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="admin-page-head">
      <div>
        {backHref && backLabel ? (
          <Link href={backHref} className="admin-link text-sm font-semibold">
            {backLabel}
          </Link>
        ) : null}
        <h1 className={`admin-page-title${backHref ? " mt-2" : ""}`}>{title}</h1>
        {description ? <p className="admin-page-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

export function AdminStatCard({
  label,
  value,
  meta,
  metaTone,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  metaTone?: "success" | "danger";
}) {
  const metaStyle = metaTone ? { color: `var(--admin-${metaTone})` } : undefined;

  return (
    <div className="admin-stat-card">
      <p className="admin-stat-label">{label}</p>
      <p className="admin-stat-value">{value}</p>
      {meta ? (
        <p className="admin-stat-meta" style={metaStyle}>{meta}</p>
      ) : null}
    </div>
  );
}

export function AdminCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`admin-card${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function AdminCardHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="admin-card-head">
      <div>
        <h2 className="admin-card-title">{title}</h2>
        {description ? <p className="admin-card-copy">{description}</p> : null}
      </div>
      {aside}
    </div>
  );
}

export function AdminCardBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`admin-card-body${className ? ` ${className}` : ""}`}>{children}</div>;
}

export function AdminAvatar({ label }: { label: string }) {
  return <div className="admin-avatar">{label.slice(0, 1) || "U"}</div>;
}

export function AdminChip({
  tone,
  children,
}: {
  tone: AdminTone;
  children: ReactNode;
}) {
  return <span className={`admin-chip admin-chip--${tone}`}>{children}</span>;
}

export function AdminTableEmptyRow({
  colSpan,
  title,
  description,
  action,
}: {
  colSpan: number;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="admin-empty" role="status">
          <p className="admin-empty-title">{title}</p>
          {description ? <p className="admin-empty-description">{description}</p> : null}
          {action ? <div className="mt-4">{action}</div> : null}
        </div>
      </td>
    </tr>
  );
}

export function AdminPager({
  totalLabel,
  previousHref,
  nextHref,
}: {
  totalLabel: string;
  previousHref?: string | null;
  nextHref?: string | null;
}) {
  return (
    <div className="admin-pager">
      <p className="text-sm text-[color:var(--admin-text-2)]">{totalLabel}</p>
      <div className="flex gap-2">
        {previousHref ? (
          <Link href={previousHref} className="admin-button admin-button--ghost">
            上一页
          </Link>
        ) : null}
        {nextHref ? (
          <Link href={nextHref} className="admin-button admin-button--ghost">
            下一页
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function AdminKeyValue({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="admin-detail-row">
      <p className="admin-detail-label">{label}</p>
      <div className="admin-detail-value">{value}</div>
    </div>
  );
}
