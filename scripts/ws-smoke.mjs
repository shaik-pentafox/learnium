// Text-roleplay WS smoke test. Proves end-to-end Gemini token streaming.
// Run AFTER a Gemini provider+model are registered & promoted default.
//   node scripts/ws-smoke.mjs "your first user line"
// Reuses persona id from PERSONA_ID env, else creates one.
import WebSocket from 'ws';

const BASE = process.env.BASE ?? 'http://localhost:3000/api/v1';
const WS_BASE = (process.env.BASE ?? 'http://localhost:3000/api/v1').replace('http', 'ws');
const USER_LINE = process.argv[2] ?? 'Hi, I am the support agent. How can I help you today?';

const j = async (res) => {
  const body = await res.json();
  if (!res.ok || body.status === 'error') throw new Error(JSON.stringify(body));
  return body.data;
};
const post = (path, token, payload) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: {
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  }).then(j);

const { accessToken } = await post('/auth/login', null, { username: 'admin', password: 'Admin@123' });

let personaId = process.env.PERSONA_ID ? Number(process.env.PERSONA_ID) : null;
if (!personaId) {
  const p = await post('/personas', accessToken, {
    name: 'Angry Customer',
    systemPrompt:
      'You are an irate customer whose order arrived broken. Stay in character, be terse and emotional. ' +
      'When the agent genuinely resolves it, reply with [CONVERSATION_ENDED].',
  });
  personaId = p.id;
}
const session = await post('/sessions', accessToken, { personaId });
const { ticket } = await post('/auth/realtime/ticket', accessToken);

console.log(`persona=${personaId} session=${session.uid}\nconnecting WS...`);
const ws = new WebSocket(`${WS_BASE}/realtime/chat?ticket=${ticket}&sessionId=${session.uid}`);

ws.on('message', (raw) => {
  const f = JSON.parse(raw.toString());
  if (f.type === 'token') process.stdout.write(f.delta);
  else if (f.type === 'joined') {
    console.log(`[joined ${f.personaName}] sending...`);
    ws.send(JSON.stringify({ type: 'message', content: USER_LINE })); // send only after join
  }
  else if (f.type === 'message_done') { console.log(`\n[done #${f.messageId}]`); ws.close(); }
  else if (f.type === 'error') { console.error('\n[error]', f); ws.close(); }
  else console.log('\n[', f.type, ']', JSON.stringify(f).slice(0, 200));
});
ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.error('ws error', e.message); process.exit(1); });
