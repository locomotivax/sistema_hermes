import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fluxo · Rio Pequeno × Corifeu",
  description:
    "Pesquisa reproduzível de demanda multimodal e cenários residenciais até 2036.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
