import type { Config } from "tailwindcss";

/**
 * Ticket booking design system — Tailwind theme extensions.
 *
 * MIDNIGHT MARQUEE. Semantic color tokens live in globals.css (:root) so
 * Shadcn components pick them up automatically; this file mirrors them for
 * the legacy config surface and extends typography, radii, and shadows.
 *
 * Keep the values here in step with the @theme inline block in globals.css —
 * that block is the source of truth.
 */
const config: Config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        heading: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        hero: ["3.5rem", { lineHeight: "1.02", letterSpacing: "-0.02em", fontWeight: "400" }],
        display: ["2.5rem", { lineHeight: "1.05", letterSpacing: "-0.015em", fontWeight: "400" }],
        title: ["1.5rem", { lineHeight: "1.15", letterSpacing: "-0.01em", fontWeight: "400" }],
        heading: ["1.125rem", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
        body: ["0.9375rem", { lineHeight: "1.55", fontWeight: "400" }],
        label: ["0.8125rem", { lineHeight: "1.4", fontWeight: "500" }],
        caption: ["0.75rem", { lineHeight: "1.35", fontWeight: "500" }],
        kicker: ["0.6875rem", { lineHeight: "1", letterSpacing: "0.14em", fontWeight: "600" }],
        section: ["0.6875rem", { lineHeight: "1", letterSpacing: "0.14em", fontWeight: "600" }],
        metric: ["2rem", { lineHeight: "1", letterSpacing: "-0.01em", fontWeight: "500" }],
        "metric-sm": ["1rem", { lineHeight: "1", fontWeight: "500" }],
      },
      borderRadius: {
        sm: "calc(var(--radius) - 2px)",
        md: "var(--radius)",
        lg: "calc(var(--radius) + 2px)",
        xl: "calc(var(--radius) + 6px)",
        "2xl": "calc(var(--radius) + 10px)",
        "3xl": "calc(var(--radius) + 14px)",
        "4xl": "calc(var(--radius) + 18px)",
      },
      boxShadow: {
        // Deep alphas: on a near-black ground, light-mode shadows are invisible.
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.4)",
        sm: "0 1px 2px 0 rgb(0 0 0 / 0.5)",
        md: "0 4px 12px -2px rgb(0 0 0 / 0.55)",
        lg: "0 16px 40px -12px rgb(0 0 0 / 0.7)",
        tooltip: "0 8px 24px 0 rgb(0 0 0 / 0.6)",
        card: "0 1px 2px 0 rgb(0 0 0 / 0.5)",
        // The marquee bulb: primary CTA and selected seat only.
        glow: "0 0 0 1px oklch(0.8 0.165 72 / 0.25), 0 8px 24px -8px oklch(0.8 0.165 72 / 0.35)",
      },
      colors: {
        ink: {
          1000: "var(--ink-1000)",
          950: "var(--ink-950)",
          900: "var(--ink-900)",
          850: "var(--ink-850)",
          800: "var(--ink-800)",
          700: "var(--ink-700)",
          500: "var(--ink-500)",
          300: "var(--ink-300)",
          100: "var(--ink-100)",
        },
        ivory: "var(--ivory)",
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        success: {
          DEFAULT: "var(--success)",
          foreground: "var(--success-foreground)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          foreground: "var(--warning-foreground)",
        },
        header: {
          DEFAULT: "var(--header)",
          foreground: "var(--header-foreground)",
        },
        surface: "var(--surface)",
        field: "var(--field)",
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
      },
    },
  },
};

export default config;
