import type { ReactNode } from "react";

function Svg({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function Logo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#111111" stroke="rgba(255,255,255,0.1)" />
      <path
        d="M16 16 9 9.5M16 16l7-6.5M16 16v9.5"
        stroke="#E8B84A"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="16" cy="16" r="3.4" fill="#E8B84A" />
      <circle cx="9" cy="9.5" r="2.4" fill="none" stroke="#E8B84A" strokeWidth="1.6" />
      <circle cx="23" cy="9.5" r="2.4" fill="none" stroke="#E8B84A" strokeWidth="1.6" />
      <circle cx="16" cy="25.5" r="2.4" fill="none" stroke="#E8B84A" strokeWidth="1.6" />
    </svg>
  );
}

export function IconPulse({ className = "" }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M2 8h3l1.5-4 3 8L11 8h3" />
    </Svg>
  );
}

export function IconChart({ className = "" }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 13V8M8 13V4M12 13v-3" />
    </Svg>
  );
}

export function IconList({ className = "" }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M6 4.5h7M6 8h7M6 11.5h4.5" />
      <path d="M3 4.5h.01M3 8h.01M3 11.5h.01" strokeWidth="2" />
    </Svg>
  );
}

export function IconAgents({ className = "" }: { className?: string }) {
  return (
    <Svg className={className}>
      <circle cx="5.5" cy="5" r="2.2" />
      <path d="M1.8 13.2c.4-2 1.8-3.2 3.7-3.2s3.3 1.2 3.7 3.2" />
      <circle cx="11.6" cy="5.8" r="1.7" />
      <path d="M10.7 8.6c1.8.1 3 1.2 3.4 3" />
    </Svg>
  );
}

export function IconFile({ className = "" }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
    </Svg>
  );
}

export function IconAlert({ className = "" }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M8 2 14.2 13H1.8z" />
      <path d="M8 6.2v3.3" />
      <path d="M8 11.4h.01" strokeWidth="2" />
    </Svg>
  );
}

export function IconSwap({ className = "" }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M2 5h9l-2.5-2.5M14 11H5l2.5 2.5" />
    </Svg>
  );
}

export function IconPlus({ className = "" }: { className?: string }) {
  return (
    <Svg className={className}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  );
}
