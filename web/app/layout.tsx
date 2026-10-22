import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata = {
  title: "Next Click: see exactly what to click next",
  description: "A Chrome side panel that shows beginners the next button to press, one tiny step at a time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
