import { redirect } from "next/navigation";
import { BrandImage } from "@/app/brand-image";
import { signIn } from "./actions";
import { createClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams: {
    error?: string;
  };
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/incidents");
  }

  return (
    <main className="login-page">
      <section className="panel login-panel">
        <div className="login-brand">
          <BrandImage className="brand-logo primary-logo" src="/brand/yanshof-owl-logo.png" alt="לוגו ינשו&quot;פ" />
          <div>
            <h1>ינשו&quot;פ</h1>
            <p>יצירת ניתוח שוטף ותמיכה פיקודית</p>
          </div>
        </div>

        <form action={signIn} className="form">
          <label className="field">
            <span>אימייל</span>
            <input className="input" type="email" name="email" required />
          </label>

          <label className="field">
            <span>סיסמה</span>
            <input className="input" type="password" name="password" required />
          </label>

          {searchParams.error ? <p className="error">פרטי ההתחברות אינם תקינים.</p> : null}

          <button className="button" type="submit">
            כניסה למערכת
          </button>
        </form>
      </section>
    </main>
  );
}
