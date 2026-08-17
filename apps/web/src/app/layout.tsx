import type { Metadata } from 'next'
import { Inter, Space_Mono } from 'next/font/google'
import './globals.css'

// Clean neutral grotesque for everything (matches the Uniswap reference); a mono
// only for hex addresses / hashes.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})
const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono-ui',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'GameShield · Private Gaming Bounty Hub',
  description:
    'Shield prize pools and pay winners through the STRK20 privacy pool — unlinkable gaming bounties on Starknet',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceMono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  )
}
