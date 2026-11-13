import type { Metadata } from 'next';
import { ThemeProvider } from '../components/theme-provider';
import { WalletProviders } from '../components/wallet/WalletProviders';
import { Toaster } from '../components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bagseven',
  description:
    'Manage plans, customer access, prepaid credits and bounded agent spending on Avalanche.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Chivo+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <WalletProviders>
            {children}
            <Toaster />
          </WalletProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
