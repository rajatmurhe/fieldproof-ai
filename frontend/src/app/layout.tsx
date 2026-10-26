import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: "--font-plex-condensed",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FieldProof AI — Field-Service Video QA",
  description:
    "AI-powered video quality assurance for field-service operations. Analyze technician completion videos with Gemini agentic video understanding.",
};

// Clerk's sign-in, organisation switcher and user menu, restyled to match the docket.
const clerkAppearance = {
  variables: {
    colorPrimary: "#17160f",
    colorPrimaryForeground: "#fbfaf5",
    colorForeground: "#17160f",
    colorMutedForeground: "#4a473d",
    colorBackground: "#fbfaf5",
    colorInput: "#fbfaf5",
    colorInputForeground: "#17160f",
    colorBorder: "#d9d4c4",
    colorRing: "#e2531b",
    colorDanger: "#a12a1e",
    colorSuccess: "#2e6b3b",
    colorShadow: "transparent",
    borderRadius: "2px",
    fontFamily: "var(--font-plex-sans)",
    fontFamilyButtons: "var(--font-plex-sans)",
  },
  elements: {
    card: { boxShadow: "none", border: "1px solid #d9d4c4" },
    cardBox: { boxShadow: "none" },
    formButtonPrimary: { backgroundImage: "none", boxShadow: "none" },
    socialButtonsBlockButton: { boxShadow: "none" },
    formFieldInput: { boxShadow: "none" },
    headerTitle: {
      fontFamily: "var(--font-plex-condensed)",
      textTransform: "uppercase" as const,
      letterSpacing: "0.02em",
    },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexCondensed.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider appearance={clerkAppearance}>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
