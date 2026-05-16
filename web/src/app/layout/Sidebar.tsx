import type { ReactNode } from "react";

export type SidebarProps = {
  children?: ReactNode;
};

export function Sidebar({ children }: SidebarProps) {
  return <>{children}</>;
}
