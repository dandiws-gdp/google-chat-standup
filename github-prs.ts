// Interface for GitHub PR data
export interface GitHubPR {
  title: string;
  number: number;
  author: string;
  url: string;
  reviewers: Array<{login: string; status: string}>;
  createdAt: string;
  repository: string;
}

// Function to fetch pull requests waiting for review from GitHub using GraphQL API
export async function fetchPRsWaitingForReview(
  githubToken: string | undefined,
  githubRepos: string
): Promise<{ prs: GitHubPR[]; draftCounts: Record<string, number> }> {
  if (!githubToken) {
    console.warn("GitHub token is not set. Skipping PR reminder.");
    return { prs: [], draftCounts: {} };
  }

  if (!githubRepos) {
    console.warn("GitHub repositories are not configured. Skipping PR reminder.");
    return { prs: [], draftCounts: {} };
  }

  const repos = githubRepos.split(",").map(repo => repo.trim()).filter(repo => repo);
  const allPRs: GitHubPR[] = [];
  const draftCounts: Record<string, number> = {};

  for (const repo of repos) {
    try {
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        console.warn(`Invalid repository format: ${repo}. Expected format: owner/repo`);
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
        body: JSON.stringify({ query })
      });

      if (!response.ok) {
        console.error(`Failed to fetch PRs from ${repo}: ${response.status} ${response.statusText}`);
        continue;
      }

      const result = await response.json();
      
      if (result.errors) {
        console.error(`GraphQL errors for ${repo}:`, result.errors);
        continue;
      }

      const prs = result.data?.repository?.pullRequests?.nodes || [];
      
      // Count draft PRs for this repository
      const draftPRs = prs.filter((pr: any) => pr.isDraft);
      draftCounts[repo] = draftPRs.length;
      
      for (const pr of prs) {
        // Filter PRs that are waiting for review (not draft)
        if (pr.isDraft) continue;
        
        const reviewerStatuses = new Map<string, string>();
        
        // Get requested reviewers
        const requestedReviewers = pr.reviewRequests?.nodes
          ?.map((rr: any) => rr.requestedReviewer?.login)
          .filter((login: string) => login) || [];
        
        // Initialize requested reviewers with "pending" status
        for (const reviewer of requestedReviewers) {
          reviewerStatuses.set(reviewer, "pending");
        }
        
        // Process reviews to get reviewer statuses
        const reviews = pr.reviews?.nodes || [];
        for (const review of reviews) {
          const reviewer = review.author?.login;
          const state = review.state;
          
          if (!reviewer) continue;
          
          // Skip bot reviews and the PR author
          if (reviewer === pr.author?.login || reviewer.includes('[bot]')) {
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
            if (!reviewerStatuses.has(reviewer) || reviewerStatuses.get(reviewer) === "pending") {
              reviewerStatuses.set(reviewer, "commented");
            }
          }
        }
        
        // Convert to array format
        const reviewersWithStatus = Array.from(reviewerStatuses.entries()).map(([login, status]) => ({
          login,
          status
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
            repository: repo
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
  draftCounts: Record<string, number> = {}
): string {
  if (prs.length === 0) {
    return "";
  }

  let message = `🔄 *Pull Requests Reminder* 🔄\n\n`;
  message += `The following PRs need your attention:\n\n`;

  // Calculate age threshold
  const now = new Date();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  // Group PRs by repository
  const prsByRepo = prs.reduce((acc, pr) => {
    if (!acc[pr.repository]) {
      acc[pr.repository] = [];
    }
    acc[pr.repository].push(pr);
    return acc;
  }, {} as Record<string, GitHubPR[]>);

  // Track hidden PRs per repository
  const hiddenByRepo: Record<string, { fullyReviewed: number; tooOld: number; draft: number }> = {};

  // Display PRs grouped by repository
  for (const [repository, repoPRs] of Object.entries(prsByRepo)) {
    // Initialize tracking for this repo
    if (!hiddenByRepo[repository]) {
      hiddenByRepo[repository] = { fullyReviewed: 0, tooOld: 0, draft: draftCounts[repository] || 0 };
    }
    
    // Filter PRs by age first
    const recentPRs = repoPRs.filter(pr => {
      const prAge = now.getTime() - new Date(pr.createdAt).getTime();
      return prAge <= maxAgeMs;
    });
    
    const oldPRs = repoPRs.filter(pr => {
      const prAge = now.getTime() - new Date(pr.createdAt).getTime();
      return prAge > maxAgeMs;
    });
    
    hiddenByRepo[repository].tooOld = oldPRs.length;
    
    // Then filter recent PRs by review status
    // Show PRs that have pending reviewers OR only commented/changes_requested (not fully approved)
    const prsWithPendingReview = recentPRs.filter(pr => 
      pr.reviewers.some(r => r.status === "pending" || r.status === "commented" || r.status === "changes_requested")
    );
    
    const prsFullyReviewed = recentPRs.filter(pr => 
      pr.reviewers.length > 0 && pr.reviewers.every(r => r.status === "approved")
    );
    
    hiddenByRepo[repository].fullyReviewed = prsFullyReviewed.length;
    
    // Only show repository section if there are PRs with pending reviews
    if (prsWithPendingReview.length > 0) {
      message += `*${repository}*\n\n`;
      
      for (const pr of prsWithPendingReview) {
        const createdDate = new Date(pr.createdAt);
        const formattedDate = createdDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });
        
        // Calculate relative time
        const now = new Date();
        const diffMs = now.getTime() - createdDate.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        
        let relativeTime = "";
        if (diffDays > 0) {
          relativeTime = `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
        } else if (diffHours > 0) {
          relativeTime = `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        } else {
          relativeTime = "just now";
        }
        
        message += `#${pr.number} - <${pr.url}|${pr.title}>\n`;
        message += `Author: ${pr.author}\n`;
        
        // Format reviewers with status emojis
        const reviewersList = pr.reviewers.map(r => {
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
        
        message += `Reviewers: ${reviewersList}\n`;
        message += `Created: ${formattedDate} (${relativeTime})\n\n`;
      }
    }
  }

  // Add summary at the end - show hidden counts per repository
  const hasHiddenPRs = Object.values(hiddenByRepo).some(
    counts => counts.fullyReviewed > 0 || counts.tooOld > 0 || counts.draft > 0
  );
  
  if (hasHiddenPRs) {
    message += `---\n`;
    message += `Hidden PRs:\n\n`;
    
    for (const [repository, counts] of Object.entries(hiddenByRepo)) {
      if (counts.fullyReviewed > 0 || counts.tooOld > 0 || counts.draft > 0) {
        message += `${repository}:\n`;
        if (counts.fullyReviewed > 0) {
          message += `  - ${counts.fullyReviewed} PR${counts.fullyReviewed > 1 ? 's' : ''} fully reviewed\n`;
        }
        if (counts.tooOld > 0) {
          message += `  - ${counts.tooOld} PR${counts.tooOld > 1 ? 's' : ''} older than ${maxAgeDays} days\n`;
        }
        if (counts.draft > 0) {
          message += `  - ${counts.draft} draft PR${counts.draft > 1 ? 's' : ''}\n`;
        }
      }
    }
    message += `\n`;
  }

  message += `Please review these pull requests at your earliest convenience. Thank you!`;
  return message;
}
