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
	importantKeys: string[]; // Keys for important data about the user
	memoryKeys: string[]; // Keys for memory-related data
};

export type Message = {
	content: string;
	userName: string;
	timestamp: number;
	channelId: string;
	isBot: boolean;
};
