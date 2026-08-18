"use client";

import type { CSSProperties, FC, ReactNode, SVGProps } from "react";

type IconProps = {
  size?: number;
  className?: string;
  title?: string;
};

type IconComponent = FC<IconProps>;

const baseSvgProps = (
  size: number,
  className?: string,
  title?: string,
): SVGProps<SVGSVGElement> & { style: CSSProperties } => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  xmlns: "http://www.w3.org/2000/svg",
  "aria-hidden": title ? undefined : true,
  role: title ? "img" : undefined,
  className,
  style: { display: "block", flexShrink: 0 },
});

const gradId = (s: string) => `tg-${s}`;

const Defs: FC<{ id: string; children: ReactNode }> = ({ id, children }) => (
  <defs>{children}</defs>
);

export const StrkIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <Defs id={gradId("strk")}>
      <linearGradient id={gradId("strk")} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#7B61FF" />
        <stop offset="1" stopColor="#21D4FD" />
      </linearGradient>
    </Defs>
    <circle cx="12" cy="12" r="11" fill={`url(#${gradId("strk")})`} />
    <path
      d="M7 9.5c0-1.4 1.3-2.5 3-2.5h3c1.4 0 2.5 1 2.5 2.2 0 1.1-.8 1.8-1.9 2.1l-2.6.7c-1.2.3-2 1.1-2 2.3 0 1.4 1.2 2.4 2.8 2.4h3.2c1.7 0 3-1.1 3-2.5"
      fill="none"
      stroke="#fff"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const EthIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <circle cx="12" cy="12" r="11" fill="#1F1F23" />
    <g fill="#9DA3AD">
      <path d="M12 4 L16.6 12 L12 14.2 L7.4 12 Z" />
      <path d="M12 15 L16.6 12.8 L12 21 L7.4 12.8 Z" opacity="0.85" />
    </g>
    <path d="M12 4 L7.4 12 L12 14.2 L16.6 12 Z" fill="#FFFFFF" opacity="0.12" />
  </svg>
);

export const UsdcIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <Defs id={gradId("usdc")}>
      <linearGradient id={gradId("usdc")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2775CA" />
        <stop offset="1" stopColor="#1F5FA6" />
      </linearGradient>
    </Defs>
    <circle cx="12" cy="12" r="11" fill={`url(#${gradId("usdc")})`} />
    <g fill="#fff">
      <path d="M12 6.5c.6 0 1 .4 1 1v.6c1.6.3 2.7 1.4 2.8 3h-1.5c-.1-1-.7-1.7-2.3-1.7-1.4 0-2.1.6-2.1 1.4 0 .8.6 1.2 1.9 1.4l1 .2c1.9.4 3.2 1.1 3.2 2.9 0 1.6-1.2 2.7-3 3v.7c0 .6-.4 1-1 1s-1-.4-1-1v-.7c-1.9-.3-3-1.4-3.1-3.1h1.5c.1 1.1.8 1.8 2.6 1.8 1.5 0 2.4-.5 2.4-1.5 0-.9-.7-1.3-2.1-1.5l-1-.2c-1.8-.4-3-1.1-3-2.8 0-1.5 1.1-2.6 2.7-2.9v-.6c0-.6.4-1 1-1Z" />
    </g>
  </svg>
);

export const UsdtIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <Defs id={gradId("usdt")}>
      <linearGradient id={gradId("usdt")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#26A17B" />
        <stop offset="1" stopColor="#0E7A5C" />
      </linearGradient>
    </Defs>
    <circle cx="12" cy="12" r="11" fill={`url(#${gradId("usdt")})`} />
    <path
      d="M10.5 5.5h5v2.2h-1.7V18h-1.7V7.7h-1.6z"
      fill="#fff"
    />
    <path
      d="M7.8 11.6h8.4v1.6H7.8z"
      fill="#fff"
    />
  </svg>
);

export const DaiIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <Defs id={gradId("dai")}>
      <linearGradient id={gradId("dai")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#F5AC37" />
        <stop offset="1" stopColor="#D9871E" />
      </linearGradient>
    </Defs>
    <circle cx="12" cy="12" r="11" fill={`url(#${gradId("dai")})`} />
    <path
      d="M8.5 5.5h3.4c3.6 0 5.7 2.2 5.7 6.5s-2.1 6.5-5.7 6.5H8.5Zm2.4 2v9h1c2.2 0 3.4-1.5 3.4-4.5S14.1 7.5 11.9 7.5Z"
      fill="#fff"
    />
  </svg>
);

export const WbtcIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <Defs id={gradId("wbtc")}>
      <linearGradient id={gradId("wbtc")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#F2A900" />
        <stop offset="1" stopColor="#C77A00" />
      </linearGradient>
    </Defs>
    <circle cx="12" cy="12" r="11" fill={`url(#${gradId("wbtc")})`} />
    <g fill="#fff">
      <path d="M14.6 11.6c.4-.5.6-1.1.6-1.8 0-1.7-1.3-2.8-3.4-2.8h-3v11h3.4c2.2 0 3.6-1.1 3.6-3 0-1.2-.6-2-1.6-2.5.2-.3.3-.5.4-.9Zm-3.7-3c.9 0 1.5.5 1.5 1.3s-.6 1.3-1.5 1.3H10.5V8.6Zm.3 7.4h-1.3v-2.9h1.4c1 0 1.6.5 1.6 1.4s-.7 1.5-1.7 1.5Z" />
      <path d="M12.7 5.5h-1.4l-.7-1.5h1l.4.9.4-.9h1l-.7 1.5Zm-1.4 13h1.4l.7 1.5h-1l-.4-.9-.4.9h-1l.7-1.5Z" />
    </g>
  </svg>
);

export const WstEthIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <Defs id={gradId("wsteth")}>
      <linearGradient id={gradId("wsteth")} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#4E5BFF" />
        <stop offset="1" stopColor="#7B3FF6" />
      </linearGradient>
    </Defs>
    <circle cx="12" cy="12" r="11" fill={`url(#${gradId("wsteth")})`} />
    <g fill="#fff">
      <path d="M12 5 L15.6 11.5 L12 13.4 L8.4 11.5 Z" opacity="0.95" />
      <path d="M12 14 L15.6 12.2 L12 19 L8.4 12.2 Z" opacity="0.7" />
    </g>
    <text
      x="12"
      y="22.3"
      textAnchor="middle"
      fontFamily="Inter, system-ui, sans-serif"
      fontWeight="800"
      fontSize="4.2"
      fill="#fff"
      letterSpacing="0.2"
    >
      wst
    </text>
  </svg>
);

export const XstrkIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <Defs id={gradId("xstrk")}>
      <linearGradient id={gradId("xstrk")} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#1BC982" />
        <stop offset="1" stopColor="#0E8C5A" />
      </linearGradient>
    </Defs>
    <circle cx="12" cy="12" r="11" fill={`url(#${gradId("xstrk")})`} />
    <text
      x="12"
      y="15.5"
      textAnchor="middle"
      fontFamily="Inter, system-ui, sans-serif"
      fontWeight="900"
      fontSize="11"
      fill="#fff"
      letterSpacing="-0.3"
    >
      x
    </text>
    <path
      d="M8 9c0-1.4 1-2.4 2.5-2.4h2.6c1.3 0 2.4.9 2.4 2.1 0 1-.7 1.7-1.8 2l-1.8.4c-1 .2-1.6.8-1.6 1.7 0 1.1.9 1.9 2.2 1.9h2.5"
      fill="none"
      stroke="#fff"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.0"
    />
  </svg>
);

export const LordsIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <Defs id={gradId("lords")}>
      <linearGradient id={gradId("lords")} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#7B61FF" />
        <stop offset="1" stopColor="#4B2BAB" />
      </linearGradient>
    </Defs>
    <circle cx="12" cy="12" r="11" fill={`url(#${gradId("lords")})`} />
    <path
      d="M6 9.2 8.5 7 12 8.5 15.5 7 18 9.2V12l-1.5.8V17l-1.7 1-1.8-1v-2.4L12 15.4l-1-.6V17l-1.8 1-1.7-1v-4.2L6 12Z"
      fill="#fff"
      opacity="0.95"
    />
    <circle cx="12" cy="11.7" r="1.1" fill="#7B61FF" />
  </svg>
);

export const EkuboIcon: IconComponent = ({ size = 22, className, title }) => (
  <svg {...baseSvgProps(size, className, title)}>
    {title ? <title>{title}</title> : null}
    <Defs id={gradId("ekubo")}>
      <linearGradient id={gradId("ekubo")} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#21D4FD" />
        <stop offset="1" stopColor="#0066FF" />
      </linearGradient>
    </Defs>
    <circle cx="12" cy="12" r="11" fill={`url(#${gradId("ekubo")})`} />
    <path
      d="M12 4.5c4.1 0 7.5 3.4 7.5 7.5 0 1.6-.5 3.1-1.4 4.3"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M5.4 16.4C4.6 15.1 4.1 13.7 4.1 12c0-4.1 3.4-7.5 7.5-7.5"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.7"
    />
    <circle cx="12" cy="12" r="2.4" fill="#fff" />
  </svg>
);

export const GenericIcon: IconComponent = ({ size = 22, className, title }) => {
  const letter = (title ?? "?").charAt(0).toUpperCase();
  return (
    <svg {...baseSvgProps(size, className, title ?? letter)}>
      <title>{title ?? letter}</title>
      <Defs id={gradId("generic")}>
        <linearGradient id={gradId("generic")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7B61FF" />
          <stop offset="1" stopColor="#21D4FD" />
        </linearGradient>
      </Defs>
      <circle cx="12" cy="12" r="11" fill={`url(#${gradId("generic")})`} />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="900"
        fontSize="12"
        fill="#fff"
      >
        {letter}
      </text>
    </svg>
  );
};

const TOKEN_ICONS: Record<string, IconComponent> = {
  STRK: StrkIcon,
  ETH: EthIcon,
  USDC: UsdcIcon,
  USDT: UsdtIcon,
  DAI: DaiIcon,
  WBTC: WbtcIcon,
  wstETH: WstEthIcon,
  XSTRK: XstrkIcon,
  LORDS: LordsIcon,
  EKUBO: EkuboIcon,
};

export function tokenIcon(symbol: string): IconComponent {
  if (!symbol) return GenericIcon;
  const key = symbol.toUpperCase();
  return TOKEN_ICONS[key] ?? GenericIcon;
}

export const ALL_TOKEN_ICONS: Record<string, IconComponent> = TOKEN_ICONS;