import type {Metadata, Viewport} from 'next';
import type {ReactNode} from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vega Support Console',
  description:
    'The admin side of the Vega support chat — every conversation, the online users, and the announcements.',
  robots: {index: false, follow: false},
};

export const viewport: Viewport = {
  themeColor: '#07070D',
  width: 'device-width',
  initialScale: 1,
};

const RootLayout = ({children}: {children: ReactNode}) => (
  <html lang="en">
    <body className="min-h-screen bg-base antialiased">{children}</body>
  </html>
);

export default RootLayout;
