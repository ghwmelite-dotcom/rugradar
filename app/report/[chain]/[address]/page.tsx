import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isChain } from "@/lib/chains";
import { ReportView } from "@/components/ReportView";

export const dynamic = "force-dynamic";

const SITE_URL = "https://rugradar.ghwmelite.workers.dev";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}): Promise<Metadata> {
  const { chain, address } = await params;
  const short =
    address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  return {
    // metadataBase here (rather than the root layout) resolves the
    // auto-discovered opengraph-image to an absolute URL for this segment.
    metadataBase: new URL(SITE_URL),
    title: `${short} on ${chain} — RugRadar risk report`,
    description:
      "RugRadar flags red flags in memecoin contracts — honeypot checks, LP lock status, holder concentration. Not financial advice.",
    twitter: { card: "summary_large_image" },
  };
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}) {
  const { chain, address } = await params;
  if (!isChain(chain) || !address) notFound();
  return <ReportView chain={chain} address={address} />;
}
