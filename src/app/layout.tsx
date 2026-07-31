import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trial Match',
  description: 'Clinical trial matching for EHR workflows',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
