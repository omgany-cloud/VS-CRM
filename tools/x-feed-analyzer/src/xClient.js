import { getAccessToken } from './auth.js';

const API_BASE = 'https://api.twitter.com/2';

async function apiGet(pathAndQuery) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    const resetAt = Number(res.headers.get('x-rate-limit-reset') || 0) * 1000;
    const waitMs = Math.max(resetAt - Date.now(), 1000);
    console.log(`Rate limited, waiting ${Math.ceil(waitMs / 1000)}s...`);
    await new Promise((r) => setTimeout(r, waitMs));
    return apiGet(pathAndQuery);
  }

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`X API error ${res.status} on ${pathAndQuery}: ${JSON.stringify(json)}`);
  }
  return json;
}

export async function getMe() {
  const json = await apiGet('/users/me');
  return json.data;
}

/**
 * Pulls up to `maxPages` pages (100 tweets each) of the caller's home
 * timeline. Requires a paid API access tier — the Free tier does not
 * expose this endpoint regardless of the granted OAuth scopes.
 */
export async function fetchHomeTimeline(userId, maxPages) {
  const tweets = [];
  const usersById = new Map();
  let paginationToken;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      max_results: '100',
      'tweet.fields': 'created_at,public_metrics,lang,entities',
      expansions: 'author_id',
      'user.fields': 'username,name',
    });
    if (paginationToken) params.set('pagination_token', paginationToken);

    const json = await apiGet(`/users/${userId}/timelines/reverse_chronological?${params}`);

    for (const user of json.includes?.users || []) {
      usersById.set(user.id, user);
    }
    for (const tweet of json.data || []) {
      tweets.push(tweet);
    }

    paginationToken = json.meta?.next_token;
    if (!paginationToken) break;
  }

  return { tweets, usersById };
}
