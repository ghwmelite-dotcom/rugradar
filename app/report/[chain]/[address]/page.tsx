import { notFound } from "next/navigation";
import { isChain } from "@/lib/chains";
import { ReportView } from "@/components/ReportView";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ chain: string; address: string }>;
}) {
  const { chain, address } = await params;
  if (!isChain(chain) || !address) notFound();
  return <ReportView chain={chain} address={address} />;
}
