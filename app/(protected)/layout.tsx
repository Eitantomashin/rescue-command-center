import Link from "next/link";
import { redirect } from "next/navigation";
import { CommandActionPanel } from "./command-action-panel";
import { signOut } from "@/app/login/actions";
import { BrandImage } from "@/app/brand-image";
import { CurrentTime } from "@/app/current-time";
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
      <header className="command-header">
        <div className="brand-cluster">
          <BrandImage className="brand-logo primary-logo" src="/brand/yanshof-owl-logo.png" alt="לוגו ינשו&quot;פ" />
          <div>
            <strong>ינשו&quot;פ</strong>
            <span>יצירת ניתוח שוטף ותמיכה פיקודית</span>
          </div>
        </div>

        <nav className="nav-links" aria-label="ניווט ראשי">
          <Link href="/incidents">אירועים</Link>
          <Link href="/personnel">כ&quot;א יחידתי</Link>
        </nav>

        <div className="header-ops-summary" aria-label="סיכום מערכת">
          <div>
            <span>משתמש</span>
            <strong>{user.email}</strong>
          </div>
          <div>
            <span>שעה</span>
            <strong>
              <CurrentTime />
            </strong>
          </div>
        </div>

        <div className="brand-cluster rescue-cluster">
          <div>
            <strong>יחידת חילוץ</strong>
            <span>ארגון מפעיל</span>
          </div>
          <BrandImage className="brand-logo rescue-logo" src="/brand/rescue-unit-logo.png" alt="לוגו יחידת החילוץ" />
        </div>

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
