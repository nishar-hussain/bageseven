import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bagseven — Access, on your terms',
  description:
    'Plans, credits and agent access, connected on Avalanche. Bring checkout, subscriptions and customer entitlements into your app with one Bagseven embed.',
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
