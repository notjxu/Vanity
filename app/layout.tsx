import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Vanity',
  description: 'Engineered compression — Bahrain',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="bg-black text-white">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}