import type { Metadata } from "next";
import { QuickOrderForm } from "./quick-order-form";
import styles from "./quick-order.module.css";

export const metadata: Metadata = {
  title: "Quick order",
  robots: { index: false },
};

export default function QuickOrderPage() {
  return (
    <main id="main-content" tabIndex={-1} className={`frame ${styles.page}`}>
      <header className={styles.header}>
        <p className="kicker"><span className="register" aria-hidden="true" /> Buying</p>
        <h1>Quick order</h1>
        <p className="muted">Order several blades at once using Edgey SKUs or the maker’s part numbers.</p>
      </header>
      <QuickOrderForm />
    </main>
  );
}
