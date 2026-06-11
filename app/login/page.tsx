import { redirect } from "next/navigation";
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
    <main className="page">
      <section className="panel">
        <div className="stack">
          <div>
            <h1>כניסה למערכת</h1>
            <p className="muted">Rescue Command Center</p>
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

            {searchParams.error ? (
              <p className="error">פרטי ההתחברות אינם תקינים.</p>
            ) : null}

            <button className="button" type="submit">
              כניסה
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
