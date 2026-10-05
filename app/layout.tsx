import type { Metadata } from 'next';
import './globals.css';
import './vanor.css';

export const metadata: Metadata = {
  title: 'Vanor BD',
  description: 'Shared relationship review and business development board for Vanor Advisory.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
