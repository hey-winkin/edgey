"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { filterReferenceGuide, type ReferenceGroup } from "@/lib/catalogue/reference-guide";
import styles from "./reference-guide.module.css";

const columns = ["Edgey blade", "Maker references", "Tool heads", "Edge angle", "Cutting depth", "Materials"];
const subscribeToHydration = () => () => {};
const isHydrated = () => true;
const isServerHydrated = () => false;

export function ReferenceGuide({ groups, url, date, dateTime }: {
  groups: ReferenceGroup[];
  url: string;
  date: string;
  dateTime: string;
}) {
  const [query, setQuery] = useState("");
  const interactive = useSyncExternalStore(subscribeToHydration, isHydrated, isServerHydrated);
  const printUrl = useRef<HTMLAnchorElement>(null);
  const results = filterReferenceGuide(groups, query);
  const count = results.reduce((sum, group) => sum + group.rows.length, 0);

  useEffect(() => {
    if (url.startsWith("/") && printUrl.current) {
      const absoluteUrl = new URL(url, window.location.origin).href;
      printUrl.current.href = absoluteUrl;
      printUrl.current.textContent = absoluteUrl;
    }
  }, [url]);

  return (
    <>
      <p className={styles.printOnly}>
        <a ref={printUrl} href={url}>{url}</a>{" · Guide generated "}<time dateTime={dateTime}>{date}</time>
      </p>
      {query.trim() && <p className={styles.printOnly}>Filtered results. Visit the URL above for the full guide.</p>}
      {interactive ? (
        <div className={`${styles.controls} ${styles.screenOnly}`}>
          <div role="search" aria-label="Reference guide">
            <label htmlFor="reference-guide-search">Search the reference guide</label>
            <div className={`search-field ${styles.searchBox}`}>
              <span className="search-icon" aria-hidden="true" />
              <input
                id="reference-guide-search"
                type="search"
                placeholder="e.g. Z10, Summa or vinyl"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <button type="button" className="secondary" onClick={() => window.print()}>Print guide</button>
        </div>
      ) : (
        <p className={`${styles.note} ${styles.screenOnly}`}>Use your browser’s Find and Print commands to search or print the full guide.</p>
      )}
      <p role="status" className={`${styles.count} ${styles.screenOnly}`}>
        {count} {count === 1 ? "entry" : "entries"}
      </p>
      {count === 0 && (
        <p className={styles.empty}>
          {groups.length ? "No blades match your search. Try another code, brand or material." : "No blades are listed in the guide yet."}
        </p>
      )}
      {results.map((group) => (
        <section key={group.id} id={group.id} className={styles.group}>
          <h2 id={group.id + "-heading"}>{group.name}</h2>
          <table role="table" aria-labelledby={group.id + "-heading"} className={styles.table}>
            <thead role="rowgroup">
              <tr role="row">
                {columns.map((label) => <th key={label} scope="col" role="columnheader">{label}</th>)}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {group.rows.map((row) => (
                <tr key={row.sku} role="row">
                  <th scope="row" role="rowheader">
                    <a href={row.href}>
                      <code>{row.sku}</code>
                      <span>{row.name}</span>
                    </a>
                  </th>
                  <td role="cell">
                    <span className={styles.cellLabel} aria-hidden="true">{columns[1]}</span>
                    <div>
                      {row.codes.length ? (
                        <ul className={styles.codes}>{row.codes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
                      ) : "None verified"}
                      {row.machines.length > 0 && <p className={styles.machines}>{row.machines.join("; ")}</p>}
                    </div>
                  </td>
                  {[row.heads.join("; "), row.angle, row.depth, row.materials.join(", ")].map((value, index) => (
                    <td key={columns[index + 2]} role="cell">
                      <span className={styles.cellLabel} aria-hidden="true">{columns[index + 2]}</span>
                      <span>{value || "Not listed"}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}
