/**
 * Operations CLI.
 *   pnpm --filter @noble/api cli seed-demo [--reset]
 *   pnpm --filter @noble/api cli seed-sample [--email admin@you.org.au]
 *   pnpm --filter @noble/api cli create-admin --email you@org.au --name "Your Name" [--password ...]
 *   pnpm --filter @noble/api cli reset-password --email you@org.au [--password ...]
 * In the container: node dist/scripts/cli.js <command> ...
 */
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { config } from "../src/config";
import { seedDemo } from "../src/db/seed";
import { seedSampleData } from "../src/db/seed-sample";
import {
  connectDatabase,
  disconnectDatabase,
  ensureModels,
} from "../src/lib/db";
import {
  ensureWorkspace,
  invalidateWorkspaceCache,
} from "../src/lib/workspace";
import { AuthSession, User, Workspace, WORKSPACE_ID } from "../src/models";
import { hashPassword } from "../src/modules/auth/service";
import { ensureTemplateSlots } from "../src/modules/documents/service";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: "string" },
    name: { type: "string" },
    password: { type: "string" },
    reset: { type: "boolean", default: false },
  },
});

const print = (message: string) => process.stdout.write(`${message}\n`);

function passwordOrGenerated(): { password: string; generated: boolean } {
  if (values.password) {
    if (values.password.length < config().auth.passwordMinLength)
      throw new Error(
        `Passwords need at least ${config().auth.passwordMinLength} characters.`
      );
    return { password: values.password, generated: false };
  }
  return { password: randomBytes(12).toString("base64url"), generated: true };
}

async function run(): Promise<void> {
  const command = positionals[0];
  if (
    !command ||
    !["seed-demo", "seed-sample", "create-admin", "reset-password"].includes(
      command
    )
  ) {
    print(
      "Usage: cli <seed-demo [--reset] | seed-sample [--email] | create-admin --email --name [--password] | reset-password --email [--password]>"
    );
    process.exitCode = 1;
    return;
  }
  await connectDatabase(config().mongoUri);
  await ensureModels();
  await ensureWorkspace();
  await ensureTemplateSlots();
  try {
    if (command === "seed-demo") {
      const result = await seedDemo({ reset: values.reset });
      print(
        `Demo data loaded. Sign in as ${result.email}${result.generatedPassword ? ` with password: ${result.generatedPassword}` : " (password from DEMO_ADMIN_PASSWORD)"}`
      );
      return;
    }
    if (command === "seed-sample") {
      const { adminEmail, report } = await seedSampleData({
        adminEmail: values.email,
        log: print,
      });
      const { counts } = report;
      const by = (prefix: string) =>
        Object.entries(counts)
          .filter(([key]) => key.startsWith(`${prefix}.`))
          .map(
            ([key, count]) =>
              `${count} ${key.slice(prefix.length + 1).toLowerCase()}`
          )
          .join(", ");
      print(
        [
          `Sample data added to the workspace of ${adminEmail}:`,
          `  ${counts.participants} clients (${by("participants")}), ${counts.staff} team members, ${counts.services} services`,
          `  ${counts.shifts} shifts (${by("shifts")})`,
          `  ${counts.records} service records (${by("records")})`,
          `  ${counts.invoices} invoices (${by("invoices")}), ${counts.budgets} plan budgets`,
          "Consistency check passed.",
        ].join("\n")
      );
      return;
    }
    const email = values.email?.trim().toLowerCase();
    if (!email) throw new Error("--email is required.");

    if (command === "create-admin") {
      if (!values.name?.trim()) throw new Error("--name is required.");
      if (await User.exists({ email }))
        throw new Error(
          `A user with ${email} already exists. Use reset-password instead.`
        );
      const { password, generated } = passwordOrGenerated();
      await User.create({
        name: values.name.trim(),
        email,
        passwordHash: await hashPassword(password),
        role: "admin",
      });
      // Creating an Admin from the CLI also closes the public first-run signup.
      await Workspace.updateOne(
        { _id: WORKSPACE_ID, setupCompletedAt: null },
        { $set: { setupCompletedAt: new Date() } }
      );
      invalidateWorkspaceCache();
      print(
        `Admin account created for ${email}.${generated ? ` Temporary password: ${password}` : ""}`
      );
      return;
    }

    const user = await User.findOne({ email });
    if (!user) throw new Error(`No user with ${email}.`);
    const { password, generated } = passwordOrGenerated();
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: await hashPassword(password),
          passwordChangedAt: new Date(),
          failedLogins: 0,
          lockedUntil: null,
        },
        $inc: { tokenVersion: 1 },
      }
    );
    await AuthSession.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: "cli_reset" } }
    );
    print(
      `Password reset for ${email}; all sessions were signed out.${generated ? ` Temporary password: ${password}` : ""}`
    );
  } finally {
    await disconnectDatabase();
  }
}

run().catch(error => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
