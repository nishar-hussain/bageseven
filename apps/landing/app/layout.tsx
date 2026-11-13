import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bagseven — Agents spend under a mandate',
  description:
    'Humans mint a public, expiring entitlement on Registry. Money settles on Avalanche. Unique humans via email and wallet. SDK + MCP is the product.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chivo+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <style>{`
          @font-face {
            font-family: 'Switzer';
            font-style: normal;
            font-weight: 400 700;
            font-display: swap;
            src: local('Switzer'), local('Inter');
          }
        `}</style>
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
