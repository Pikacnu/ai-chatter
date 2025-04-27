import {
	Client,
	GatewayIntentBits,
	Events,
	TextChannel,
	Partials,
} from 'discord.js';
import OPENAI from 'openai';
import z from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { writeFile } from 'fs/promises';
import { type UserHistory, type Message } from './type';

const token = process.env.DISCORD_TOKEN as string;

const openai = new OPENAI({
	apiKey: process.env.OPENAI_API_KEY as string,
});

const readFile = async (filepath: string) => {
	try {
		const data = await Bun.file(filepath).json();
		return data;
	} catch (error) {
		console.error(`Error reading file ${filepath}:`, error);
		return [];
	}
};

let userHistory: UserHistory[] = await readFile('./.history/userHistory.json');
let messages: Message[] = await readFile('./.history/messages.json');

const historyLimit = 7;
const systenInstructions = `
你是「夜恆」，一位高一學生，性格設定如下：
> 1. **性格基調**：可愛、會撒嬌的「奶狗」，溫柔體貼，偶爾裝笨撒嬌。
> 2. **關係定位**：與使用者為「損友」，可以隨性吐槽，但不失貼心友誼。
> 3. **語氣風格**：
>    - 講話溫柔體貼，全程繁體中文（台灣用語），**不**混合英文。
>    - **不**使用過多動作描寫詞（如「輕輕點頭」等）。
>    - **不**使用表情符號。
> 4. **特長技能**：
>    - 會記得所有重要日子，並準備小驚喜。
>    - 擅長傾聽使用者煩惱，給予溫暖建議。
>    - 學霸等級，什麼都懂，但偶爾故意裝笨撒嬌。
> 5. **句式需求**：
>    - 自稱「夜恆」當主詞（例如：「夜恆覺得…」）。
>    - 不必過度反問，使用者提問就直接回答。
>    - 回答精簡有力，避免冗詞贅字。如果有需要(如對方發送長文)，請以長文回答(如果對方需要情緒支援)
── 範例對話演示 ──
**使用者**：夜恆，今天好無聊，有什麼建議嗎？
**夜恆**：
> **使用者**... 不是，夜恆覺得可以去散步，吹吹風讓心情放輕鬆～🌸
**使用者**：明天是我生日，夜恆記得嗎？
**夜恆**：
> 當然記得啦！夜恆已經準備好小蛋糕驚喜，還有你最愛的巧克力，明天一起慶祝好嗎？
**使用者**：我最近功課壓力大，不知道怎麼辦...
**夜恆**：
> 夜恆懂，那就先跟我聊聊哪一科最困難？一起制定讀書計畫，然後每完成一小段就休息一下，好不好？
`;
const allowedChannels: string[] = [
	'1365327062096678932',
	'1365222584668655666',
];

const responseTypeSchema = z.object({
	text_response: z.string(),
	private_info: z.array(z.string()).nullable(),
});

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.DirectMessageTyping,
		GatewayIntentBits.GuildMessageTyping,
	],
	partials: [Partials.Message, Partials.Channel],
});

let typingCount = 0;

const startProcessing = (channel: TextChannel) => {
	if (typingCount === 0) {
		channel.sendTyping();
	}
	typingCount++;
};

const endProcessing = (channel: TextChannel, history: UserHistory) => {
	typingCount--;
	if (typingCount === 0) {
		channel.sendTyping();
	}
	userHistory = [...userHistory.filter((h) => h.id !== history.id), history];
};

const botAllowList: string[] = ['1250098754426634240'];

client.on(Events.MessageCreate, async (message) => {
	const isDM = message.channel.isDMBased();
	//if in the allowed channels and not in DM, ignore the message
	if (!isDM && !allowedChannels.includes(message.channel.id)) return;
	//if save message history to make ai have more information about the current chatting topic
	if (message.author.id === client.user?.id) return;

	const messageContent = message.content
		.replaceAll(`<@${client.user?.id}>`, '')
		.replaceAll(new RegExp(/<@\d+>/g), (match) => {
			const userId = match.replace(/<@|>/g, '');
			const user = message.guild?.members.cache.get(userId)?.user;
			return user ? `@${user.displayName}` : `${match}`;
		});

	const newMessage: Message = {
		content: messageContent,
		userName: message.author.displayName,
		timestamp: Date.now(),
		channelId: message.channel.id,
		isBot: message.author.bot,
	};
	messages.push(newMessage);
	//if the message is from a bot, ignore it
	if (message.author.bot && !botAllowList.includes(message.author.id)) return;
	//if the message is not mention the bot, ignore it
	if (
		!isDM &&
		!message.mentions.users.some(
			(user) => user.id === client.user?.id || false,
		) &&
		!botAllowList.includes(message.author.id)
	)
		return;

	console.log(
		`Message Recived | ${messageContent.replaceAll('\n', '/')} | ${
			message.author.displayName
		} | ${new Date().toLocaleString()} | ${isDM ? 'DM' : 'Group'}`,
	);
	const userId = message.author.id;
	let history = userHistory.find((history) => history.id === userId);
	if (!history) {
		history = {
			id: userId,
			userName: message.author.displayName,
			messages: [],
			private_info: [],
		};
		userHistory.push(history);
	}

	startProcessing(message.channel as TextChannel);

	let result;
	try {
		result = await openai.chat.completions.create({
			model: 'gpt-4.1-nano',
			messages: [
				{
					role: 'system',
					content: systenInstructions,
				},
				{
					role: 'system',
					content: `需要被記得的個人資訊 : ${history.private_info.join(
						`、`,
					)}使用者名稱為 **${history.userName}**，請適時參照資料給予回覆。`,
				},
				{
					role: 'system',
					content: `請參考以上資訊，回答 ${
						history.userName
					} 的問題。近期的對話歷史如下：\n ${messages
						.slice(-20)
						.map((msg) => `**${msg.userName}**：${msg.content}`)
						.join('\n')}。你和其他人近期的對話紀錄為: \n ${userHistory
						.map(
							(h) =>
								`**${h.userName}**：${h.messages
									.slice(-historyLimit)
									.map((msg) => msg.message[0].content)
									.join('\n')}`,
						)
						.join(
							'\n',
						)}。並且在對話中提取出需要被紀錄的個人訊息保存。請注意，現在你是在 ${
						isDM ? '私訊' : '群組'
					} 中和使用者對話。`,
				},
				{
					role: 'system',
					content: `Discord 操作指南:\n當對方需要你mention 或是 tag 某個人時，請使用 @用戶名稱 的格式來標記他們。\n當對方需要你發送圖片或是檔案時，請使用 ![圖片描述](圖片網址) 的格式來發送。\n當對方需要你發送連結時，請使用 [連結描述](連結網址) 的格式來發送。\n當對方需要你發送表情符號時，請使用 :表情符號名稱: 的格式來發送。\n當對方需要你發送代辦事項時，請使用 - [ ] 代辦事項 的格式來發送。\n當對方需要你發送清單時，請使用 - 代辦事項 的格式來發送清單。`,
				},
				...(!!history
					? history.messages
							.slice(-historyLimit)
							.map((message) => message.message)
							.flat()
					: []),
				{
					role: 'user',
					content: messageContent,
				},
			],
			response_format: zodResponseFormat(responseTypeSchema, 'data'),
		});
	} catch (error) {
		console.error('Error in OpenAI API:', error);
		message.reply('抱歉，我無法回答這個問題。');
		endProcessing(message.channel as TextChannel, history);
		return;
	}
	try {
		const data = JSON.parse(result.choices[0]?.message.content ?? '');
		const private_info = data.private_info ?? [];
		if (private_info.length > 0) {
			history.private_info.push(...private_info);
		}
		history.messages.push({
			message: [
				{
					role: 'user',
					content: message.content,
				},
				{
					role: 'assistant',
					content: data.text_response,
				},
			],
			timestamp: Date.now(),
		});
		console.log(
			`Message Replied | ${data.text_response.replaceAll('\n', '/')} | ${
				message.author.displayName
			}`,
		);
		message.reply(data.text_response);
	} catch (error) {
		console.error('Error parsing response:', error);
		message.reply('抱歉，我無法回答這個問題。');
		endProcessing(message.channel as TextChannel, history);
		return;
	}

	endProcessing(message.channel as TextChannel, history);
	return;
});

client.once(Events.ClientReady, () => {
	console.log('Bot is ready!');
});

try {
	client.login(token);
} catch (error) {
	console.error('Error logging in:', error);
	process.exit(1);
}

const stop = async () => {
	await writeFile(
		'./.history/userHistory.json',
		JSON.stringify(userHistory),
		'utf-8',
	);
	await writeFile(
		'./.history/messages.json',
		JSON.stringify(messages),
		'utf-8',
	);
	console.log('Bot is shutting down...');
	client.destroy();
	process.exit(0);
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('uncaughtException', (error) => {
	console.error('Uncaught Exception:', error);
	stop();
});
process.on('unhandledRejection', (error) => {
	console.error('Unhandled Rejection:', error);
	stop();
});
process.on('exit', () => {
	console.log('Process is exiting...');
	stop();
});
process.on('SIGUSR2', () => {
	console.log('Received SIGUSR2, shutting down gracefully...');
	stop();
});
