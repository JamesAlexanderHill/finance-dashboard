import { createFileRoute, redirect, useRouter } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authClient } from '../lib/auth-client';
import { getViewer } from '../server/session.functions';

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    if (await getViewer()) throw redirect({ to: '/' });
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = async () => {
    await router.invalidate();
    await router.navigate({ to: '/' });
  };

  async function run(fn: () => Promise<{ error?: { message?: string } | null } | undefined | void>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res && res.error) {
        setError(res.error.message ?? 'Something went wrong');
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => authClient.emailOtp.sendVerificationOtp({ email, type: 'sign-in' }))) setStep('code');
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => authClient.signIn.emailOtp({ email, otp }))) await done();
  };

  const withPasskey = async () => {
    if (await run(() => authClient.signIn.passkey())) await done();
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">Finance</h1>
        <p className="text-muted text-sm">Sign in to your workspace.</p>
      </div>

      <button
        type="button"
        onClick={withPasskey}
        disabled={busy}
        className="bg-accent text-accent-ink rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-50"
      >
        Sign in with a passkey
      </button>

      <div className="text-muted flex items-center gap-3 text-xs">
        <span className="bg-line h-px flex-1" /> or use an email code <span className="bg-line h-px flex-1" />
      </div>

      {step === 'email' ? (
        <form onSubmit={sendCode} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-line bg-surface rounded-md border px-3 py-2"
          />
          <button disabled={busy} className="border-line bg-surface rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50">
            Email me a code
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="otp">
            Code sent to {email}
          </label>
          <input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            className="border-line bg-surface tabular rounded-md border px-3 py-2 tracking-widest"
          />
          <button disabled={busy} className="bg-accent text-accent-ink rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50">
            Sign in
          </button>
          <button type="button" onClick={() => setStep('email')} className="text-muted text-sm underline">
            Use a different email
          </button>
        </form>
      )}

      {error && <p className="text-negative text-sm">{error}</p>}
    </main>
  );
}
