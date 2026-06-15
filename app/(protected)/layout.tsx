import Link from "next/link";
import { redirect } from "next/navigation";
import { CommandActionPanel } from "./command-action-panel";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";

export default async function ProtectedLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <header className="nav">
        <div>
          <strong>מרכז שליטה חילוץ</strong>
          <div className="muted">{user.email}</div>
        </div>

        <nav className="nav-links" aria-label="ניווט ראשי">
          <Link href="/incidents">אירועים</Link>
        </nav>

        <form action={signOut}>
          <button className="button secondary" type="submit">
            יציאה
          </button>
        </form>
      </header>

      <CommandActionPanel />
      {children}
    </>
  );
}
