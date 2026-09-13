const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'is', 'are', 'was', 'were', 'be',
  'been', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'this',
  'that', 'it', 'as', 'not', 'you', 'your', 'i', 'we', 'they', 'he', 'she',
  'my', 'me', 'so', 'do', 'does', 'did', 'have', 'has', 'had', 'just', 'about',
  'will', 'can', 'all', 'out', 'up', 'what', 'when', 'how', 'more', 'https',
  // Russian
  'и', 'в', 'не', 'на', 'что', 'с', 'по', 'это', 'как', 'но', 'а', 'к', 'у',
  'за', 'из', 'о', 'же', 'мы', 'вы', 'он', 'она', 'они', 'я', 'для', 'то',
  'бы', 'от', 'до', 'уже', 'все', 'его', 'ее', 'их', 'так', 'если', 'или',
]);

// Small heuristic lexicon — not a real NLP model, just a rough signal.
const POSITIVE_WORDS = new Set([
  'good', 'great', 'awesome', 'excellent', 'amazing', 'love', 'win', 'best',
  'happy', 'nice', 'success', 'growth', 'launch', 'breakthrough', 'progress',
  'хорошо', 'отлично', 'круто', 'супер', 'успех', 'рад', 'победа', 'рост',
]);
const NEGATIVE_WORDS = new Set([
  'bad', 'worst', 'hate', 'fail', 'failure', 'crash', 'bug', 'problem',
  'scam', 'down', 'loss', 'angry', 'sad', 'crisis', 'war', 'attack',
  'плохо', 'провал', 'проблема', 'кризис', 'война', 'ужас', 'падение',
]);

function tokenize(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).filter(
    (w) => w.length > 2 && !STOPWORDS.has(w)
  );
}

function topEntries(counter, n) {
  return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function analyzeTimeline(tweets, usersById) {
  const authorCounts = new Map();
  const hashtagCounts = new Map();
  const domainCounts = new Map();
  const wordCounts = new Map();
  const langCounts = new Map();
  let totalLikes = 0;
  let totalRetweets = 0;
  let positive = 0;
  let negative = 0;
  let neutral = 0;

  for (const tweet of tweets) {
    const author = usersById.get(tweet.author_id);
    const authorLabel = author ? `@${author.username}` : tweet.author_id;
    authorCounts.set(authorLabel, (authorCounts.get(authorLabel) || 0) + 1);

    for (const tag of tweet.entities?.hashtags || []) {
      const key = `#${tag.tag}`;
      hashtagCounts.set(key, (hashtagCounts.get(key) || 0) + 1);
    }
    for (const url of tweet.entities?.urls || []) {
      const domain = domainFromUrl(url.expanded_url || url.url);
      if (domain) domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    }

    const metrics = tweet.public_metrics || {};
    totalLikes += metrics.like_count || 0;
    totalRetweets += metrics.retweet_count || 0;

    langCounts.set(tweet.lang || 'unknown', (langCounts.get(tweet.lang || 'unknown') || 0) + 1);

    const words = tokenize(tweet.text || '');
    let score = 0;
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      if (POSITIVE_WORDS.has(word)) score += 1;
      if (NEGATIVE_WORDS.has(word)) score -= 1;
    }
    if (score > 0) positive += 1;
    else if (score < 0) negative += 1;
    else neutral += 1;
  }

  const count = tweets.length || 1;

  return {
    tweetCount: tweets.length,
    dateRange: {
      newest: tweets[0]?.created_at || null,
      oldest: tweets[tweets.length - 1]?.created_at || null,
    },
    topAuthors: topEntries(authorCounts, 10),
    topHashtags: topEntries(hashtagCounts, 10),
    topDomains: topEntries(domainCounts, 10),
    topKeywords: topEntries(wordCounts, 20),
    languages: topEntries(langCounts, 5),
    engagement: {
      avgLikes: +(totalLikes / count).toFixed(2),
      avgRetweets: +(totalRetweets / count).toFixed(2),
      totalLikes,
      totalRetweets,
    },
    sentiment: { positive, negative, neutral },
  };
}

export function printReport(report) {
  const line = (label, value) => console.log(`${label.padEnd(22)} ${value}`);

  console.log('\n=== X home timeline report ===\n');
  line('Tweets analyzed:', report.tweetCount);
  line('Newest:', report.dateRange.newest ?? '—');
  line('Oldest:', report.dateRange.oldest ?? '—');

  console.log('\n-- Engagement --');
  line('Avg likes/tweet:', report.engagement.avgLikes);
  line('Avg retweets/tweet:', report.engagement.avgRetweets);

  console.log('\n-- Sentiment (heuristic, not a real NLP model) --');
  line('Positive:', report.sentiment.positive);
  line('Neutral:', report.sentiment.neutral);
  line('Negative:', report.sentiment.negative);

  const printTop = (title, entries) => {
    console.log(`\n-- ${title} --`);
    if (!entries.length) console.log('(none)');
    for (const [key, value] of entries) console.log(`${String(value).padStart(4)}  ${key}`);
  };

  printTop('Most active accounts in your feed', report.topAuthors);
  printTop('Top hashtags', report.topHashtags);
  printTop('Top linked domains', report.topDomains);
  printTop('Top keywords', report.topKeywords);
  printTop('Languages', report.languages);
  console.log('');
}
