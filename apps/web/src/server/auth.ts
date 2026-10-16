import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { tanstackStartCookies } from 'better-auth/tanstack-start';
import { account, getDb, passkey as passkeyTable, session, user, verification } from '@finance/db';
import { sendMail } from './mail';
import { provisionWorkspace } from './workspace';

const allowedEmails = (process.env.ALLOWED_SIGNUP_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema: { user, session, account, verification, passkey: passkeyTable },
  }),
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  databaseHooks: {
    user: {
      create: {
        before: async (u) => {
          if (allowedEmails.length && !allowedEmails.includes(u.email.toLowerCase())) {
            throw new APIError('FORBIDDEN', { message: 'Registration is closed for this email address' });
          }
        },
        after: async (u) => {
          await provisionWorkspace(u.id, u.name || u.email.split('@')[0]!);
        },
      },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      storeOTP: 'hashed',
      async sendVerificationOTP({ email, otp }) {
        // Not awaited, to avoid leaking timing information about registered emails.
        void sendMail(email, `Your Finance sign-in code: ${otp}`, `Your sign-in code is ${otp}. It expires in 10 minutes.`);
      },
    }),
    passkey({
      rpID: process.env.PASSKEY_RP_ID ?? 'localhost',
      rpName: process.env.PASSKEY_RP_NAME ?? 'Finance',
      origin: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 5025}`,
    }),
    tanstackStartCookies(),
  ],
});
