import { assertEquals, assertStringIncludes } from "@std/assert";
import { generatePRReminderMessage, type GitHubPR } from "./github-prs.ts";

function createPR(overrides: Partial<GitHubPR>): GitHubPR {
  return {
    title: "Example change",
    number: 1,
    author: "author",
    url: "https://github.com/acme/app/pull/1",
    reviewers: [{ login: "reviewer", status: "pending" }],
    createdAt: new Date().toISOString(),
    repository: "acme/app",
    isDraft: true,
    ...overrides,
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

Deno.test("PR reminder renders compact oldest-first action and merge queues", () => {
  const message = generatePRReminderMessage([
    createPR({
      title: "Draft change",
      number: 11,
      url: "https://github.com/acme/app/pull/11",
      isDraft: true,
      createdAt: daysAgo(2),
    }),
    createPR({
      title: "Ready for approval",
      number: 12,
      url: "https://github.com/acme/app/pull/12",
      isDraft: false,
      createdAt: daysAgo(1),
      reviewers: [{ login: "reviewer", status: "commented" }],
    }),
    createPR({
      title: "Approved change",
      number: 10,
      url: "https://github.com/acme/app/pull/10",
      isDraft: false,
      createdAt: daysAgo(3),
      reviewers: [{ login: "reviewer", status: "approved" }],
    }),
  ]);

  assertStringIncludes(message, "🔄 *PR Queue* oldest first");
  assertStringIncludes(message, "D=draft, O=open");
  assertStringIncludes(message, "*Needs action*");
  assertStringIncludes(
    message,
    "D <https://github.com/acme/app/pull/11|app#11> Draft change | by author",
  );
  assertStringIncludes(
    message,
    "O <https://github.com/acme/app/pull/12|app#12> Ready for approval | by author",
  );
  assertStringIncludes(message, "*Ready to merge*");
  assertStringIncludes(
    message,
    "O <https://github.com/acme/app/pull/10|app#10> Approved change | by author",
  );
  assertEquals(message.indexOf("app#11") < message.indexOf("app#12"), true);
});

Deno.test("PR reminder includes approved PRs as ready to merge", () => {
  const message = generatePRReminderMessage([
    createPR({
      isDraft: false,
      reviewers: [{ login: "reviewer", status: "approved" }],
    }),
  ]);

  assertStringIncludes(message, "*Ready to merge*");
  assertStringIncludes(
    message,
    "O <https://github.com/acme/app/pull/1|app#1> Example change | by author",
  );
});
