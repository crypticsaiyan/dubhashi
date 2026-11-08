import type { ReactNode } from "react";

function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Two speech bubbles in different scripts. */
export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="logo">
      <path d="M6 9a5 5 0 0 1 5-5h16a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H15l-6 5v-5.4A5 5 0 0 1 6 19z" fill="var(--primary)" />
      <path d="M42 24a5 5 0 0 0-5-5H21a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h12l6 5v-5.4a5 5 0 0 0 3-4.6z" fill="var(--accent)" />
      <text x="19" y="19.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--primary-ink)">अ</text>
      <text x="29" y="34.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">அ</text>
    </svg>
  );
}

export const MicIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
  </Icon>
);

export const SpeakerIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
  </Icon>
);

export const ReplayIcon = () => (
  <Icon size={18}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon size={18}>
    <path d="m5 12 5 5 9-10" />
  </Icon>
);

export const ArrowIcon = () => (
  <Icon size={18}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const EndIcon = () => (
  <Icon size={18}>
    <path d="M3 15.5c5-4.7 13-4.7 18 0l-2.4 2.4-3.6-1.6v-2.8a11 11 0 0 0-6 0v2.8l-3.6 1.6z" />
  </Icon>
);

export const ShareIcon = () => (
  <Icon size={18}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </Icon>
);

export const SaveIcon = () => (
  <Icon size={18}>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </Icon>
);

export const CameraIcon = ({ off = false }: { off?: boolean }) => (
  <Icon size={22}>
    <rect x="2" y="6" width="14" height="12" rx="2" />
    <path d="m16 10 6-3v10l-6-3" />
    {off && <path d="M3 3l18 18" />}
  </Icon>
);

export const KeyboardIcon = () => (
  <Icon size={22}>
    <rect x="2" y="5" width="20" height="14" rx="2" />
    <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M10 13h4M7 16h10" />
  </Icon>
);

export const SendIcon = () => (
  <Icon size={20}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
  </Icon>
);

export const RELATIONSHIP_ICONS: Record<string, ReactNode> = {
  doctor: (
    <Icon>
      <path d="M6 3v6a5 5 0 0 0 10 0V3" />
      <path d="M11 14v2a5 5 0 0 0 10 0v-2" />
      <circle cx="21" cy="12" r="2" />
    </Icon>
  ),
  elder: (
    <Icon>
      <circle cx="10" cy="5" r="2.5" />
      <path d="M10 8v6l-3 7M10 14l3 7M7 11h6l3-1M18 10v11" />
    </Icon>
  ),
  employer: (
    <Icon>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
    </Icon>
  ),
  friend: (
    <Icon>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M2 20a6 6 0 0 1 12 0M14 20a4.5 4.5 0 0 1 8 0" />
    </Icon>
  ),
};
