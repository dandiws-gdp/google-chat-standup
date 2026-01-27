// Interface for GitHub PR data
export interface GitHubPR {
  title: string;
  number: number;
  author: string;
  url: string;
  reviewers: string[];
  createdAt: string;
  repository: string;
}

// Function to fetch pull requests waiting for review from GitHub
export async function fetchPRsWaitingForReview(
  githubToken: string | undefined,
  githubRepos: string
): Promise<GitHubPR[]> {
  if (!githubToken) {
    console.warn("GitHub token is not set. Skipping PR reminder.");
    return [];
  }

  if (!githubRepos) {
    console.warn("GitHub repositories are not configured. Skipping PR reminder.");
    return [];
  }

  const repos = githubRepos.split(",").map(repo => repo.trim()).filter(repo => repo);
  const allPRs: GitHubPR[] = [];

  for (const repo of repos) {
    try {
      const [owner, repoName] = repo.split("/");
      if (!owner || !repoName) {
        console.warn(`Invalid repository format: ${repo}. Expected format: owner/repo`);
        continue;
      }

      const url = `https://api.github.com/repos/${owner}/${repoName}/pulls?state=open&sort=created&direction=desc`;
      const response = await fetch(url, {
        headers: {
          "Authorization": `token ${githubToken}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "google-chat-standup"
        }
      });

      if (!response.ok) {
        console.error(`Failed to fetch PRs from ${repo}: ${response.status} ${response.statusText}`);
        continue;
      }

      const prs = await response.json();
      
      for (const pr of prs) {
        // Filter PRs that are waiting for review (not draft, not approved)
        if (pr.draft) continue;
        
        // Get requested reviewers
        const reviewersUrl = `https://api.github.com/repos/${owner}/${repoName}/pulls/${pr.number}/requested_reviewers`;
        const reviewersResponse = await fetch(reviewersUrl, {
          headers: {
            "Authorization": `token ${githubToken}`,
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "google-chat-standup"
          }
        });
        
        let reviewers: string[] = [];
        if (reviewersResponse.ok) {
          const reviewersData = await reviewersResponse.json();
          // GitHub API returns {users: [...]} for requested_reviewers endpoint
          if (reviewersData.users && Array.isArray(reviewersData.users)) {
            reviewers = reviewersData.users.map((r: any) => r.login);
          } else if (Array.isArray(reviewersData)) {
            // Fallback if the structure is different
            reviewers = reviewersData.map((r: any) => r.login);
          }
        }
        
        // Only include PRs that have requested reviewers
        if (reviewers.length > 0) {
          allPRs.push({
            title: pr.title,
            number: pr.number,
            author: pr.user.login,
            url: pr.html_url,
            reviewers: reviewers,
            createdAt: pr.created_at,
            repository: repo
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching PRs from ${repo}:`, error);
    }
  }

  return allPRs;
}

// Function to generate PR reminder message
export function generatePRReminderMessage(prs: GitHubPR[]): string {
  if (prs.length === 0) {
    return "";
  }

  let message = `🔄 *Pull Requests Reminder* 🔄\n\n`;
  message += `The following PRs need your attention:\n\n`;

  // Group PRs by repository
  const prsByRepo = prs.reduce((acc, pr) => {
    if (!acc[pr.repository]) {
      acc[pr.repository] = [];
    }
    acc[pr.repository].push(pr);
    return acc;
  }, {} as Record<string, GitHubPR[]>);

  // Display PRs grouped by repository
  for (const [repository, repoPRs] of Object.entries(prsByRepo)) {
    message += `*${repository}*\n\n`;
    
    for (const pr of repoPRs) {
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
      message += `Reviewers: ${pr.reviewers.join(", ")}\n`;
      message += `Created: ${formattedDate} (${relativeTime})\n\n`;
    }
  }

  message += `Please review these pull requests at your earliest convenience. Thank you!`;
  return message;
}
