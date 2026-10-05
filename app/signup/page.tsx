import Link from "next/link";
import { signupAction } from "@/lib/actions";

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Create your account</h1>
        <p className="mt-2 text-sm text-gray-500">
          Create your shop account
        </p>

        <form action={async (formData) => {
           "use server";
           await signupAction(formData);
        }} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium">Name</label>
            <input
              name="name"
              required
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="Your name"
            />
          </div>

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
              minLength={8}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="At least 8 characters"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">
              Organization / Shop Name
            </label>
            <input
              name="organizationName"
              required
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="My Shop"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-black px-4 py-2 text-white"
          >
            Create account
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-black underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
