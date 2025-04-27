import {
	IgApiClient,
	DirectThreadEntity,
	IgCheckpointError,
	IgLoginBadPasswordError,
	IgLoginInvalidUserError,
	IgLoginTwoFactorRequiredError,
	IgRequestsLimitError,
	IgActionSpamError,
	IgLoginRequiredError,
} from 'instagram-private-api';
import * as fs from 'fs';
import * as path from 'path';
import { generateResponse } from './ai';
import type { UserHistory } from './type';

interface InstagramData {
	threads: {
		[thread_id: string]: {
			timestamp: number;
			user_name: string;
			cursor?: string;
		};
	};
}

let userHistory: UserHistory[] = [];
let data: InstagramData = { threads: {} };

// 隨機延遲工具 (±20%)
function getRandomDuration(baseMs: number): number {
	const variation = 0.2;
	const factor = 1 + (Math.random() * 2 - 1) * variation;
	return Math.round(baseMs * factor);
}

// 睡眠
function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// 判斷挑戰或致命錯誤
function isChallengeError(err: any): boolean {
	return (
		err instanceof IgCheckpointError ||
		(err.message && err.message.includes('challenge_required'))
	);
}

function isFatalError(err: any): boolean {
	return (
		err instanceof IgLoginTwoFactorRequiredError ||
		err instanceof IgLoginBadPasswordError ||
		err instanceof IgLoginInvalidUserError ||
		err instanceof IgRequestsLimitError ||
		err instanceof IgActionSpamError ||
		err instanceof IgLoginRequiredError
	);
}

class InstagramBot {
	private ig: IgApiClient;
	private currentUserId: number | null = null;
	private ACTIVE_START = 1;
	private ACTIVE_END = 23;

	constructor() {
		this.ig = new IgApiClient();
		this.loadState();
		['SIGINT', 'SIGTERM'].forEach((sig) =>
			process.on(sig as NodeJS.Signals, async () => {
				console.log(`Received ${sig}, saving state and exiting.`);
				await this.saveState();
				process.exit(0);
			}),
		);
	}

	private loadState() {
		const stateFile = path.resolve(__dirname, '.history/instagramData.json');
		const historyFile = path.resolve(
			__dirname,
			'.history/insta-userHistory.json',
		);
		if (fs.existsSync(stateFile)) {
			try {
				data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
				console.log('Loaded state from instagramData.json');
			} catch {
				console.warn('Invalid instagramData.json, starting fresh');
			}
		}
		fs.mkdirSync(path.resolve(__dirname, '.history'), { recursive: true });
		if (fs.existsSync(historyFile)) {
			try {
				userHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
				console.log('Loaded user history from insta-userHistory.json');
			} catch {
				console.warn('Invalid insta-userHistory.json, starting fresh');
			}
		}
		if (!fs.existsSync(stateFile)) {
			fs.writeFileSync(stateFile, JSON.stringify(data, null, 2));
			console.log('Created instagramData.json');
		}
	}

	private async saveState() {
		fs.writeFileSync(
			path.resolve(__dirname, 'instagramData.json'),
			JSON.stringify(data, null, 2),
		);
		fs.writeFileSync(
			path.resolve(__dirname, 'insta-userHistory.json'),
			JSON.stringify(userHistory, null, 2),
		);
		console.log('State saved.');
	}

	// 登入並自動處理 challenge
	public async login() {
		this.ig.state.generateDevice(process.env.IG_USERNAME!);
		if (process.env.IG_PROXY) this.ig.state.proxyUrl = process.env.IG_PROXY;
		try {
			const user = await this.ig.account.login(
				process.env.IG_USERNAME!,
				process.env.IG_PASSWORD!,
			);
			this.currentUserId = user.pk;
			console.log(`Logged in as ${user.username} (ID=${user.pk})`);
		} catch (err: any) {
			if (isChallengeError(err)) {
				console.warn('Challenge required, attempting auto resolution...');
				try {
					await this.ig.challenge.auto(true);
					console.log('Challenge passed, retrying login...');
					const user = await this.ig.account.login(
						process.env.IG_USERNAME!,
						process.env.IG_PASSWORD!,
					);
					this.currentUserId = user.pk;
					console.log(`Logged in after challenge as ${user.username}`);
				} catch (challengeErr: any) {
					console.error('Auto challenge failed:', challengeErr.message);
					await this.saveState();
					process.exit(1);
				}
			} else if (isFatalError(err)) {
				console.error('Fatal login error:', err.name || err.message);
				await this.saveState();
				process.exit(1);
			} else {
				throw err;
			}
		}
	}

	public async run() {
		console.log('Starting bot loop...');
		let idlePhase = 0;
		while (true) {
			if (!this.currentUserId) {
				console.error('Not logged in, exiting...');
				await this.saveState();
				process.exit(1);
			}
			const now = new Date();
			const hour = now.getHours();
			if (hour < this.ACTIVE_START || hour >= this.ACTIVE_END) {
				const next = new Date(now);
				next.setHours(this.ACTIVE_START, 0, 0, 0);
				if (hour >= this.ACTIVE_END) next.setDate(next.getDate() + 1);
				const waitMs = next.getTime() - now.getTime();
				console.log(
					`Outside active hours. Sleeping ${Math.round(waitMs / 60000)} min`,
				);
				await sleep(waitMs);
				continue;
			}

			try {
				const found = await this.findAndHandle();
				if (found) {
					idlePhase = 0;
					await sleep(getRandomDuration(10000));
					continue;
				}
				if (idlePhase === 0) {
					console.log('No new messages, retry in ~1 min');
					await sleep(getRandomDuration(60 * 1000));
				} else if (idlePhase === 1) {
					console.log('Still idle, sleeping ~30 min');
					await sleep(getRandomDuration(30 * 60 * 1000));
				} else {
					console.log('Prolonged idle, sleeping ~2 hr');
					await sleep(getRandomDuration(2 * 60 * 60 * 1000));
				}
				idlePhase = Math.min(idlePhase + 1, 2);
			} catch (err: any) {
				if (isFatalError(err)) {
					console.error('Fatal error encountered:', err.name || err.message);
					await this.saveState();
					process.exit(1);
				}
				console.error('Error in loop:', err);
				await sleep(getRandomDuration(60 * 1000));
			}
		}
	}

	private async findAndHandle(): Promise<boolean> {
		const threads = await this.ig.feed.directInbox().records();
		const threadData = await this.ig.feed.directInbox().items();
		for (const thread of threads) {
			const thread_id = thread.threadId;
			const threadInfo = threadData.find((t) => t.thread_id === thread_id);
			if (!threadInfo) continue;
			if (threadInfo.users.length !== 1) continue;
			const feed = this.ig.feed.directThread({
				thread_id,
				oldest_cursor: threadInfo.newest_cursor,
			});
			const items = (await feed.items()).filter((i) => i.item_type === 'text');
			if (!items.length) continue;
			const last = items[items.length - 1];
			if (!last) continue;
			const lastTs = data.threads[thread_id]?.timestamp || 0;
			if (last.user_id === this.currentUserId) {
				if (data.threads[thread_id]) {
					data.threads[thread_id].timestamp = Math.max(
						lastTs,
						Number(last.timestamp),
					);
				}
				continue;
			}
			if (Number(last.timestamp) > lastTs) {
				await this.focusThread(
					thread_id,
					threadInfo.newest_cursor,
					Number(last.timestamp),
					threadInfo.users.find((u) => u.pk !== this.currentUserId)
						?.full_name || '',
				);
				return true;
			}
		}
		return false;
	}

	private async focusThread(
		thread_id: string,
		oldest_cursor: string,
		initialTs: number,
		userName: string,
	) {
		console.log(`Switching to thread ${thread_id}`);
		data.threads[thread_id] = {
			timestamp: initialTs,
			user_name: userName,
			cursor: oldest_cursor,
		};
		const focusEnd = Date.now() + getRandomDuration(20000);
		let lastTs = initialTs;
		let lastActivity = Date.now();

		while (Date.now() < focusEnd) {
			const items = (
				await this.ig.feed.directThread({ thread_id, oldest_cursor }).items()
			).filter((i) => i.item_type === 'text');
			const last = items[items.length - 1];
			data.threads[thread_id].cursor = last?.item_id || oldest_cursor;
			if (!last) {
				console.log('No new messages, exiting focus');
				break;
			}
			if (
				last.user_id !== this.currentUserId &&
				Number(last.timestamp) > lastTs
			) {
				console.log(`New reply in ${thread_id}: ${last.text}`);
				await sleep(getRandomDuration(500));
				try {
					const [newHistory, resp] = await generateResponse(
						last.text,
						userName,
						true,
						userHistory,
						[],
					);
					userHistory = newHistory;
					await (
						this.ig.entity.directThread(thread_id) as DirectThreadEntity
					).broadcastText(resp);
					console.log(`Replied in ${thread_id}`);
				} catch (err: any) {
					if (isFatalError(err)) throw err;
					console.error('Reply error:', err.message);
				}
				lastTs = Number(last.timestamp);
				data.threads[thread_id].timestamp = lastTs;
				lastActivity = Date.now();
			}
			if (Date.now() - lastActivity > 60 * 1000) {
				console.log('No activity 1 min, exit focus');
				break;
			}
			await sleep(getRandomDuration(500));
		}
	}
}

(async () => {
	const bot = new InstagramBot();
	await bot.login();
	await bot.run();
})();
