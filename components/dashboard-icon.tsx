import React, { type ReactNode } from "react";

const paths = {
  home: <><path d="m3 10 9-7 9 7M5 9v11h14V9"/><path d="M10 20v-6h4v6"/></>,
  alert: <><path d="M12 4 2.8 20h18.4L12 4Z"/><path d="M12 10v4m0 3h.01"/></>,
  nearby: <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  locate: <><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
  map: <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  collapse: <path d="m14 6-6 6 6 6"/>,
  expand: <path d="m10 6 6 6-6 6"/>,
  bus: <><rect x="4" y="3" width="16" height="16" rx="3"/><path d="M4 12h16M8 19v2m8-2v2m-8-5h.01m8 0h.01"/></>,
  train: <><rect x="5" y="3" width="14" height="15" rx="4"/><path d="M5 11h14m-7-8v8M9 15h.01m6 0h.01M9 18l-3 3m9-3 3 3"/></>,
  bike: <><circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17 10 9l4 8H5.5m13 0-3-10H19M8 9h4"/></>,
} satisfies Record<string, ReactNode>;

export default function DashboardIcon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
