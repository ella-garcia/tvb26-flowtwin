// Keystone — component props (documentation; window.Keystone.*)
import * as React from "react";

export type IconName = "home" | "file" | "map" | "scale" | "gear" | "cube" | "sliders" | "bank" | "users" | "logout" | "bell" | "search" | "filter" | "plus" | "x" | "eye" | "pencil" | "download" | "trash" | "chevron" | "pulse" | "chart";

export interface IconProps { name: IconName; size?: number; label?: string; className?: string; }
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: "primary" | "secondary"; size?: "md" | "sm"; icon?: IconName; children: React.ReactNode; }
export interface IconButtonProps { icon: IconName; label: string; tone?: "default" | "danger"; dot?: boolean; onClick?: () => void; className?: string; }
export interface FilterChipProps { children: string; icon?: IconName; onClick?: () => void; onRemove?: () => void; }
export interface SearchFieldProps { placeholder?: string; label?: string; value?: string; defaultValue?: string; onChange?: React.ChangeEventHandler<HTMLInputElement>; width?: number | string; className?: string; }
export interface StatusPillProps { tone?: "action" | "fresh" | "success" | "warning" | "danger" | "neutral"; onClick?: () => void; children: React.ReactNode; }
export interface BreadcrumbItem { label: string; href?: string; }
export interface BreadcrumbProps { items: BreadcrumbItem[]; icon?: IconName | false; }
export interface RailItem { id: string; label: string; icon: IconName; href?: string; }
export interface NavRailProps { items: RailItem[]; current?: string; monogram?: string; brand?: string; footer?: { label: string; icon?: IconName; href?: string }; }
export interface SubNavItem { id: string; label: string; icon?: IconName; count?: number; href?: string; }
export interface SubNavProps { items: SubNavItem[]; current?: string; brand?: [string, string]; label?: string; }
export interface Column<T = any> { key: string; label: string; numeric?: boolean; align?: "left" | "center" | "right"; render?: (row: T, index: number) => React.ReactNode; }
export interface DataTableProps<T = any> { columns: Column<T>[]; rows: T[]; footer?: React.ReactNode; }
export interface PaginationProps { page: number; total: number; onChange?: (page: number) => void; prevLabel?: string; nextLabel?: string; pageLabel?: string; ofLabel?: string; }
export interface StatCardProps { label: string; value: React.ReactNode; icon?: IconName; tone?: "default" | "accent"; delta?: { value: string; direction: "up" | "down"; caption?: string }; }
export interface UserChipProps { name: string; email?: string; avatar?: string; }

export declare function Icon(p: IconProps): JSX.Element;
export declare function Button(p: ButtonProps): JSX.Element;
export declare function IconButton(p: IconButtonProps): JSX.Element;
export declare function FilterChip(p: FilterChipProps): JSX.Element;
export declare function SearchField(p: SearchFieldProps): JSX.Element;
export declare function StatusPill(p: StatusPillProps): JSX.Element;
export declare function Breadcrumb(p: BreadcrumbProps): JSX.Element;
export declare function NavRail(p: NavRailProps): JSX.Element;
export declare function SubNav(p: SubNavProps): JSX.Element;
export declare function DataTable<T>(p: DataTableProps<T>): JSX.Element;
export declare function Pagination(p: PaginationProps): JSX.Element;
export declare function StatCard(p: StatCardProps): JSX.Element;
export declare function UserChip(p: UserChipProps): JSX.Element;
