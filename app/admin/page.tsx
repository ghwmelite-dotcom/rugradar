import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RugRadar — content vault",
  robots: { index: false, follow: false },
};

// Hidden URL — no public link points here. The session cookie is the only
// way in; everyone else lands on the login page.
export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <AdminDashboard />;
}
