"use client";

import dynamic from "next/dynamic";

const ClientApp = dynamic(() => import("./client-app"), { ssr: false });

export default function Home() {
  return <ClientApp />;
}
