import Link from "next/link";
import { loginAction } from "@/lib/actions";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">WhatsApp Order Manager</h1>
        <p className="mt-2 text-sm text-gray-500">
          Sign in to your dashboard
        </p>

        <form action={async (formData) => {
            "use server";
            await loginAction(formData);
        }} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium">Email</label>
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Password</label>
            <input
              name="password"
              type="password"
              required
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-black px-4 py-2 text-white"
          >
            Sign in
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          Don't have an account?{" "}
          <Link href="/signup" className="font-medium text-black underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}