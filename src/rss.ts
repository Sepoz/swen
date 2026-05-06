import Parser from "rss-parser";
import type { Feed } from "./config.js";

export type NewsItem = {
	id: string;
	title: string;
	link: string;
	summary: string;
	content: string;
	pubDate: string;
	feedName: string;
	category: string;
};

export type FetchResult = {
	items: NewsItem[];
	warnings: string[];
};

const USER_AGENT = "Mozilla/5.0 (compatible; swen/0.1; +https://github.com/) RSS reader";
const FETCH_TIMEOUT_MS = 10_000;

const parser = new Parser({
	customFields: {
		item: ["content:encoded", "media:description"],
	},
});

function stripHtml(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/\s+/g, " ")
		.trim();
}

type RawItem = {
	guid?: string;
	id?: string;
	link?: string;
	title?: string;
	contentSnippet?: string;
	content?: string;
	summary?: string;
	isoDate?: string;
	pubDate?: string;
	"content:encoded"?: string;
	"media:description"?: string;
};

function mapItem(raw: RawItem, feed: Feed): NewsItem | null {
	const link = raw.link?.trim() ?? "";
	const title = raw.title?.trim() ?? "";
	if (!link && !title) return null;

	const rawContent =
		(typeof raw["content:encoded"] === "string" && raw["content:encoded"]) ||
		(typeof raw.content === "string" && raw.content) ||
		(typeof raw.summary === "string" && raw.summary) ||
		"";
	const content = stripHtml(rawContent);
	const snippet = raw.contentSnippet?.trim();
	const summary = snippet && snippet.length > 0 ? stripHtml(snippet) : content;

	const id = raw.guid ?? raw.id ?? link ?? `${feed.name}:${title}`;
	const pubDate = raw.isoDate ?? raw.pubDate ?? "";

	return {
		id,
		title: title || "(senza titolo)",
		link,
		summary,
		content: content.length > 0 ? content : summary,
		pubDate,
		feedName: feed.name,
		category: feed.category,
	};
}

async function fetchFeed(feed: Feed): Promise<NewsItem[]> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		const res = await fetch(feed.url, {
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
			},
			signal: controller.signal,
			redirect: "follow",
		});

		if (!res.ok) {
			throw new Error(`HTTP ${res.status} ${res.statusText}`);
		}

		const xml = await res.text();
		const parsed = await parser.parseString(xml);
		return (parsed.items ?? [])
			.map((raw) => mapItem(raw as RawItem, feed))
			.filter((item): item is NewsItem => item !== null);
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchAll(feeds: Feed[], limit: number): Promise<FetchResult> {
	const results = await Promise.allSettled(feeds.map((f) => fetchFeed(f)));

	const items: NewsItem[] = [];
	const warnings: string[] = [];

	const seen = new Set<string>();
	for (const [i, result] of results.entries()) {
		const feed = feeds[i]!;
		if (result.status === "fulfilled") {
			for (const it of result.value) {
				const key = `${feed.name}::${it.id}`;
				if (seen.has(key)) continue;
				seen.add(key);
				items.push({ ...it, id: key });
			}
		} else {
			const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
			warnings.push(`${feed.name}: ${reason}`);
		}
	}

	items.sort((a, b) => {
		const aTime = a.pubDate ? new Date(a.pubDate).getTime() || 0 : 0;
		const bTime = b.pubDate ? new Date(b.pubDate).getTime() || 0 : 0;
		return bTime - aTime;
	});

	return { items: items.slice(0, limit), warnings };
}
