"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function Searchbar({ placeholder }: { placeholder: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { replace } = useRouter();

  // Local state to hold the input term before searching
  const [term, setTerm] = useState(searchParams.get("query")?.toString() || "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (term.trim()) {
      params.set("query", term.trim());
    } else {
      params.delete("query");
    }
    replace(`${pathname}?${params.toString()}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full items-center gap-2">
      <div className="relative flex-1">
        <label htmlFor="search" className="sr-only">
          Search
        </label>
        <input
          id="search"
          className="peer block h-10 w-full rounded-md border border-border bg-field pl-10 text-label text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-3 focus:ring-primary/15"
          placeholder={placeholder}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground peer-focus:text-foreground" />
      </div>
      <Button
        type="submit"
        variant="outline"
        className="h-10 shrink-0 rounded-md px-4 text-label"
      >
        Search
      </Button>
    </form>
  );
}
