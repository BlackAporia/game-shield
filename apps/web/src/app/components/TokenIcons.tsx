"use client";

import type { FC } from "react";

type IconProps = {
  size?: number;
  className?: string;
  title?: string;
};

type IconComponent = FC<IconProps>;

const imgStyle = { display: "block", borderRadius: "50%" } as const;

const make = (file: string, symbol: string): IconComponent => {
  const Img: IconComponent = ({ size = 22, className, title }) => (
    <img
      src={`/tokens/${file}`}
      alt={title ?? symbol}
      width={size}
      height={size}
      className={className}
      style={imgStyle}
    />
  );
  return Img;
};

export const StrkIcon = make("strk.png", "STRK");
export const EthIcon = make("eth.png", "ETH");
export const UsdcIcon = make("usdc.png", "USDC");
export const UsdtIcon = make("usdt.png", "USDT");
export const DaiIcon = make("dai.png", "DAI");
export const WbtcIcon = make("wbtc.png", "WBTC");
export const WstEthIcon = make("wsteth.png", "wstETH");
export const XstrkIcon = make("xstrk.png", "xSTRK");
export const LordsIcon = make("lords.png", "LORDS");
export const EkuboIcon = make("ekubo.svg", "EKUBO");

const FALLBACK_COLORS = [
  "#7B61FF",
  "#21D4FD",
  "#F5AC37",
  "#26A17B",
  "#E64A4A",
  "#9DA3AD",
];

const hashColor = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
};

export const GenericIcon: IconComponent = ({ size = 22, className, title }) => {
  const label = title && title.length > 0 ? title : "?";
  const letter = label.charAt(0).toUpperCase();
  const bg = hashColor(label);
  return (
    <div
      role="img"
      aria-label={label}
      className={className}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        backgroundColor: bg,
        color: "#fff",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 800,
        fontSize: Math.max(10, Math.round(size * 0.55)),
        lineHeight: 1,
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
};

const TOKEN_ICONS: Record<string, IconComponent> = {
  STRK: StrkIcon,
  ETH: EthIcon,
  USDC: UsdcIcon,
  USDT: UsdtIcon,
  DAI: DaiIcon,
  WBTC: WbtcIcon,
  WSTETH: WstEthIcon,
  XSTRK: XstrkIcon,
  LORDS: LordsIcon,
  EKUBO: EkuboIcon,
};

export function tokenIcon(symbol: string): IconComponent {
  if (!symbol) return GenericIcon;
  const upper = symbol.toUpperCase();
  if (TOKEN_ICONS[upper]) return TOKEN_ICONS[upper];
  if (TOKEN_ICONS[symbol]) return TOKEN_ICONS[symbol];
  return GenericIcon;
}

export const ALL_TOKEN_ICONS: Record<string, IconComponent> = TOKEN_ICONS;
