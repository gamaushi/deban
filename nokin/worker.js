// 納金電卓 Web版 読み取り用の中継（Perl版 ocr.cgi の代わり）
//
// ブラウザから写真(JPEG)を受け取り、Azure AI Vision に送って、読み取り結果を返す。
// キー・合言葉はこのファイルには書かない。Cloudflareの「変数とシークレット」に保存する:
//   AZURE_ENDPOINT … https://(リソース名).cognitiveservices.azure.com/
//   AZURE_KEY      … キー1
//   PASSWORD       … 合言葉（「山と言ったら？」の答え）
// 利用回数を数える場合は、KV を変数名 COUNT で結び付ける（なくても動く）。
//
// ブラウザから届くもの:
//   POST 本文 = JPEG そのもの / 見出し X-Pass = 合言葉
//   見出し X-Action: check → 合言葉の確認だけ   X-Action: count → 今月の回数だけ
// 返すもの(JSON):
//   成功 { ok:1, blocks:[...], count:今月の回数, count_ok:1 }
//   失敗 { ok:0, error:"pass"|"limit"|"key"|"fail"|"bad", message:"..." }

// このページからの呼び出しだけを許可する（出番カレンダーと同じサイト）
const ALLOW_ORIGINS = ['https://gamaushi.github.io'];
const MAX_BODY = 8 * 1024 * 1024; // 受け取る写真の上限(8MB)

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Pass, X-Action',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
    });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply({ ok: 0, error: 'bad', message: 'POSTで送ってください' }, 405);

    // 合言葉の確認（日本語の合言葉も送れるよう、ブラウザ側で encodeURIComponent してある）
    let given = '';
    try { given = decodeURIComponent(req.headers.get('X-Pass') || ''); } catch (e) {}
    if (!env.PASSWORD || given !== env.PASSWORD) {
      await new Promise(r => setTimeout(r, 1000)); // 総当たりで試されにくくする
      return reply({ ok: 0, error: 'pass', message: '合言葉が違います' }, 403);
    }

    const action = req.headers.get('X-Action') || '';
    if (action === 'check') return reply({ ok: 1 });
    if (action === 'count') {
      const n = await readCount(env);
      return reply({ ok: 1, count: n, count_ok: env.COUNT ? 1 : 0 });
    }

    const len = Number(req.headers.get('Content-Length') || 0);
    if (len > MAX_BODY) return reply({ ok: 0, error: 'bad', message: '写真が大きすぎます' }, 413);
    if (!req.body) return reply({ ok: 0, error: 'bad', message: '写真がありません' }, 400);

    const url = String(env.AZURE_ENDPOINT || '').trim().replace(/\/+$/, '') +
      '/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read';

    let res;
    try {
      // 写真はそのまま横流しする（中継側でほとんど計算しないので速い）
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': String(env.AZURE_KEY || '').trim(), 'Content-Type': 'application/octet-stream' },
        body: req.body,
      });
    } catch (e) {
      return reply({ ok: 0, error: 'fail', message: 'Azureと通信できませんでした' });
    }

    if (res.status === 403 || res.status === 429) return reply({ ok: 0, error: 'limit', message: '無料枠の上限に達しました' });
    if (res.status === 401) return reply({ ok: 0, error: 'key', message: 'Azureのキーが正しくありません' });
    if (res.status !== 200) {
      let detail = '';
      try { const t = await res.text(); const m = t.match(/"message"\s*:\s*"([^"]{1,200})/); detail = m ? m[1] : t.slice(0, 200); } catch (e) {}
      return reply({ ok: 0, error: 'fail', message: `Azureの読み取りに失敗しました(コード${res.status}${detail ? ': ' + detail : ''})` });
    }

    // Azureが読み取りに成功した(=無料枠を1回使った)時だけ数える
    const count = await addCount(env);
    let azure = {};
    try { azure = await res.json(); } catch (e) {}
    const blocks = (azure.readResult && azure.readResult.blocks) || [];
    return reply({ ok: 1, blocks, count, count_ok: env.COUNT ? 1 : 0 });
  },
};

// 今の年月(日本時間)。月が変わったら0から数え直す
function thisMonth() {
  const t = new Date(Date.now() + 9 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}
async function readCount(env) {
  if (!env.COUNT) return 0;
  try { return Number(await env.COUNT.get('count-' + thisMonth())) || 0; } catch (e) { return 0; }
}
async function addCount(env) {
  if (!env.COUNT) return 0;
  try {
    const key = 'count-' + thisMonth();
    const n = (Number(await env.COUNT.get(key)) || 0) + 1;
    await env.COUNT.put(key, String(n), { expirationTtl: 400 * 24 * 3600 }); // 1年ちょっとで自動で消える
    return n;
  } catch (e) { return 0; }
}
