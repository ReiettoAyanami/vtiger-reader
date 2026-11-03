// A stand-in for the `claude` program in headless mode (`-p --input-format stream-json
// --output-format stream-json --include-partial-messages`), answering as Claude Code 2.1 does.
// Its answer is what it was given, as JSON: the tests read what reached the process.
// Token "bad-token": the API's 401; "limit-token": 429; "crash-token": exits without a result.
import process from 'node:process';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN ?? '';
  const print = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
  const model = process.argv[process.argv.indexOf('--model') + 1];
  print({ type: 'system', subtype: 'init', session_id: 's1' });
  if (token === 'crash-token') {
    process.stderr.write('Error: something broke\n');
    process.exit(1);
  }
  if (token === 'bad-token' || token === 'limit-token') {
    const status = token === 'bad-token' ? 401 : 429;
    print({ type: 'result', subtype: 'error', is_error: true, api_error_status: status, result: status === 401 ? 'Invalid API key · Please run /login' : 'Claude usage limit reached' });
    return;
  }
  const echo = JSON.stringify({
    args: process.argv.slice(2),
    env: Object.keys(process.env).sort(),
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
