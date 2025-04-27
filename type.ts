export type UserHistory = {
	id: string;
	userName: string;
	messages: Array<{
		message: [
			{ role: 'user'; content: string },
			{ role: 'assistant'; content: string },
		];
		timestamp: number;
	}>;
	private_info: string[];
};

export type Message = {
	content: string;
	userName: string;
	timestamp: number;
	channelId: string;
	isBot: boolean;
};
