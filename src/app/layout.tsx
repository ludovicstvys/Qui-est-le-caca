import "./globals.css";

export const metadata = {
  title: "LoL Friends",
  description: "Dashboard League of Legends pour tes potes (Riot API + SQL)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
