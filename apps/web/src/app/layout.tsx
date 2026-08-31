import type { Metadata } from 'next'
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import AppChrome from './components/layout/AppChrome'

// Matches starknet-gaming.com: Inter for UI, Space Grotesk for display,
// JetBrains Mono for addresses / hashes.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})
const grotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
  display: 'swap',
})
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-ui',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'GameShield · STRK20 Gaming Bounty Hub',
  description:
    'Create gaming campaigns, assign multiple reward slots, and pay winners directly on Starknet with STRK20 funding.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${grotesk.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body><AppChrome>{children}</AppChrome></body>
    </html>
  )
}
