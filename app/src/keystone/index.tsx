// Keystone components, ported from design/keystone/components/bundle.js to typed React.
// Styling lives in keystone.css (a copy of bundle.css). Do not restyle these per page.
import type { ReactNode, ButtonHTMLAttributes, ChangeEventHandler } from "react";

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");

// 24x24 line icons, 1.75 stroke, round caps. Keystone set + FlowTwin additions (marked).
const P = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  scale: "M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  cube: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  sliders: "M6 3v6M6 13v8M12 3v10M12 17v4M18 3v4M18 11v10M4 11h4M10 15h4M16 9h4",
  bank: "M3 21h18M4 10h16M12 3l9 5H3zM6 10v8M10 10v8M14 10v8M18 10v8",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  bell: "M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  filter: "M3 6h18M7 12h10M10 18h4",
  plus: "M12 5v14M5 12h14",
  x: "M18 6 6 18M6 6l12 12",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  pencil: "M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6",
  chevron: "M9 18l6-6-6-6",
  pulse: "M22 12h-4l-3 9L9 3l-3 9H2",
  chart: "M3 3v18h18M7 16v-4M12 16V8M17 16v-7",
  // FlowTwin additions, same grid and stroke
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  leaf: "M11 20A7 7 0 0 1 4 13c0-6 7-10 16-10 0 9-4 16-10 16zM4 21c3-5 6-8 11-11",
  check: "M20 6 9 17l-5-5",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  share: "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z",
  play: "M6 4l14 8-14 8z",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  truck: "M1 4h13v12H1zM14 9h4l4 4v3h-8M5.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  sync: "M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
} as const;

export type IconName = keyof typeof P;
export const iconNames = Object.keys(P) as IconName[];

export function Icon({ name, size = 20, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  return (
    <svg className={cx("ks-icon", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" width={size} height={size}
      aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      <path d={P[name] ?? P.file} />
    </svg>
  );
}

export function Button({ variant = "primary", size = "md", icon, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary"; size?: "md" | "sm"; icon?: IconName; children: ReactNode }) {
  return (
    <button type="button" {...rest} className={cx("ks-btn", `ks-btn-${variant}`, size === "sm" && "ks-btn-sm", className)}>
      {icon && <Icon name={icon} />}{children}
    </button>
  );
}

export function IconButton({ icon, label, tone, dot, onClick, className }:
  { icon: IconName; label: string; tone?: "default" | "danger"; dot?: boolean; onClick?: () => void; className?: string }) {
  return (
    <button type="button" className={cx("ks-iconbtn", tone === "danger" && "ks-iconbtn-danger", dot && "ks-bell", className)}
      aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function FilterChip({ children, icon, onClick, onRemove, pressed }:
  { children: string; icon?: IconName; onClick?: () => void; onRemove?: () => void; pressed?: boolean }) {
  if (onRemove) {
    return (
      <span className="ks-chip" role="group" aria-label={children}>
        {icon && <Icon name={icon} />}{children}
        <button type="button" className="ks-chip-x" aria-label={`Remove filter ${children}`} onClick={onRemove}><Icon name="x" /></button>
      </span>
    );
  }
  return (
    <button type="button" className="ks-chip" onClick={onClick} aria-pressed={pressed}
      style={pressed ? { background: "var(--surface-selected)", borderColor: "var(--primary)" } : undefined}>
      {icon && <Icon name={icon} />}{children}
    </button>
  );
}

export function SearchField({ placeholder = "Search", label, value, defaultValue, onChange, width, className }:
  { placeholder?: string; label?: string; value?: string; defaultValue?: string; onChange?: ChangeEventHandler<HTMLInputElement>; width?: number | string; className?: string }) {
  return (
    <label className={cx("ks-search", className)} style={width ? { width } : undefined}>
      <Icon name="search" />
      <input type="search" placeholder={placeholder} aria-label={label ?? placeholder} value={value} defaultValue={defaultValue} onChange={onChange} />
    </label>
  );
}

export type PillTone = "action" | "fresh" | "success" | "warning" | "danger" | "neutral";
export function StatusPill({ tone = "neutral", onClick, children }: { tone?: PillTone; onClick?: () => void; children: ReactNode }) {
  if (tone === "action") return <button type="button" className="ks-pill ks-pill-action" onClick={onClick}>{children}</button>;
  return <span className={cx("ks-pill", `ks-pill-${tone}`)}>{children}</span>;
}

export function Count({ children }: { children: ReactNode }) {
  return <span className="ks-count">{children}</span>;
}

export function Breadcrumb({ items, icon = "home" }: { items: { label: string; onClick?: () => void }[]; icon?: IconName | false }) {
  return (
    <nav className="ks-crumbs" aria-label="Breadcrumb">
      {icon !== false && <span className="ks-home"><Icon name={icon} /></span>}
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} style={{ display: "contents" }}>
            {(i > 0 || icon !== false) && <span className="ks-sep" aria-hidden="true"><Icon name="chevron" size={16} /></span>}
            {last ? <span aria-current="page">{it.label}</span>
              : <a href="#" onClick={(e) => { e.preventDefault(); it.onClick?.(); }}>{it.label}</a>}
          </span>
        );
      })}
    </nav>
  );
}

export interface RailItem { id: string; label: string; icon: IconName }
export function NavRail({ items, current, monogram = "F", brand = "FlowTwin", onSelect, footer }:
  { items: RailItem[]; current?: string; monogram?: string; brand?: string; onSelect: (id: string) => void; footer?: ReactNode }) {
  return (
    <aside className="ks-rail">
      <div className="ks-rail-logo" aria-label={brand}>{monogram}</div>
      <nav aria-label="Modules">
        {items.map((it) => (
          <a key={it.id} href={`#${it.id}`} aria-current={it.id === current ? "page" : undefined}
            onClick={(e) => { e.preventDefault(); onSelect(it.id); }}>
            <Icon name={it.icon} size={24} />{it.label}
          </a>
        ))}
        {footer}
      </nav>
    </aside>
  );
}

export interface SubNavItem { id: string; label: string; icon?: IconName; count?: number }
export function SubNav({ items, current, brand, label = "Section", onSelect, children }:
  { items: SubNavItem[]; current?: string; brand?: [string, string]; label?: string; onSelect?: (id: string) => void; children?: ReactNode }) {
  const plain = items.some((i) => i.icon);
  return (
    <nav className={cx("ks-subnav", plain && "ks-subnav-plain")} aria-label={label}>
      {brand && <div className="ks-subnav-brand">{brand[0]} <b>{brand[1]}</b></div>}
      {items.map((it) => (
        <a key={it.id} href={`#${it.id}`} aria-current={it.id === current ? "page" : undefined}
          onClick={(e) => { e.preventDefault(); onSelect?.(it.id); }}>
          {it.icon && <Icon name={it.icon} />}{it.label}{it.count != null && <span className="ks-count">{it.count}</span>}
        </a>
      ))}
      {children}
    </nav>
  );
}

export interface Column<T> { key: string; label: string; numeric?: boolean; align?: "left" | "center" | "right"; render?: (row: T, index: number) => ReactNode }
export function DataTable<T extends { id?: string | number }>({ columns, rows, footer, caption }:
  { columns: Column<T>[]; rows: T[]; footer?: ReactNode; caption?: string }) {
  return (
    <div className="ks-table-card">
      <div className="ks-table-scroll">
        <table className="ks-table">
          {caption && <caption className="ft-sr-only">{caption}</caption>}
          <thead><tr>{columns.map((c) => <th key={c.key} style={c.align ? { textAlign: c.align } : undefined}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.id ?? ri}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? "ks-num" : undefined} style={c.align ? { textAlign: c.align } : undefined}>
                    {c.render ? c.render(r, ri) : String((r as Record<string, unknown>)[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && <div className="ks-table-foot">{footer}</div>}
    </div>
  );
}

export function Pagination({ page, total, onChange }: { page: number; total: number; onChange?: (p: number) => void }) {
  return (
    <div className="ks-pager">
      <button type="button" disabled={page <= 1} onClick={() => onChange?.(page - 1)}>Previous</button>
      <span aria-live="polite">Page {page} of {total}</span>
      <button type="button" disabled={page >= total} onClick={() => onChange?.(page + 1)}>Next</button>
    </div>
  );
}

export function StatCard({ label, value, icon, tone, delta }:
  { label: string; value: ReactNode; icon?: IconName; tone?: "default" | "accent"; delta?: { value: string; direction: "up" | "down"; good?: boolean; caption?: string } }) {
  // `good` decides the colour; direction decides the glyph. Defaults to up = good.
  const good = delta?.good ?? delta?.direction === "up";
  return (
    <div className={cx("ks-stat", tone === "accent" && "ks-stat-accent")}>
      <div className="ks-stat-label">{label}{icon && <Icon name={icon} />}</div>
      <div className="ks-stat-value">{value}</div>
      {delta && (
        <div className={cx("ks-stat-delta", good ? "ks-up" : "ks-down")}>
          {delta.direction === "down" ? "▼ " : "▲ "}{delta.value}{delta.caption && <span>{delta.caption}</span>}
        </div>
      )}
    </div>
  );
}

export function UserChip({ name, email }: { name: string; email?: string }) {
  const initials = name.split(" ").map((s) => s[0]).slice(0, 2).join("");
  return (
    <div className="ks-user">
      <span className="ks-avatar" aria-hidden="true">{initials}</span>
      <div><div className="ks-user-name">{name}</div>{email && <div className="ks-user-mail">{email}</div>}</div>
    </div>
  );
}
