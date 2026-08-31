"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../../uni.module.css";
import SelectWallet from "../client/WalletHandle/SelectWallet";

export default function NavBar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className={styles.topbar}>
      <div className={styles.nav}>
        <Link className={styles.brand} href="/" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.brandBadge} src="/brand/starknet-gaming.png" alt="Starknet Gaming" />
          <span className={styles.brandCopy}>
            <span className={styles.brandParent}>Starknet Gaming</span>
            <span className={styles.brandName}>GameShield</span>
          </span>
        </Link>

        {/* Desktop nav — unchanged, just hidden under 720px now */}
        <div className={styles.navActions}>
          <Link className={styles.navLink} href="/how-it-works">How it works</Link>
          <Link className={styles.navLink} href="/my-campaigns">My campaigns</Link>
          <Link className={`${styles.navLink} ${styles.navCta}`} href="/create">Create bounty</Link>
          <SelectWallet variant="nav" />
        </div>

        {/* Mobile hamburger — this is the actual fix: wallet connect and
            links used to just overflow off the edge of the navbar with
            nothing to reveal them. */}
        <button
          className={`${styles.navToggle} ${open ? styles.navToggleOpen : ""}`}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={styles.navToggleBar} />
          <span className={styles.navToggleBar} />
          <span className={styles.navToggleBar} />
        </button>
      </div>

      <div className={`${styles.navDrawer} ${open ? styles.navDrawerOpen : ""}`}>
        <Link className={styles.navLink} href="/" onClick={() => setOpen(false)}>Campaigns</Link>
        <Link className={styles.navLink} href="/how-it-works" onClick={() => setOpen(false)}>How it works</Link>
        <Link className={styles.navLink} href="/my-campaigns" onClick={() => setOpen(false)}>My campaigns</Link>
        <Link className={`${styles.navLink} ${styles.navCta}`} href="/create" onClick={() => setOpen(false)}>
          Create bounty
        </Link>
        <div className={styles.navDrawerWallet}>
          <SelectWallet variant="nav" />
        </div>
      </div>
    </nav>
  );
}
