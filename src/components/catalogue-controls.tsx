"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useTransition } from "react";
import type { CatalogueFilters } from "@/lib/catalogue";

type Option = { slug: string; name: string };

const filterNames = ["q", "type", "machine", "material"] as const;

function filterQuery(read: (name: keyof CatalogueFilters) => string): string {
  const params = new URLSearchParams();
  for (const name of filterNames) {
    const value = read(name).trim();
    if (value) params.set(name, value);
  }
  return params.toString();
}

function writeFilters(form: HTMLFormElement | null, filters?: CatalogueFilters) {
  for (const name of filterNames) {
    const control = form?.elements.namedItem(name);
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
      control.value = filters?.[name] ?? "";
    }
  }
}

// Search and filters. State lives in the address (?q=&type=&machine=&material=)
// so results are server-rendered, shareable and work without JavaScript.
export function CatalogueControls({
  filters,
  toolTypes = [],
  machines = [],
  searchFirst = false,
}: {
  filters: CatalogueFilters;
  toolTypes?: Option[];
  machines?: Option[];
  searchFirst?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const form = useRef<HTMLFormElement>(null);
  const requested = useRef<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const received = filterQuery((name) => filters[name]);
  const rendered = useRef(received);
  useLayoutEffect(() => {
    if (received === rendered.current) return;
    rendered.current = received;
    const index = requested.current.indexOf(received);
    requested.current = index === -1 ? [] : requested.current.slice(index + 1);
    if (index === -1) writeFilters(form.current, filters);
  }, [filters, received]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [pathname]);

  function push(element: HTMLFormElement, delay: number, showResults = false) {
    if (timer.current) clearTimeout(timer.current);
    const data = new FormData(element);
    const query = filterQuery((name) => String(data.get(name) ?? ""));
    timer.current = setTimeout(() => {
      timer.current = null;
      requested.current = [...requested.current.filter((prior) => prior !== query).slice(-7), query];
      const href = pathname + (query ? "?" + query : "");
      startTransition(() => router.replace(href + (showResults ? "#catalogue" : ""), { scroll: showResults }));
      if (showResults) document.getElementById("catalogue")?.focus();
    }, delay);
  }

  return (
    <form
      ref={form}
      className="controls"
      id="catalogue-controls"
      role="search"
      data-search-first={searchFirst || undefined}
      action={pathname + "#catalogue"}
      method="get"
      aria-busy={isPending}
      onReset={(event) => {
        event.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        requested.current = [];
        writeFilters(event.currentTarget, filters);
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        push(event.currentTarget, 0, searchFirst && submitter !== null);
      }}
      onChange={(event) => push(event.currentTarget, event.target === event.currentTarget.elements.namedItem("q") ? 160 : 0)}
    >
      {searchFirst && <label htmlFor="finder">Search blades</label>}
      <label className="search-field">
        <span className="search-icon" aria-hidden="true" />
        {!searchFirst && <span className="sr">Search by part number, machine or material</span>}
        <input
          id="finder"
          name="q"
          type="search"
          placeholder={searchFirst ? "e.g. 3910301" : "Search blades"}
          aria-describedby={searchFirst ? "finder-hint" : undefined}
          autoComplete="off"
          maxLength={80}
          defaultValue={filters.q}
        />
        <kbd aria-hidden="true">/</kbd>
      </label>
      {searchFirst
        ? <button className="primary" type="submit">Search</button>
        : <CatalogueFacets filters={filters} toolTypes={toolTypes} machines={machines} />}
      {filters.material && <input type="hidden" name="material" defaultValue={filters.material} />}
      {!searchFirst && (
        <noscript>
          <button className="secondary" type="submit">Search</button>
        </noscript>
      )}
      {searchFirst && <p id="finder-hint">Enter a part number, OEM code, machine or blade name.</p>}
    </form>
  );
}

export function CatalogueFacets({ filters, toolTypes, machines, form }: {
  filters: CatalogueFilters;
  toolTypes: Option[];
  machines: Option[];
  form?: string;
}) {
  return (
    <>
      <label className="select-field">
        <span className="sr">Tool type</span>
        <select name="type" form={form} defaultValue={filters.type} onChange={form ? (event) => event.currentTarget.form?.requestSubmit() : undefined}>
          <option value="">All tool types</option>
          {toolTypes.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      <label className="select-field">
        <span className="sr">Machine</span>
        <select name="machine" form={form} defaultValue={filters.machine} onChange={form ? (event) => event.currentTarget.form?.requestSubmit() : undefined}>
          <option value="">All machines</option>
          {machines.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
      {form && <noscript><button className="secondary" form={form} type="submit">Apply filters</button></noscript>}
    </>
  );
}
