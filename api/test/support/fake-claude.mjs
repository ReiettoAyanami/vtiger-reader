// A stand-in for the `claude` program: `node fake-claude.mjs <mode> …`. The mode is the first
// argument, given by the test in the command it hands the adapter:
//   ok          headless answers as Claude Code 2.1 does (`-p --input-format stream-json …`); its
//               answer is what it was given, as JSON, so the tests read what reached the process;
//   refuse      the API's 401 ("Please run /login"); limit: 429; crash: exits without a result;
//   signed-out  `auth status --json` says there is no login on this computer.
// `auth status --json` answers for every mode but signed-out with a Pro login.
import process from 'node:process';

const mode = process.argv[2];
const args = process.argv.slice(3);

if (args[0] === 'auth' && args[1] === 'status') {
  const answer = mode === 'signed-out' ? { loggedIn: false, authMethod: null } : { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' };
  process.stdout.write(`${JSON.stringify(answer)}\n`);
  process.exit(0);
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const print = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  const model = args[args.indexOf('--model') + 1];
  print({ type: 'system', subtype: 'init', session_id: 's1' });
  if (mode === 'crash') {
    process.stderr.write('Error: something broke\n');
    process.exit(1);
  }
  if (mode === 'refuse' || mode === 'limit') {
    const status = mode === 'refuse' ? 401 : 429;
    print({ type: 'result', subtype: 'error', is_error: true, api_error_status: status, result: status === 401 ? 'Invalid API key · Please run /login' : 'Claude usage limit reached' });
    return;
  }
  const echo = JSON.stringify({
    args,
    env: Object.keys(process.env).sort(),
    home: process.env.HOME ?? process.env.USERPROFILE ?? null,
    input: JSON.parse(input.trim()),
  });
  print({ type: 'stream_event', event: { type: 'message_start', message: { model: 'claude-x' } } });
  for (let i = 0; i < echo.length; i += 400) {
    print({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: echo.slice(i, i + 400) } } });
  }
  print({ type: 'assistant', message: { model: `claude-${model}-9`, content: [{ type: 'text', text: echo }] } });
  print({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: echo,
    usage: { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 7, output_tokens: 20 },
    modelUsage: { [`claude-${model}-9`]: {} },
  });
});
