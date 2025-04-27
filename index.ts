function startProcess(file: string, name: string) {
	const child_process = Bun.spawn({
		cmd: ['bun', 'run', file],
		stdio: ['inherit', 'pipe', 'pipe'],
		env: {
			...process.env,
		},
	});
	const stdout_reader =
		child_process.stdout.getReader() as ReadableStreamDefaultReader<Uint8Array>;
	const stderr_reader =
		child_process.stderr.getReader() as ReadableStreamDefaultReader<Uint8Array>;
	reader(stdout_reader, `${name} - stdout`);
	reader(stderr_reader, `${name} - stderr`);
	return process;
}

async function reader(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	name: string,
) {
	(async () => {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			console.log(
				`[${name}] ${new TextDecoder().decode(value)}`.replace('\n', ''),
			);
		}
	})();
}

const processes = [
	//startProcess('./instagram.ts', 'Instagram'),
	startProcess('./discord.ts', 'Discord'),
];

process.on('SIGINT', async () => {
	await Promise.all(
		processes.map(async (process) => {
			if (process) {
				if (process.send) {
					process.send('SIGINT');
				}
			}
		}),
	),
		console.log('Processes terminated gracefully.');
	await Bun.sleep(2 * 1000); // 等待所有進程結束
	process.exit(0);
});
