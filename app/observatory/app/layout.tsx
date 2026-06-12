import type { ReactNode } from "react";
import { Agentation } from "agentation";

export const metadata = {
  title: "The Observatory",
  description: "Gate design, consumption gradients, and agent moves — visible, rehearsable, decidable.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0f" }}>
        {children}
        {process.env.NODE_ENV === "development" && <Agentation />}
      </body>
    </html>
  );
}
