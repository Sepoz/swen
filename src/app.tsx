import { exec } from "node:child_process";
import { platform } from "node:os";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useAnimation, useApp, useInput, useStdout } from "ink";
import type { Config } from "./config.js";
import { fetchAll, type NewsItem } from "./rss.js";

type View = { kind: "list" } | { kind: "detail"; itemId: string };

type Props = {
	config: Config;
	limit: number;
};

const CATEGORY_COLORS: Record<string, string> = {
	general: "cyanBright",
	politics: "magentaBright",
	economy: "yellowBright",
	tech: "greenBright",
	sport: "blueBright",
	culture: "redBright",
};

function categoryColor(category: string): string {
	return CATEGORY_COLORS[category] ?? "white";
}

const OUTLET_COLORS = [
	"cyanBright",
	"magentaBright",
	"greenBright",
	"yellowBright",
	"blueBright",
	"redBright",
];

function outletColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	return OUTLET_COLORS[Math.abs(hash) % OUTLET_COLORS.length] ?? "cyanBright";
}

function formatRelative(iso: string): string {
	if (!iso) return "";
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const seconds = Math.floor((Date.now() - then) / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo`;
	return `${Math.floor(months / 12)}y`;
}

function formatAbsolute(iso: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleString("it-IT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function truncate(s: string, n: number): string {
	return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function openInBrowser(url: string): void {
	if (!url) return;
	const p = platform();
	const cmd = p === "darwin" ? "open" : p === "win32" ? "start ''" : "xdg-open";
	exec(`${cmd} ${JSON.stringify(url)}`, () => {
		// Errors ignored — the UI surfaces nothing useful here.
	});
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TITLE_PALETTE = ["#fecaca", "#fca5a5", "#f87171", "#ef4444", "#f87171", "#fca5a5"];

function Spinner({ color = "cyan" }: { color?: string }) {
	const { frame } = useAnimation({ interval: 80 });
	return <Text color={color}>{SPINNER_FRAMES[frame % SPINNER_FRAMES.length]}</Text>;
}

function GradientTitle({ text }: { text: string }) {
	const { frame } = useAnimation({ interval: 220 });
	return (
		<Text bold>
			{[...text].map((ch, i) => (
				// oxlint-disable-next-line react/no-array-index-key
				<Text key={i} color={TITLE_PALETTE[(i + frame) % TITLE_PALETTE.length]}>
					{ch}
				</Text>
			))}
		</Text>
	);
}

function OutletBadge({ name }: { name: string }) {
	return (
		<Text color={outletColor(name)} bold>
			{name}
		</Text>
	);
}

function CategoryTag({ category }: { category: string }) {
	return (
		<Text color={categoryColor(category)} dimColor>
			#{category}
		</Text>
	);
}

function Header({
	count,
	loading,
	subtitle,
}: {
	count: number;
	loading: boolean;
	subtitle: string;
}) {
	return (
		<Box
			borderStyle="round"
			borderColor="red"
			paddingX={2}
			paddingY={0}
			justifyContent="space-between"
		>
			<Box>
				<GradientTitle text="✦ swen" />
				<Text dimColor>{"   "}</Text>
				<Text dimColor italic>
					{subtitle}
				</Text>
			</Box>
			<Box>
				{loading && (
					<>
						<Spinner color="red" />
						<Text> </Text>
					</>
				)}
				<Text color="cyan" bold>
					{count}
				</Text>
				<Text dimColor> news</Text>
			</Box>
		</Box>
	);
}

function Footer({ hints, warnings }: { hints: string; warnings: string[] }) {
	return (
		<Box flexDirection="column" paddingX={2} marginTop={0}>
			{warnings.length > 0 && (
				<Box>
					<Text color="yellow">⚠ </Text>
					<Text dimColor>
						{warnings.length === 1
							? `1 feed failed: ${truncate(warnings[0]!, 80)}`
							: `${warnings.length} feeds failed (e.g. ${truncate(warnings[0]!, 60)})`}
					</Text>
				</Box>
			)}
			<Text dimColor>{hints}</Text>
		</Box>
	);
}

// Rows reserved for header (3) + footer (2) + padding/margins (3).
const CHROME_ROWS = 8;

export default function App({ config, limit }: Props) {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const [items, setItems] = useState<NewsItem[]>([]);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [cursor, setCursor] = useState(0);
	const [scroll, setScroll] = useState(0);
	const [rows, setRows] = useState(stdout?.rows ?? 24);
	const [view, setView] = useState<View>({ kind: "list" });

	useEffect(() => {
		if (!stdout) return;
		const onResize = () => setRows(stdout.rows ?? 24);
		stdout.on("resize", onResize);
		return () => {
			stdout.off("resize", onResize);
		};
	}, [stdout]);

	const pageSize = Math.max(1, rows - CHROME_ROWS);

	useEffect(() => {
		setScroll((off) => {
			const maxOff = Math.max(0, items.length - pageSize);
			if (cursor < off) return Math.min(cursor, maxOff);
			if (cursor >= off + pageSize) return Math.min(cursor - pageSize + 1, maxOff);
			return Math.min(off, maxOff);
		});
	}, [cursor, pageSize, items.length]);

	const refresh = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await fetchAll(config.feeds, limit);
			setItems(result.items);
			setWarnings(result.warnings);
			setCursor((c) => Math.min(c, Math.max(0, result.items.length - 1)));
			if (result.items.length === 0 && result.warnings.length > 0) {
				setError(`No items fetched. ${result.warnings[0]}`);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [config, limit]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const selected = useMemo(
		() => (view.kind === "detail" ? items.find((i) => i.id === view.itemId) : undefined),
		[view, items],
	);

	useInput((input, key) => {
		if (input === "q" || (key.ctrl && input === "c")) {
			exit();
			return;
		}

		if (input === "o") {
			const item = view.kind === "detail" ? selected : items[cursor];
			if (item?.link) openInBrowser(item.link);
			return;
		}

		if (view.kind === "detail") {
			if (key.escape || input === "h" || key.leftArrow) {
				setView({ kind: "list" });
				return;
			}
			if (key.downArrow || input === "j") {
				const next = Math.min(cursor + 1, Math.max(0, items.length - 1));
				const item = items[next];
				if (item) {
					setCursor(next);
					setView({ kind: "detail", itemId: item.id });
				}
				return;
			}
			if (key.upArrow || input === "k") {
				const prev = Math.max(cursor - 1, 0);
				const item = items[prev];
				if (item) {
					setCursor(prev);
					setView({ kind: "detail", itemId: item.id });
				}
				return;
			}
			return;
		}

		if (input === "r") {
			void refresh();
			return;
		}
		if (key.downArrow || input === "j") {
			setCursor((c) => Math.min(c + 1, Math.max(0, items.length - 1)));
			return;
		}
		if (key.upArrow || input === "k") {
			setCursor((c) => Math.max(c - 1, 0));
			return;
		}
		if (key.pageDown || (key.ctrl && input === "d")) {
			setCursor((c) => Math.min(c + pageSize, Math.max(0, items.length - 1)));
			return;
		}
		if (key.pageUp || (key.ctrl && input === "u")) {
			setCursor((c) => Math.max(c - pageSize, 0));
			return;
		}
		if (input === "g") {
			setCursor(0);
			return;
		}
		if (input === "G") {
			setCursor(Math.max(0, items.length - 1));
			return;
		}
		if (key.return || input === "l" || key.rightArrow) {
			const item = items[cursor];
			if (item) setView({ kind: "detail", itemId: item.id });
			return;
		}
	});

	if (loading && items.length === 0) {
		return (
			<Box flexDirection="column">
				<Header count={0} loading subtitle="caricamento notizie…" />
				<Box paddingX={2} paddingY={1}>
					<Spinner />
					<Text> Fetching {config.feeds.length} feeds…</Text>
				</Box>
			</Box>
		);
	}

	if (error) {
		return (
			<Box flexDirection="column">
				<Header count={0} loading={false} subtitle="something went wrong" />
				<Box
					borderStyle="round"
					borderColor="red"
					paddingX={2}
					paddingY={0}
					flexDirection="column"
					marginTop={1}
				>
					<Text color="red" bold>
						✗ {error}
					</Text>
				</Box>
				<Footer hints="r retry · q quit" warnings={warnings} />
			</Box>
		);
	}

	if (view.kind === "detail" && selected) {
		return (
			<Box flexDirection="column">
				<Header
					count={items.length}
					loading={loading}
					subtitle={loading ? "refreshing…" : `viewing — ${selected.feedName}`}
				/>
				<Detail item={selected} />
				<Footer
					hints="↑↓/jk prev/next · o open in browser · esc/← back · q quit"
					warnings={warnings}
				/>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Header
				count={items.length}
				loading={loading}
				subtitle={loading ? "refreshing…" : `${config.feeds.length} feed italiani · newest first`}
			/>
			<List items={items} cursor={cursor} scroll={scroll} pageSize={pageSize} />
			<Footer
				hints="↑↓/jk move · PgUp/PgDn · g/G top/bottom · enter open · o browser · r refresh · q quit"
				warnings={warnings}
			/>
		</Box>
	);
}

function List({
	items,
	cursor,
	scroll,
	pageSize,
}: {
	items: NewsItem[];
	cursor: number;
	scroll: number;
	pageSize: number;
}) {
	if (items.length === 0) {
		return <EmptyState />;
	}

	const widest = items.reduce((max, it) => Math.max(max, it.feedName.length), 0);
	const outletWidth = Math.min(widest, 22) + 1;
	const end = Math.min(items.length, scroll + pageSize);
	const visible = items.slice(scroll, end);
	const hiddenAbove = scroll;
	const hiddenBelow = items.length - end;

	return (
		<Box flexDirection="column" marginTop={1} paddingX={1}>
			{visible.map((item, i) => (
				<Row
					key={item.id}
					item={item}
					selected={scroll + i === cursor}
					outletWidth={outletWidth}
				/>
			))}
			{(hiddenAbove > 0 || hiddenBelow > 0) && (
				<Box marginTop={0} paddingX={1} justifyContent="space-between">
					<Text dimColor>{hiddenAbove > 0 ? `↑ ${hiddenAbove} more` : " "}</Text>
					<Text dimColor>
						{cursor + 1}/{items.length}
					</Text>
					<Text dimColor>{hiddenBelow > 0 ? `↓ ${hiddenBelow} more` : " "}</Text>
				</Box>
			)}
		</Box>
	);
}

function Row({
	item,
	selected,
	outletWidth,
}: {
	item: NewsItem;
	selected: boolean;
	outletWidth: number;
}) {
	return (
		<Box>
			<Box width={2}>
				<Text color="cyan" bold>
					{selected ? "▌" : " "}
				</Text>
			</Box>
			<Box width={2}>
				<Text color={selected ? "cyanBright" : "cyan"}>{selected ? "❯" : " "}</Text>
			</Box>
			<Box width={outletWidth}>
				<OutletBadge name={truncate(item.feedName, outletWidth - 1)} />
			</Box>
			<Box flexGrow={1} marginLeft={1}>
				<Text dimColor={!selected} bold={selected}>
					{truncate(item.title, 90)}
				</Text>
			</Box>
			<Box width={6} justifyContent="flex-end">
				<Text dimColor>{formatRelative(item.pubDate)}</Text>
			</Box>
		</Box>
	);
}

function Detail({ item }: { item: NewsItem }) {
	return (
		<Box flexDirection="column" marginTop={1}>
			<Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0} flexDirection="column">
				<Box>
					<OutletBadge name={item.feedName} />
					<Text dimColor>{"  ·  "}</Text>
					<CategoryTag category={item.category} />
					<Text dimColor>{"  ·  "}</Text>
					<Text dimColor>{formatAbsolute(item.pubDate)}</Text>
					{item.pubDate && (
						<>
							<Text dimColor>{"  ·  "}</Text>
							<Text dimColor>{formatRelative(item.pubDate)} ago</Text>
						</>
					)}
				</Box>
				<Box marginTop={1}>
					<Text bold>{item.title}</Text>
				</Box>
			</Box>

			<Box marginTop={1} paddingX={2}>
				<Text bold color="magenta">
					◆ Articolo
				</Text>
			</Box>
			<Box
				marginTop={0}
				marginX={2}
				borderStyle="single"
				borderColor="gray"
				borderDimColor
				paddingX={1}
				paddingY={0}
			>
				{item.content || item.summary ? (
					<Text>{item.content || item.summary}</Text>
				) : (
					<Text dimColor italic>
						no content provided in feed
					</Text>
				)}
			</Box>

			<Box marginTop={1} paddingX={2}>
				<Text dimColor>Link:{"  "}</Text>
				<Text color="blue" underline>
					{item.link || "—"}
				</Text>
			</Box>
		</Box>
	);
}

function EmptyState() {
	return (
		<Box
			flexDirection="column"
			alignItems="center"
			marginTop={2}
			paddingY={1}
			borderStyle="round"
			borderColor="green"
			borderDimColor
		>
			<Text color="green" bold>
				✓ nessuna notizia
			</Text>
			<Text dimColor>No items returned by the configured feeds.</Text>
		</Box>
	);
}
