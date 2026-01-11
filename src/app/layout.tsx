import "./globals.css";

export const metadata = {
  title: "Monkeys dashboard",
  description: "Monkeys dashboard — stats LoL pour les potes (Riot API + SQL)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
