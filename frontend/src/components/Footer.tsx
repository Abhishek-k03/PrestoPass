import Link from "next/link";

const footerMem = {
  title: "Project By",
  members: [{ label: "Abhishek kumar", href: "#" }],
};

const Footer = () => {
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-8 pt-11 pb-6">
        <div className="flex flex-col gap-12 md:flex-row md:items-start md:justify-between">
          {/* Brand */}
          <div className="max-w-md">
            <Link
              href="/"
              className="font-display text-[44px] leading-none tracking-tight text-ivory"
            >
              PrestoPass
              <sup className="align-super text-[15px] text-muted-foreground">®</sup>
            </Link>

            <p className="mt-1 text-caption text-muted-foreground">
              Get your pass, presto.
            </p>

            <p className="mt-3.5 text-caption text-muted-foreground">
              By continuing past this page, you agree to our{" "}
              <Link href="#" className="underline transition hover:text-ink-300">
                terms of use
              </Link>
              .
            </p>
          </div>

          {/* Divider (mobile only) */}
          <div className="h-px w-full bg-border md:hidden" />

          {/* Team */}
          <div>
            <p className="text-kicker uppercase text-muted-foreground">
              {footerMem.title}
            </p>
            <ul className="mt-2.5 space-y-2">
              {footerMem.members.map((mem) => (
                <li key={mem.label}>
                  <Link
                    href={mem.href}
                    className="text-label text-ink-300 transition hover:text-ivory"
                  >
                    {mem.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom divider + copyright */}
        <div className="mt-7 border-t border-border pt-4">
          <p className="text-caption text-muted-foreground">
            © {new Date().getFullYear()} PrestoPass. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
