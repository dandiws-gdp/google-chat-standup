// Interface for GitHub PR data
export interface GitHubPR {
  title: string;
  number: number;
  author: string;
  url: string;
  reviewers: Array<{ login: string; status: string }>;
  createdAt: string;
  repository: string;
  isDraft: boolean;
}

interface GitHubPullRequestNode {
  title: string;
  number: number;
  url: string;
  createdAt: string;
  isDraft: boolean;
  author?: { login?: string } | null;
  reviewRequests?: {
    nodes?: Array<
      {
        requestedReviewer?: { login?: string } | null;
      } | null
    >;
  } | null;
  reviews?: {
    nodes?: Array<
      {
        author?: { login?: string } | null;
        state?: string;
      } | null
    >;
  } | null;
}

// Function to fetch pull requests waiting for review from GitHub using GraphQL API
export async function fetchPRsWaitingForReview(
  githubToken: string | undefined,
  githubRepos: string,
): Promise<{ prs: GitHubPR[]; draftCounts: Record<string, number> }> {
  if (!githubToken) {
    console.warn("GitHub token is not set. Skipping PR reminder.");
    return { prs: [], draftCounts: {} };
  }

  if (!githubRepos) {
    console.warn(
      "GitHub repositories are not configured. Skipping PR reminder.",
    );
    return { prs: [], draftCounts: {} };
  }

  const repos = githubRepos.split(",").map((repo) => repo.trim()).filter(
    (repo) => repo,
  );
  const allPRs: GitHubPR[] = [];
  const draftCounts: Record<string, number> = {};

  for (const repo of repos) {
    try {
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        console.warn(
          `Invalid repository format: ${repo}. Expected format: owner/repo`,
        );
        continue;
      }

      // GraphQL query to fetch PRs with reviewers and reviews in one call
      const query = `
        query {
          repository(owner: "${owner}", name: "${repoName}") {
            pullRequests(first: 100, states: OPEN, orderBy: {field: CREATED_AT, direction: DESC}) {
              nodes {
                number
                title
                url
                createdAt
                isDraft
                author {
                  login
                }
                reviewRequests(first: 20) {
                  nodes {
                    requestedReviewer {
                      ... on User {
                        login
                      }
                    }
                  }
                }
                reviews(first: 50) {
                  nodes {
                    author {
                      login
                    }
                    state
                  }
                }
              }
            }
          }
        }
      `;

      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          "Authorization": `bearer ${githubToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        console.error(
          `Failed to fetch PRs from ${repo}: ${response.status} ${response.statusText}`,
        );
        continue;
      }

      const result = await response.json();

      if (result.errors) {
        console.error(`GraphQL errors for ${repo}:`, result.errors);
        continue;
      }

      const prs: GitHubPullRequestNode[] =
        result.data?.repository?.pullRequests?.nodes || [];

      // Count draft PRs for this repository
      const draftPRs = prs.filter((pr) => pr.isDraft);
      draftCounts[repo] = draftPRs.length;

      for (const pr of prs) {
        const reviewerStatuses = new Map<string, string>();

        // Get requested reviewers
        const requestedReviewers = pr.reviewRequests?.nodes
          ?.map((rr) => rr?.requestedReviewer?.login)
          .filter((login): login is string => Boolean(login)) || [];

        // Initialize requested reviewers with "pending" status
        for (const reviewer of requestedReviewers) {
          reviewerStatuses.set(reviewer, "pending");
        }

        // Process reviews to get reviewer statuses
        const reviews = pr.reviews?.nodes || [];
        for (const review of reviews) {
          if (!review) continue;

          const reviewer = review.author?.login;
          const state = review.state;

          if (!reviewer) continue;

          // Skip bot reviews and the PR author
          if (reviewer === pr.author?.login || reviewer.includes("[bot]")) {
            continue;
          }

          // Add all reviewers (not just requested ones)
          // Latest review state wins
          if (state === "APPROVED") {
            reviewerStatuses.set(reviewer, "approved");
          } else if (state === "CHANGES_REQUESTED") {
            reviewerStatuses.set(reviewer, "changes_requested");
          } else if (state === "COMMENTED") {
            // Only set to commented if not already approved or changes requested
            if (
              !reviewerStatuses.has(reviewer) ||
              reviewerStatuses.get(reviewer) === "pending"
            ) {
              reviewerStatuses.set(reviewer, "commented");
            }
          }
        }

        // Convert to array format
        const reviewersWithStatus = Array.from(reviewerStatuses.entries()).map((
          [login, status],
        ) => ({
          login,
          status,
        }));

        // Only include PRs that have reviewers
        if (reviewersWithStatus.length > 0) {
          allPRs.push({
            title: pr.title,
            number: pr.number,
            author: pr.author?.login || "unknown",
            url: pr.url,
            reviewers: reviewersWithStatus,
            createdAt: pr.createdAt,
            repository: repo,
            isDraft: pr.isDraft,
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching PRs from ${repo}:`, error);
    }
  }

  return { prs: allPRs, draftCounts };
}

// Function to generate PR reminder message
export function generatePRReminderMessage(
  prs: GitHubPR[],
  maxAgeDays: number = 120,
  _draftCounts: Record<string, number> = {},
): string {
  if (prs.length === 0) {
    return "";
  }

  // Calculate age threshold
  const now = new Date();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  const formatReviewers = (reviewers: GitHubPR["reviewers"]): string => {
    return reviewers.map((r) => {
      let emoji = "";
      switch (r.status) {
        case "approved":
          emoji = "✅";
          break;
        case "changes_requested":
          emoji = "🔄";
          break;
        case "commented":
          emoji = "💬";
          break;
        case "pending":
        default:
          emoji = "⏳";
          break;
      }
      return `${r.login} ${emoji}`;
    }).join(", ");
  };

  const formatAge = (pr: GitHubPR): string => {
    const createdDate = new Date(pr.createdAt);
    const diffMs = now.getTime() - createdDate.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return `${diffDays}d`;
    }

    if (diffHours > 0) {
      return `${diffHours}h`;
    }

    return "now";
  };

  const getRepoName = (repository: string): string => {
    return repository.split("/").pop() || repository;
  };

  const isOld = (pr: GitHubPR): boolean => {
    const prAge = now.getTime() - new Date(pr.createdAt).getTime();
    return prAge > maxAgeMs;
  };

  const sortOldestFirst = (left: GitHubPR, right: GitHubPR): number => {
    return new Date(left.createdAt).getTime() -
      new Date(right.createdAt).getTime();
  };

  const hasChangesRequested = (pr: GitHubPR): boolean => {
    return pr.reviewers.some((r) => r.status === "changes_requested");
  };

  const isApproved = (pr: GitHubPR): boolean => {
    return pr.reviewers.length > 0 &&
      pr.reviewers.every((r) => r.status === "approved");
  };

  const formatAction = (pr: GitHubPR): string => {
    if (hasChangesRequested(pr)) {
      return "changes";
    }

    if (pr.isDraft && isApproved(pr)) {
      return "open";
    }

    return pr.isDraft ? "LGTM" : "review/approve";
  };

  const formatPRLine = (pr: GitHubPR, includeAction: boolean): string => {
    const state = pr.isDraft ? "D" : "O";
    const repoName = getRepoName(pr.repository);
    const link = `<${pr.url}|${repoName}#${pr.number}>`;
    const reviewers = formatReviewers(pr.reviewers);
    const action = includeAction ? ` | ${formatAction(pr)}` : "";
    return `${state} ${link} ${pr.title} | by ${pr.author} | ${
      formatAge(pr)
    } | ${reviewers}${action}`;
  };

  const recentPRs = prs.filter((pr) => !isOld(pr)).sort(sortOldestFirst);
  const oldPRCount = prs.length - recentPRs.length;
  const needsActionPRs = recentPRs.filter((pr) =>
    pr.isDraft || !isApproved(pr)
  );
  const readyToMergePRs = recentPRs.filter((pr) =>
    !pr.isDraft && isApproved(pr)
  );

  if (needsActionPRs.length === 0 && readyToMergePRs.length === 0) {
    return "";
  }

  let message = `🔄 *PR Queue* oldest first\n`;
  message += `D=draft, O=open\n\n`;

  if (needsActionPRs.length > 0) {
    message += `*Needs action*\n`;
    message += needsActionPRs.map((pr) => formatPRLine(pr, true)).join("\n");
    message += `\n\n`;
  }

  if (readyToMergePRs.length > 0) {
    message += `*Ready to merge*\n`;
    message += readyToMergePRs.map((pr) => formatPRLine(pr, false)).join("\n");
    message += `\n`;
  }

  if (oldPRCount > 0) {
    message += `\nOld: ${oldPRCount} older than ${maxAgeDays}d`;
  }

  return message.trimEnd();
}
