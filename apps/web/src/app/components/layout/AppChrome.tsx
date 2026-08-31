"use client";

import styles from "../../uni.module.css";
import NavBar from "./NavBar";
import Footer from "./Footer";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <NavBar />
      {children}
      <Footer />
    </div>
  );
}
