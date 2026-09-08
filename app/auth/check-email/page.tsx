import Link from "next/link";
import { Brand } from "../../brand";

export default async function CheckEmail({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <Brand />
        <p className="auth-sub">Check your inbox</p>

        <div className="msg msg-ok">
          We&apos;ve sent a verification link
          {email ? (
            <>
              {" "}
              to <strong>{email}</strong>
            </>
          ) : null}
          . Click it to activate your account, then sign in.
        </div>

        <p className="hint">
          Nothing after a minute or two? Check your spam or junk folder — the
          message comes from your Supabase project&apos;s mail sender.
        </p>

        <p className="auth-foot">
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
