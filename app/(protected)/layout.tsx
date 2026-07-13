import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { BrandImage } from "@/app/brand-image";
import { CurrentTime } from "@/app/current-time";
import { OperationalLoadingButton } from "@/app/(protected)/operational-loading-button";
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

  const { data: systemRole } = await supabase.rpc("current_user_role");
  if (!systemRole) {
    await supabase.auth.signOut();
    redirect("/login?error=inactive");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const userDisplayName = profile?.display_name || user.email;

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
          {systemRole === "admin" ? <Link href="/admin/users">{"\u05e0\u05d9\u05d4\u05d5\u05dc \u05de\u05e9\u05ea\u05de\u05e9\u05d9\u05dd"}</Link> : null}
          {systemRole === "admin" ? <Link href="/admin/statuses">{"\u05e0\u05d9\u05d4\u05d5\u05dc \u05e1\u05d8\u05d8\u05d5\u05e1\u05d9\u05dd \u05de\u05d1\u05e6\u05e2\u05d9\u05d9\u05dd"}</Link> : null}
        </nav>

        <div className="header-ops-summary" aria-label="סיכום מערכת">
          <div>
            <span>משתמש</span>
            <strong>{userDisplayName}</strong>
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
          <OperationalLoadingButton className="button secondary" label="יציאה" loadingLabel="יוצא..." />
        </form>
      </header>

      {children}
    </>
  );
}
